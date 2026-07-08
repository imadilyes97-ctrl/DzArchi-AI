// ─── Proxy Vercel → API Inference Hugging Face ──────────────────────
// Résout le problème CORS : le navigateur appelle le même domaine (Vercel),
// et Vercel forwarde à api-inference.huggingface.co (serveur → serveur, pas de CORS)
export default async function handler(req, res) {
  // CORS (au cas où l'appel vient d'un autre domaine)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { spaceId, prompt, image, token, mode } = req.body;
  if (!spaceId || !prompt || !token) {
    return res.status(400).json({ error: 'Missing spaceId, prompt, or token' });
  }

  // Essayer plusieurs formats
  const formats = [];

  // Format 1: img2img JSON (image + inputs)
  if (image) {
    formats.push({
      name: 'img2img',
      opts: () => ({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: prompt, image }),
      }),
    });
    formats.push({
      name: 'img2img v2',
      opts: () => ({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { image },
        }),
      }),
    });
  }

  // Format 2: text-to-image
  formats.push({
    name: 'txt2img',
    opts: () => ({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt }),
    }),
  });

  for (const fmt of formats) {
    try {
      const hfResp = await fetch(
        `https://api-inference.huggingface.co/models/${spaceId}`,
        fmt.opts()
      );

      // 503 = model loading → retry
      if (hfResp.status === 503) {
        for (let r = 0; r < 6; r++) {
          await new Promise(s => setTimeout(s, 10000));
          const retryResp = await fetch(
            `https://api-inference.huggingface.co/models/${spaceId}`,
            fmt.opts()
          );
          if (retryResp.status === 200) {
            const buffer = await retryResp.arrayBuffer();
            res.setHeader('Content-Type', retryResp.headers.get('content-type') || 'image/png');
            return res.status(200).send(Buffer.from(buffer));
          }
          if (retryResp.status !== 503) {
            const errText = await retryResp.text().catch(() => '');
            return res.status(retryResp.status).json({
              error: errText.substring(0, 500),
              format: fmt.name,
              model: spaceId,
            });
          }
        }
        // Après 6 retries, 503 toujours → passer au format suivant
        continue;
      }

      // 200 = succès
      if (hfResp.status === 200) {
        const buffer = await hfResp.arrayBuffer();
        if (buffer.byteLength < 500) {
          // Image vide → essayer format suivant
          continue;
        }
        res.setHeader('Content-Type', hfResp.headers.get('content-type') || 'image/png');
        return res.status(200).send(Buffer.from(buffer));
      }

      // Erreur
      const errText = await hfResp.text().catch(() => '');
      const errData = (() => { try { return JSON.parse(errText); } catch { return null; } })();
      const errMsg = errData?.error || errText.substring(0, 300) || `HTTP ${hfResp.status}`;

      // 404 = format non supporté → essayer suivant
      if (hfResp.status === 404) {
        continue;
      }

      // 401/403 = token invalide ou gated → stop tout de suite
      if (hfResp.status === 401 || hfResp.status === 403) {
        return res.status(hfResp.status).json({
          error: errMsg,
          format: fmt.name,
          model: spaceId,
        });
      }

      // 400 = bad request (mauvais format) → essayer suivant
      if (hfResp.status === 400) {
        continue;
      }

      // Autre erreur
      return res.status(hfResp.status).json({
        error: errMsg,
        format: fmt.name,
        model: spaceId,
      });

    } catch (fetchErr) {
      // Erreur réseau → essayer format suivant
      continue;
    }
  }

  // Tous les formats ont échoué
  return res.status(502).json({
    error: 'Tous les formats API HF ont échoué pour ce modèle',
    model: spaceId,
  });
}
