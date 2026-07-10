// Cloudflare Worker — Utilise Workers AI direct (pas de HF API)
// Pas de DNS bloque, pas de token HF necessaire
// Necessite: binding AI (Settings → Variables → AI Bindings → Add)

export default {
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json', ...cors } });
    }

    const body = await request.json().catch(() => ({}));
    const { prompt, image } = body;
    if (!prompt) return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

    try {
      // img2img avec l'image uploadée
      if (image) {
        const b64 = image.includes('base64,') ? image.split('base64,')[1] : image;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const result = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
          image: [...bytes], prompt,
          negative_prompt: 'low quality, blurry, bad architecture',
          num_steps: 30, guidance: 7.5,
        });
        const out = result.image || result;
        return new Response(out instanceof Uint8Array ? out : new Uint8Array(Object.values(out)), {
          status: 200, headers: { 'Content-Type': 'image/png', ...cors },
        });
      }

      // txt2img fallback (FLUX)
      const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt, negative_prompt: 'low quality, blurry', num_steps: 20, guidance: 7,
      });
      const out = result.image || result;
      return new Response(out instanceof Uint8Array ? out : new Uint8Array(Object.values(out)), {
        status: 200, headers: { 'Content-Type': 'image/png', ...cors },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'AI Error' }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
  },
};
