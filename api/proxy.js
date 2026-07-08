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

  const callHF = (bodyObj) => new Promise((resolve) => {
    try {
      const b = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
      const opts = {
        hostname: 'api-inference.huggingface.co',
        path: '/models/' + spaceId, port: 443, method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': b.length,
        },
        timeout: 25000,
      };
      const r = https.request(opts, (hfResp) => {
        const chunks = [];
        hfResp.on('data', c => chunks.push(c));
        hfResp.on('end', () => resolve({
          status: hfResp.statusCode,
          data: Buffer.concat(chunks),
          statusText: hfResp.statusMessage,
        }));
      });
      r.on('error', e => resolve({ status: 0, data: Buffer.from(e.message), statusText: '' }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, data: Buffer.from('timeout'), statusText: '' }); });
      r.write(b);
      r.end();
    } catch (e) { resolve({ status: 0, data: Buffer.from(e.message), statusText: '' }); }
  });

  const parseErr = (buf) => {
    const s = buf.toString('utf-8').trim();
    if (!s) return '(empty response)';
    try { const j = JSON.parse(s); return (j.error || s).substring(0, 300); } catch { return s.substring(0, 300); }
  };

  // Essayer img2img (raw base64 + data URI) puis txt2img
  const attempts = [];
  const imgSet = new Set();
  if (image) imgSet.add(image);
  if (imageUri) imgSet.add(imageUri);
  for (const i of imgSet) {
    attempts.push({ l: 'img2img[' + i.substring(0, 25) + ']', b: { inputs: prompt, image: i } });
    attempts.push({ l: 'img2img-v2[' + i.substring(0, 25) + ']', b: { inputs: prompt, parameters: { image: i } } });
  }
  attempts.push({ l: 'txt2img', b: { inputs: prompt } });

  const results = [];
  for (const a of attempts) {
    const r = await callHF(a.b);
    results.push({ label: a.l, status: r.status, body: a.l === 'txt2img' ? '...' : a.l.substring(0, 20) });

    if (r.status === 200) {
      if (r.data.length < 500) continue;
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(r.data);
    }
    if (r.status === 503) {
      for (let retry = 0; retry < 2; retry++) {
        await new Promise(s => setTimeout(s, 10000));
        const r2 = await callHF(a.b);
        if (r2.status === 200 && r2.data.length >= 500) {
          res.setHeader('Content-Type', 'image/png');
          return res.status(200).send(r2.data);
        }
      }
      continue;
    }
    if (r.status === 0) continue; // reseau

    // Pour 400/404, on continue mais on garde l'erreur
    if (r.status === 400 || r.status === 404) {
      results.push({ label: a.l + '_err', error: parseErr(r.data) });
      continue;
    }

    // Autre erreur (401, 403, 429, 500...)
    return res.status(400).json({
      error: 'Erreur HF (HTTP ' + r.status + '): ' + parseErr(r.data),
      format: a.l,
      model: spaceId,
    });
  }

  // Tous echoues — renvoyer les resultats detailles
  return res.status(502).json({
    error: 'Tous les formats ont echoue pour ' + spaceId,
    detail: results.map(r => r.label + (r.error ? ': ' + r.error : ' [status=' + r.status + ']')).join(' | '),
    model: spaceId,
  });
};
