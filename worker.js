/**
 * Cloudflare Worker — Proxy para Todoist API
 * Resuelve el bloqueo CORS al llamar a Todoist desde el navegador.
 *
 * Deploy: https://dash.cloudflare.com → Workers & Pages → Create Worker
 * Pegá este código, guardá y copiá la URL del worker en app.js (TODOIST_PROXY_URL).
 */

const ALLOWED_ORIGIN = 'https://donatowriter-stack.github.io'; // tu dominio
const TODOIST_BASE   = 'https://api.todoist.com';

// Headers CORS que se agregan a TODAS las respuestas
const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ── Preflight (OPTIONS) ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Solo aceptamos rutas /todoist/* ──
    if (!url.pathname.startsWith('/todoist/')) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    // Construimos la URL destino en Todoist
    const todoistPath = url.pathname.replace('/todoist', '');
    const todoistUrl  = TODOIST_BASE + todoistPath + url.search;

    // Reenviamos la petición tal cual (método, headers, body)
    const proxyRequest = new Request(todoistUrl, {
      method:  request.method,
      headers: request.headers,
      body:    request.method !== 'GET' ? request.body : undefined,
    });

    try {
      const response = await fetch(proxyRequest);

      // Clonamos headers y añadimos CORS
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

      return new Response(response.body, {
        status:  response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status:  502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
