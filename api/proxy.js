// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { spaceId, prompt, image, token } = req.body;
  console.error(`[PROXY] => ${spaceId} | token: ${token?.substring(0, 10)}... | img: ${image ? image.substring(0, 20) + '...' : 'none'}`);

  if (!spaceId || !prompt || !token) {
    return res.status(400).json({ error: 'Missing spaceId, prompt, or token' });
  }

  // Une seule tentative rapide par format (pas de retry 503 long)
  const tryFormat = async (name, body) => {
    console.error(`[PROXY] Trying ${name}...`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let resp;
    try {
      resp = await fetch(`https://api-inference.huggingface.co/models/${spaceId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      console.error(`[PROXY] ${name} NETWORK ERROR: ${e.message}`);
      return { ok: false, error: `Erreur reseau: ${e.message}` };
    }
    clearTimeout(timer);

    const txt = await resp.text().catch(() => '');
    console.error(`[PROXY] ${name} => HTTP ${resp.status} | ${txt.substring(0, 200)}`);

    if (resp.status === 200) {
      if (txt.length < 500) {
        console.error(`[PROXY] ${name} => image trop petite (${txt.length} bytes)`);
        return { ok: false, error: 'Image vide' };
      }
      const buf = Buffer.from(txt, 'binary');
      return { ok: true, data: buf, contentType: resp.headers.get('content-type') || 'image/png' };
    }

    // 503 = loading, on retry 2 fois max
    if (resp.status === 503) {
      for (let r = 0; r < 2; r++) {
        console.error(`[PROXY] ${name} retry ${r + 1}/2...`);
        await new Promise(s => setTimeout(s, 8000));
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 30000);
        let r2;
        try {
          r2 = await fetch(`https://api-inference.huggingface.co/models/${spaceId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body,
            signal: c2.signal,
          });
        } catch (e) { clearTimeout(t2); continue; }
        clearTimeout(t2);
        const t2txt = await r2.text().catch(() => '');
        if (r2.status === 200 && t2txt.length >= 500) {
          return { ok: true, data: Buffer.from(t2txt, 'binary'), contentType: r2.headers.get('content-type') || 'image/png' };
        }
      }
      return { ok: false, error: 'Modele en chargement (trop long), reessayez dans 30s' };
    }

    // Extraire message d'erreur
    let errMsg;
    try { const j = JSON.parse(txt); errMsg = j.error || txt; } catch { errMsg = txt; }
    if (!errMsg) errMsg = `HTTP ${resp.status}`;

    if (resp.status === 401 || resp.status === 403) {
      const isGated = errMsg.toLowerCase().includes('gated');
      return { ok: false, error: isGated
        ? `Modele gated: acceptez les termes sur huggingface.co/${spaceId}`
        : `Token HF invalide ou insuffisant: ${errMsg.substring(0, 150)}` };
    }

    // 400/404 = format non supporte → continuer
    if (resp.status === 400 || resp.status === 404) {
      return { ok: false, skip: true, error: errMsg.substring(0, 200) };
    }

    return { ok: false, error: errMsg.substring(0, 300) };
  };

  // Essayer img2img d'abord (si image fournie)
  if (image) {
    let r = await tryFormat('img2img', JSON.stringify({ inputs: prompt, image }));
    if (r.ok) return res.status(200).type(r.contentType).send(r.data);
    if (!r.skip) return res.status(400).json({ error: r.error, format: 'img2img', model: spaceId });

    r = await tryFormat('img2img-v2', JSON.stringify({ inputs: prompt, parameters: { image } }));
    if (r.ok) return res.status(200).type(r.contentType).send(r.data);
    if (!r.skip) return res.status(400).json({ error: r.error, format: 'img2img-v2', model: spaceId });
  }

  // Fallback text-to-image (ne marchera pas avec les plans 2D, mais certains modeles ne supportent que ca)
  const r = await tryFormat('txt2img', JSON.stringify({ inputs: prompt }));
  if (r.ok) return res.status(200).type(r.contentType).send(r.data);
  if (!r.skip) return res.status(400).json({ error: r.error, format: 'txt2img', model: spaceId });

  console.error(`[PROXY] ALL FORMATS FAILED for ${spaceId}`);
  return res.status(502).json({
    error: `Tous les formats ont echoue pour ${spaceId}. Verifiez que le modele existe sur api-inference.huggingface.co/models/${spaceId} et que votre token a les droits d'acces.`,
    model: spaceId,
  });
};
