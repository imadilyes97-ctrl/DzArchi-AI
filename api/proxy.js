// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
const https = require('https');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { spaceId, prompt, image, imageUri, token } = req.body;
  if (!spaceId || !prompt || !token) {
    return res.status(400).json({ error: 'Missing spaceId, prompt, or token' });
  }

  const callHF = (bodyObj) => new Promise((resolve) => {
    try {
      const bodyBuf = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
      const opts = {
        hostname: 'api-inference.huggingface.co',
        path: '/models/' + spaceId, port: 443, method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': bodyBuf.length,
        },
        timeout: 25000,
      };
      const r = https.request(opts, (hfResp) => {
        const chunks = [];
        hfResp.on('data', c => chunks.push(c));
        hfResp.on('end', () => resolve({ status: hfResp.statusCode, data: Buffer.concat(chunks) }));
      });
      r.on('error', e => resolve({ status: 0, error: e.message }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
      r.write(bodyBuf);
      r.end();
    } catch (e) { resolve({ status: 0, error: e.message }); }
  });

  const parseErr = (buf) => {
    const s = buf.toString('utf-8');
    try { return (JSON.parse(s).error || s).substring(0, 300); } catch { return s.substring(0, 300); }
  };

  // Essayer tous les formats : raw base64, data URI, texte seul
  const attempts = [];
  const imgs = [];
  if (image) imgs.push(image);
  if (imageUri && !imgs.includes(imageUri)) imgs.push(imageUri);

  for (const i of imgs) {
    attempts.push({ label: 'img2img-raw', body: { inputs: prompt, image: i } });
    attempts.push({ label: 'img2img-params', body: { inputs: prompt, parameters: { image: i } } });
  }
  attempts.push({ label: 'txt2img', body: { inputs: prompt } });

  for (const a of attempts) {
    const r = await callHF(a.body);
    if (r.status === 200) {
      if (r.data.length >= 500) {
        res.setHeader('Content-Type', 'image/png');
        return res.status(200).send(r.data);
      }
      continue;
    }
    if (r.status === 0) continue;
    if (r.status === 503) {
      for (let retry = 0; retry < 2; retry++) {
        await new Promise(s => setTimeout(s, 10000));
        const r2 = await callHF(a.body);
        if (r2.status === 200 && r2.data.length >= 500) {
          res.setHeader('Content-Type', 'image/png');
          return res.status(200).send(r2.data);
        }
      }
      continue;
    }
    if (r.status === 400 || r.status === 404) continue;
    if (r.status === 401 || r.status === 403) {
      return res.status(r.status).json({ error: parseErr(r.data), model: spaceId });
    }
    return res.status(400).json({ error: parseErr(r.data), format: a.label, model: spaceId });
  }

  return res.status(502).json({
    error: 'Tous les formats ont echoue pour ' + spaceId + '. Verifiez que le modele existe sur huggingface.co/models/' + spaceId + ' et que le token HF est valide.',
    model: spaceId,
  });
};
