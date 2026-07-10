// ─── Cloudflare Worker → API Inference Hugging Face ──────────────
// Deploy: wrangler deploy
// Proxy bypass: CORS + DNS (Cloudflare n'a pas les restrictions Vercel)
// Fix img2img format: HF API attend l'image en inputs et prompt en parameters

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

    const body = await request.json().catch(() => ({}));
    // Compatible: modelId (nouveau) OU spaceId (ancien)
    const modelId = body.modelId || body.spaceId;
    const { prompt, image, token } = body;
    if (!modelId || !prompt || !token) {
      return new Response(JSON.stringify({ error: 'Missing modelId, prompt, or token' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Helper: appel API HF avec timeout
    const callHF = async (bodyObj, signal) => {
      const resp = await fetch(`https://api-inference.huggingface.co/models/${modelId_}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyObj),
        signal,
      });
      const contentType = resp.headers.get('content-type') || '';
      const isImage = contentType.includes('image');
      const data = isImage ? new Uint8Array(await resp.arrayBuffer()) : await resp.text();
      return { status: resp.status, data, isImage, contentType };
    };

    // Stratégie A: img2img (image + prompt)
    if (image) {
      // Format HF API pour img2img:
      // { "inputs": image_base64, "parameters": { "prompt": "..." } }
      const cleanB64 = image.includes('base64,') ? image.split('base64,')[1] : image;
      const img2imgBody = {
        inputs: cleanB64,
        parameters: {
          prompt: prompt,
          negative_prompt: "low quality, blurry, distorted, ugly",
          num_inference_steps: 30,
          guidance_scale: 7.5,
        }
      };

      // Essai avec retry 503 (cold start)
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);

          const r = await callHF(img2imgBody, controller.signal);
          clearTimeout(timeout);

          if (r.status === 200 && r.isImage && r.data.length > 500) {
            return new Response(r.data, {
              status: 200,
              headers: { 'Content-Type': r.contentType || 'image/png', ...corsHeaders },
            });
          }

          // 503 = chargement → attendre et réessayer
          if (r.status === 503 && attempt < 3) {
            await new Promise(s => setTimeout(s, 15000));
            continue;
          }

          // 401/403 = token invalide → stop immédiat
          if (r.status === 401 || r.status === 403) {
            const err = typeof r.data === 'string' ? r.data : 'Token invalide';
            return new Response(JSON.stringify({ error: err.substring(0, 300) }), {
              status: r.status,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          // Autre erreur → essayer format alternatif
          if (r.status !== 200) break;

        } catch (e) {
          if (e.name === 'AbortError') continue;
          // Network error → essayer format alternatif
          break;
        }
      }

      // Format alternatif: prompt en header (certains modèles)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const r = await callHF({
          inputs: cleanB64,
          parameters: { prompt: prompt }
        }, controller.signal);
        clearTimeout(timeout);

        if (r.status === 200 && r.isImage && r.data.length > 500) {
          return new Response(r.data, {
            status: 200,
            headers: { 'Content-Type': r.contentType || 'image/png', ...corsHeaders },
          });
        }
      } catch {}
    }

    // Stratégie B: txt2img (prompt seulement, pas d'image)
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const r = await callHF({ inputs: prompt }, controller.signal);
        clearTimeout(timeout);

        if (r.status === 200 && r.isImage && r.data.length > 500) {
          return new Response(r.data, {
            status: 200,
            headers: { 'Content-Type': r.contentType || 'image/png', ...corsHeaders },
          });
        }

        if (r.status === 503 && attempt < 3) {
          await new Promise(s => setTimeout(s, 15000));
          continue;
        }

        if (r.status === 401 || r.status === 403) {
          return new Response(JSON.stringify({ error: 'Token invalide' }), {
            status: r.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        break;
      } catch {
        continue;
      }
    }

    return new Response(JSON.stringify({
      error: `Tous les formats ont échoué pour ${modelId_}. Vérifiez le token ou l'ID du modèle.`,
      model: modelId,
    }), { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  },
};
