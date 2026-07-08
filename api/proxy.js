// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
// Utilise https.request (natif Node) au lieu de fetch (instable sur Vercel)
const https = require('https');

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

  // Helper: appel HTTPS vers HF Inference API
  const callHF = (bodyData) => {
    return new Promise((resolve) => {
      const b = Buffer.from(JSON.stringify(bodyData), 'utf-8');
      const url = new URL(`https://api-inference.huggingface.co/models/${spaceId}`);
      const opts = {
        hostname: url.hostname, path: url.pathname, port: 443, method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': b.length,
        },
        timeout: 30000,
      };
      const r = https.request(opts, (hfResp) => {
        const chunks = [];
        hfResp.on('data', c => chunks.push(c));
        hfResp.on('end', () => {
          const full = Buffer.concat(chunks);
          resolve({ status: hfResp.statusCode, headers: hfResp.headers, data: full });
        });
      });
      r.on('error', (e) => resolve({ status: 0, error: e.message }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'Timeout 30s' }); });
      r.write(b);
      r.end();
    });
  };

  // Defilement des formats
  const formats = [];

  if (image) {
    formats.push({ name: 'img2img', body: { inputs: prompt, image } });
    formats.push({ name: 'img2img-v2', body: { inputs: prompt, parameters: { image } } });
  }
  formats.push({ name: 'txt2img', body: { inputs: prompt } });

  for (const fmt of formats) {
    const r = await callHF(fmt.body);

    if (r.status === 0) {
      // Erreur reseau — continuer au format suivant
      continue;
    }

    // 503 = model loading → petit retry
    if (r.status === 503) {
      for (let retry = 0; retry < 2; retry++) {
        await new Promise(s => setTimeout(s, 8000));
        const r2 = await callHF(fmt.body);
        if (r2.status === 200 && r2.data.length >= 500) {
          res.setHeader('Content-Type', r2.headers['content-type'] || 'image/png');
          return res.status(200).send(r2.data);
        }
        if (r2.status !== 503 && r2.status !== 0) {
          break;
        }
      }
      continue;
    }

    // 200 = succes
    if (r.status === 200) {
      if (r.data.length < 500) continue;
      res.setHeader('Content-Type', r.headers['content-type'] || 'image/png');
      return res.status(200).send(r.data);
    }

    // Erreur HTTP
    let errMsg;
    try { const j = JSON.parse(r.data.toString('utf-8')); errMsg = j.error || r.data.toString('utf-8'); }
    catch { errMsg = r.data.toString('utf-8'); }
    if (!errMsg) errMsg = `HTTP ${r.status}`;

    // 400/404 = format non supporte → continuer
    if (r.status === 400 || r.status === 404) continue;

    // 401/403 = token invalide ou gated
    if (r.status === 401 || r.status === 403) {
      const isGated = errMsg.toLowerCase().includes('gated');
      return res.status(r.status).json({
        error: isGated
          ? `Modele gated: acceptez les termes sur huggingface.co/${spaceId}`
          : `Token HF invalide/insuffisant: ${errMsg.substring(0, 200)}`,
        model: spaceId,
      });
    }

    // Autre erreur
    return res.status(r.status).json({ error: errMsg.substring(0, 300), model: spaceId });
  }

  return res.status(502).json({
    error: `Tous les formats ont echoue pour ${spaceId}. Verifiez que le modele existe et que le token a acces.`,
    model: spaceId,
  });
};
