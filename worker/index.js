// Cloudflare Worker — Proxy HF Inference (compatible img2img + txt2img)
// Utilise l'API REST Cloudflare Workers AI (pas de DNS externe)

export default {
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    // NORMALISE le chemin: supprime les doubles slashes
    const path = url.pathname.replace(/\/+/g, '/');
    if (request.method !== 'POST' || path !== '/api/hf') {
      return new Response(JSON.stringify({ error: 'POST /api/hf only (path: ' + path + ')' }), {
        status: 405, headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const body = await request.json().catch(() => ({}));
    const modelId = body.modelId || body.spaceId;
    const { prompt, image, token } = body;
    if (!modelId || !prompt || !token) {
      return new Response(JSON.stringify({ error: 'Missing modelId, prompt, or token' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // Helper: appel API HF
    const callHF = async (obj) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const r = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
          signal: controller.signal,
        });
        const isImage = r.headers.get('content-type')?.includes('image');
        return { status: r.status, data: isImage ? new Uint8Array(await r.arrayBuffer()) : await r.text(), isImage, contentType: r.headers.get('content-type') || '' };
      } finally { clearTimeout(timeout); }
    };

    // img2img (avec l'image uploadée)
    if (image) {
      const b64 = image.includes('base64,') ? image.split('base64,')[1] : image;
      for (let i = 0; i < 4; i++) {
        const r = await callHF({ inputs: b64, parameters: { prompt, negative_prompt: 'low quality, blurry', num_inference_steps: 30, guidance_scale: 7.5 } });
        if (r.status === 200 && r.isImage && r.data.length > 500) return new Response(r.data, { status: 200, headers: { 'Content-Type': r.contentType || 'image/png', ...cors } });
        if (r.status === 503 && i < 3) { await new Promise(s => setTimeout(s, 15000)); continue; }
        if (r.status === 401 || r.status === 403) return new Response(JSON.stringify({ error: 'TOKEN_INVALIDE' }), { status: r.status, headers: { 'Content-Type': 'application/json', ...cors } });
        if (r.status !== 200) break;
      }
    }

    // txt2img (fallback sans image)
    for (let i = 0; i < 4; i++) {
      const r = await callHF({ inputs: prompt });
      if (r.status === 200 && r.isImage && r.data.length > 500) return new Response(r.data, { status: 200, headers: { 'Content-Type': r.contentType || 'image/png', ...cors } });
      if (r.status === 503 && i < 3) { await new Promise(s => setTimeout(s, 15000)); continue; }
      if (r.status === 401 || r.status === 403) return new Response(JSON.stringify({ error: 'TOKEN_INVALIDE' }), { status: r.status, headers: { 'Content-Type': 'application/json', ...cors } });
      break;
    }

    return new Response(JSON.stringify({ error: `Echec ${modelId}. Verifiez le token.` }), { status: 502, headers: { 'Content-Type': 'application/json', ...cors } });
  },
};
