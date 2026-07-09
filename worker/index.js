// ─── Cloudflare Worker → API Inference Hugging Face ──────────────
// Deploy: wrangler deploy
// Proxy bypass: CORS + DNS (Cloudflare n'a pas les restrictions Vercel)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST' || url.pathname !== '/api/hf') {
      return new Response(JSON.stringify({ error: 'POST /api/hf only' }), {
        status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Parse body
    const body = await request.json().catch(() => ({}));
    const { spaceId, prompt, image, token } = body;
    if (!spaceId || !prompt || !token) {
      return new Response(JSON.stringify({ error: 'Missing spaceId, prompt, or token' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Helper: appeler l'API HF
    const callHF = async (bodyObj) => {
      const resp = await fetch(`https://api-inference.huggingface.co/models/${spaceId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyObj),
      });
      const contentType = resp.headers.get('content-type') || '';
      const isImage = contentType.includes('image');
      const data = isImage ? new Uint8Array(await resp.arrayBuffer()) : await resp.text();
      return { status: resp.status, data, isImage, contentType };
    };

    // Essayer img2img puis txt2img
    const attempts = [];
    if (image) {
      attempts.push({ n: 'img2img', b: { inputs: prompt, image } });
      attempts.push({ n: 'img2img-p', b: { inputs: prompt, parameters: { image } } });
    }
    attempts.push({ n: 'txt2img', b: { inputs: prompt } });

    for (const a of attempts) {
      let r;
      try { r = await callHF(a.b); } catch { continue; }

      // 503 = loading → retry
      if (r.status === 503) {
        for (let rt = 0; rt < 3; rt++) {
          await new Promise(s => setTimeout(s, 15000));
          try { r = await callHF(a.b); } catch { continue; }
          if (r.status === 200 && r.isImage && r.data.length > 500) {
            return new Response(r.data, {
              status: 200,
              headers: { 'Content-Type': r.contentType || 'image/png', ...corsHeaders },
            });
          }
        }
        continue;
      }

      // 200 = success
      if (r.status === 200 && r.isImage && r.data.length > 500) {
        return new Response(r.data, {
          status: 200,
          headers: { 'Content-Type': r.contentType || 'image/png', ...corsHeaders },
        });
      }

      // 401/403 = stop
      if (r.status === 401 || r.status === 403) {
        const err = typeof r.data === 'string' ? r.data : 'Auth error';
        return new Response(JSON.stringify({ error: err.substring(0, 300), model: spaceId }), {
          status: r.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 400/404 = format non supporte → continuer
      if (r.status === 400 || r.status === 404) continue;

      // Autre erreur
      return new Response(JSON.stringify({ error: `HF HTTP ${r.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      error: `Tous les formats echoues pour ${spaceId}. Verifiez le token.`,
      model: spaceId,
    }), { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  },
};
