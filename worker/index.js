export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST' || url.pathname !== '/api/hf') return new Response(JSON.stringify({ error: 'POST /api/hf only' }), { status: 405, headers: { 'Content-Type': 'application/json', ...cors } });

    const body = await request.json().catch(() => ({}));
    const modelId = body.modelId || body.spaceId;
    const { prompt, image, token } = body;
    if (!modelId || !prompt || !token) return new Response(JSON.stringify({ error: 'Missing modelId, prompt, or token' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

    const callHF = async (obj, sig) => {
      const r = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(obj), signal: sig });
      const img = r.headers.get('content-type')?.includes('image');
      return { s: r.status, d: img ? new Uint8Array(await r.arrayBuffer()) : await r.text(), img, ct: r.headers.get('content-type') || 'image/png' };
    };

    // img2img (utilise l'image uploadée)
    if (image) {
      const b64 = image.includes('base64,') ? image.split('base64,')[1] : image;
      for (let i = 0; i < 4; i++) {
        try {
          const c = new AbortController(); const t = setTimeout(() => c.abort(), 60000);
          const r = await callHF({ inputs: b64, parameters: { prompt, negative_prompt: "low quality, blurry", num_inference_steps: 30, guidance_scale: 7.5 } }, c.signal);
          clearTimeout(t);
          if (r.s === 200 && r.img && r.d.length > 500) return new Response(r.d, { status: 200, headers: { 'Content-Type': r.ct, ...cors } });
          if (r.s === 503 && i < 3) { await new Promise(s => setTimeout(s, 15000)); continue; }
          if (r.s === 401 || r.s === 403) return new Response(JSON.stringify({ error: 'Token invalide' }), { status: r.s, headers: { 'Content-Type': 'application/json', ...cors } });
          if (r.s !== 200) break;
        } catch { if (i < 3) continue; break; }
      }
    }

    // txt2img (fallback, pas d'image)
    for (let i = 0; i < 4; i++) {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 60000);
        const r = await callHF({ inputs: prompt }, c.signal);
        clearTimeout(t);
        if (r.s === 200 && r.img && r.d.length > 500) return new Response(r.d, { status: 200, headers: { 'Content-Type': r.ct, ...cors } });
        if (r.s === 503 && i < 3) { await new Promise(s => setTimeout(s, 15000)); continue; }
        if (r.s === 401 || r.s === 403) return new Response(JSON.stringify({ error: 'Token invalide' }), { status: r.s, headers: { 'Content-Type': 'application/json', ...cors } });
        break;
      } catch { continue; }
    }

    return new Response(JSON.stringify({ error: `Echec pour ${modelId}. Verifiez le token.` }), { status: 502, headers: { 'Content-Type': 'application/json', ...cors } });
  },
};
