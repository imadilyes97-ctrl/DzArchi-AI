// ═══════════════════════════════════════════════════════════════════
//  DzArchi AI — Proxy Node.js vers l'API Inference Hugging Face
// ═══════════════════════════════════════════════════════════════════
//  Problème: api-inference.huggingface.co est bloqué DNS en Algérie.
//  Solution: Proxy local Node.js avec DNS personnalisé (8.8.8.8).
//
//  Usage:
//    1. cd C:\Users\imad\Documents\architecture\dzarchi-ai\proxy
//    2. node proxy.js
//    3. Dans index.html, mettre l'URL du proxy dans le champ Space ID
//       Exemple: http://localhost:3457/api/hf
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const dns = require('dns');
const url = require('url');
const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────
const PORT = 3457;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Utiliser Google DNS pour contourner le blocage ISP
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  console.log('✅ DNS personnalisé: 8.8.8.8, 1.1.1.1');
} catch (e) {
  console.log('⚠️ DNS personnalisé impossible:', e.message);
}

// ─── Force DNS lookup via 8.8.8.8 ────────────────────────────────────
const ORIGINAL_LOOKUP = dns.lookup;
// Patch https module to use our DNS
const origCreateConnection = https.Agent.prototype.createConnection;

// ─── Helper: résoudre DNS nous-mêmes ─────────────────────────────────
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    dns.resolve4(host, { ttl: false }, (err, addresses) => {
      if (err) {
        reject(err);
      } else {
        resolve(addresses[0]); // Prendre la première IP
      }
    });
  });
}

// ─── Helper: appeler l'API HF avec IP résolue manuellement ──────────
function callHFAPI(modelId, bodyObj, token) {
  return new Promise(async (resolve, reject) => {
    try {
      const ip = await resolveHost('api-inference.huggingface.co');
      console.log(`  DNS: api-inference.huggingface.co → ${ip}`);

      const postData = JSON.stringify(bodyObj);
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const opts = {
        hostname: ip,
        port: 443,
        path: `/models/${modelId}`,
        method: 'POST',
        headers,
        rejectUnauthorized: false, // Désactiver vérification SNI (IP ≠ hostname)
        servername: 'api-inference.huggingface.co', // SNI correct
        timeout: 120000,
      };

      const req = https.request(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] || '';
          const isImage = contentType.includes('image');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: isImage ? data : data.toString('utf-8'),
            isImage,
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout 120s')); });
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Serveur HTTP ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ─── GET / → status ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({
      status: 'running',
      proxy: 'DzArchi AI Proxy — HF API Inference',
      port: PORT,
      dns: '8.8.8.8, 1.1.1.1',
    }));
    return;
  }

  // ─── POST /api/hf → proxy vers HF API ────────────────────────────
  if (req.method === 'POST' && pathname === '/api/hf') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { modelId, prompt, image, token } = JSON.parse(body);
        if (!modelId || !prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ error: 'Missing modelId or prompt' }));
          return;
        }

        console.log(`\n📡 ${modelId}`);
        const attempts = [];

        // img2img
        if (image) {
          attempts.push(
            { name: 'img2img', body: { inputs: prompt, image } },
            { name: 'img2img-params', body: { inputs: prompt, parameters: { image } } },
          );
        }
        // txt2img fallback
        attempts.push({ name: 'txt2img', body: { inputs: prompt } });

        for (const a of attempts) {
          console.log(`  Trying ${a.name}...`);
          const result = await callHFAPI(modelId, a.body, token);

          if (result.isImage && result.status === 200) {
            console.log(`  ✅ ${a.name} → ${result.data.length} bytes`);
            res.writeHead(200, {
              'Content-Type': result.headers['content-type'] || 'image/png',
              ...CORS_HEADERS,
            });
            res.end(result.data);
            return;
          }

          if (result.status === 503) {
            // Cold start — retry 3x
            console.log(`  ⏳ ${a.name} → 503, retrying...`);
            for (let r = 0; r < 3; r++) {
              await new Promise(s => setTimeout(s, 15000));
              const retry = await callHFAPI(modelId, a.body, token);
              if (retry.isImage && retry.status === 200) {
                console.log(`  ✅ ${a.name} (retry ${r+1}) → ${retry.data.length} bytes`);
                res.writeHead(200, {
                  'Content-Type': retry.headers['content-type'] || 'image/png',
                  ...CORS_HEADERS,
                });
                res.end(retry.data);
                return;
              }
              if (retry.status !== 503) break;
            }
            continue;
          }

          const text = result.isImage ? `image (${result.data.length} bytes)` : result.data.slice(0, 200);
          console.log(`  ⚠️ ${a.name} → ${result.status}: ${text}`);
        }

        res.writeHead(502, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({
          error: 'Tous les essais ont échoué',
          model: modelId,
        }));

      } catch (e) {
        console.error('  ❌', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   DzArchi AI — Proxy HF API Inference               ║
║                                                     ║
║   DNS: 8.8.8.8 / 1.1.1.1 (bypass ISP)              ║
║   Endpoint: http://localhost:${PORT}/api/hf          ║
║                                                     ║
║   Usage dans index.html:                            ║
║     Mettre http://localhost:${PORT}/api/hf            ║
║     dans le champ \"Space ID\" + cliquer Générer       ║
║                                                     ║
║   Ctrl+C pour arrêter                                ║
╚════════════════════════════════════════════════════╝
  `);
});
