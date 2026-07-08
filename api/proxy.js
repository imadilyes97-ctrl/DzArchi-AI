// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
const https = require('https');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { spaceId, prompt, image, imageUri, token } = req.body;
  if (!spaceId || !prompt || !token)
    return res.status(400).json({ error: 'Missing spaceId, prompt, or token' });

  const callHF = (bodyObj, timeoutMs = 60000) => new Promise((resolve) => {
    try {
      const b = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
      const path = '/models/' + spaceId;
      const opts = {
        hostname: 'api-inference.huggingface.co',
        path, port: 443, method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': b.length,
        },
        timeout: timeoutMs,
      };
      const r = https.request(opts, (hfResp) => {
        const chunks = [];
        hfResp.on('data', c => chunks.push(c));
        hfResp.on('end', () => resolve({ status: hfResp.statusCode, data: Buffer.concat(chunks) }));
      });
      r.on('error', e => resolve({ status: 0, error: e.message }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
      r.write(b);
      r.end();
    } catch (e) { resolve({ status: 0, error: e.message }); }
  });

  const parseErr = (buf) => {
    const s = buf.toString('utf-8').trim();
    if (!s) return '(empty)';
    try { return (JSON.parse(s).error || s).substring(0, 300); } catch { return s.substring(0, 300); }
  };

  const attempts = [];
  if (image) attempts.push({ l: 'img2img-raw', b: { inputs: prompt, image } });
  if (image && imageUri) attempts.push({ l: 'img2img-meta', b: { inputs: prompt, parameters: { image } } });
  if (imageUri) { attempts.push({ l: 'img2img-uri', b: { inputs: prompt, image: imageUri } }); }
  attempts.push({ l: 'txt2img', b: { inputs: prompt } });

  let hfCode = 0, hfMsg = '';

  for (const a of attempts) {
    const r = await callHF(a.b);
    if (r.status === 200 && r.data.length >= 500) {
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(r.data);
    }
    if (r.status === 503) {
      for (let retry = 0; retry < 3; retry++) {
        await new Promise(s => setTimeout(s, 12000));
        const r2 = await callHF(a.b);
        if (r2.status === 200 && r2.data.length >= 500) {
          res.setHeader('Content-Type', 'image/png');
          return res.status(200).send(r2.data);
        }
      }
    }
    hfCode = r.status || 0;
    hfMsg = r.error || parseErr(r.data) || ('HTTP ' + r.status);
    if (r.status === 400 || r.status === 404) continue;
    if (r.status === 0) continue;
    return res.status(400).json({ error: hfMsg, format: a.l, model: spaceId });
  }

  return res.status(502).json({
    error: hfMsg || 'Tous les formats ont echoue',
    details: 'code=' + hfCode + ' model=' + spaceId,
    model: spaceId,
  });
};
