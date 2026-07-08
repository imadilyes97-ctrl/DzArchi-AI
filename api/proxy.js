// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
// Résout CORS : navigateur → même domaine Vercel → api-inference.hf.co
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { spaceId, prompt, image, token } = req.body;
  if (!spaceId || !prompt || !token) {
    return res.status(400).json({ error: 'Missing spaceId, prompt, or token' });
  }

  // Helper fetch avec timeout
  const fetchHF = async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      return await fetch(`https://api-inference.huggingface.co/models/${spaceId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // Construire les body à essayer
  const bodies = [];

  // img2img (JSON avec image en base64)
  if (image) {
    bodies.push({ name: 'img2img', body: JSON.stringify({ inputs: prompt, image }) });
    bodies.push({ name: 'img2img v2', body: JSON.stringify({ inputs: prompt, parameters: { image } }) });
  }

  // text-to-image
  bodies.push({ name: 'txt2img', body: JSON.stringify({ inputs: prompt }) });

  for (const fmt of bodies) {
    try {
      const hfResp = await fetchHF(fmt.body);

      // 503 = model loading → retry
      if (hfResp.status === 503) {
        for (let r = 0; r < 6; r++) {
          await new Promise(s => setTimeout(s, 10000));
          const retryResp = await fetchHF(fmt.body);
          if (retryResp.status === 200) {
            const buf = await retryResp.arrayBuffer();
            res.setHeader('Content-Type', retryResp.headers.get('content-type') || 'image/png');
            return res.status(200).send(Buffer.from(buf));
          }
          if (retryResp.status !== 503) {
            const txt = await retryResp.text().catch(() => '');
            return res.status(retryResp.status).json({ error: txt.substring(0, 500), format: fmt.name, model: spaceId });
          }
        }
        continue; // 503 après 6 retries → essayer autre format
      }

      // 200 = succès
      if (hfResp.status === 200) {
        const buf = await hfResp.arrayBuffer();
        if (buf.byteLength < 500) continue; // image vide → essayer autre format
        res.setHeader('Content-Type', hfResp.headers.get('content-type') || 'image/png');
        return res.status(200).send(Buffer.from(buf));
      }

      // Erreur
      const txt = await hfResp.text().catch(() => '');
      let errMsg;
      try { const j = JSON.parse(txt); errMsg = j.error || txt; } catch { errMsg = txt; }
      if (!errMsg) errMsg = `HTTP ${hfResp.status}`;

      // 404 → essayer format suivant
      if (hfResp.status === 404) continue;
      // 400 → essayer format suivant
      if (hfResp.status === 400) continue;
      // 401/403 = token invalide ou gated → stop
      if (hfResp.status === 401 || hfResp.status === 403) {
        return res.status(hfResp.status).json({ error: errMsg.substring(0, 300), format: fmt.name, model: spaceId });
      }
      // Autre → stop
      return res.status(hfResp.status).json({ error: errMsg.substring(0, 300), format: fmt.name, model: spaceId });

    } catch (e) {
      continue; // erreur réseau → essayer format suivant
    }
  }

  return res.status(502).json({
    error: 'Tous les formats API HF ont échoué pour ce modèle',
    model: spaceId,
  });
};
