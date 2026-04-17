/**
 * Cloudflare Worker — Proxy CORS para Todoist y Notion
 * Resuelve el bloqueo CORS al llamar a APIs externas desde el navegador.
 *
 * Deploy: https://dash.cloudflare.com → Workers & Pages → Create Worker
 * Rutas:
 *   /todoist/* → https://api.todoist.com/api/v1/*
 *   /notion/*  → https://api.notion.com/v1/*
 */

const ALLOWED_ORIGIN = 'https://donatowriter-stack.github.io';
const TODOIST_BASE   = 'https://api.todoist.com/api/v1';
const NOTION_BASE    = 'https://api.notion.com/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Notion-Version',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ── Preflight (OPTIONS) ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let targetUrl;

    if (url.pathname.startsWith('/todoist/')) {
      const path = url.pathname.replace('/todoist', '');
      targetUrl = TODOIST_BASE + path + url.search;

    } else if (url.pathname.startsWith('/notion/')) {
      const path = url.pathname.replace('/notion', '');
      targetUrl = NOTION_BASE + path + url.search;

    } else {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    // Reenviamos la petición tal cual (método, headers, body)
    const proxyRequest = new Request(targetUrl, {
      method:  request.method,
      headers: request.headers,
      body:    request.method !== 'GET' ? request.body : undefined,
    });

    try {
      const response   = await fetch(proxyRequest);
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
