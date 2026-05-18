import manifest from '../dist/.vite/manifest.json' assert { type: 'json' };

const ROOT_DOMAIN = 'mydude.live';
const ENTRY = Object.values(manifest).find((item) => item.isEntry);
const JS_FILE = ENTRY?.file || 'assets/index.js';
const CSS_FILES = ENTRY?.css || [];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    if (hostname === `demo2.${ROOT_DOMAIN}`) return fetchDemo2Asset(url);

    const assetResponse = await env.ASSETS?.fetch(request);
    if (assetResponse && assetResponse.status !== 404) return assetResponse;
    return new Response(renderShell(hostname), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' }
    });
  }
};

async function fetchDemo2Asset(url) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!/^\/(index\.html|assets\/[A-Za-z0-9._-]+\.(js|css|png|svg|webp|jpg|jpeg)|\.vite\/manifest\.json)$/.test(pathname)) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const upstream = `https://raw.githubusercontent.com/james21333/mydude-demo2/main/dist${pathname}`;
  const response = await fetch(upstream, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!response.ok) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': contentTypeFor(pathname),
      'cache-control': pathname === '/index.html' ? 'public, max-age=30' : 'public, max-age=60'
    }
  });
}

function contentTypeFor(pathname) {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function renderShell(hostname) {
  const subdomain = getSubdomain(hostname);
  const title = subdomain === 'demo' ? 'My Dude Demo' : subdomain ? `${displayName(subdomain)} | mydude.live` : 'mydude.live AI Ecosystem';
  const cssTags = CSS_FILES.map(file => `<link rel="stylesheet" href="/${file}">`).join('\n    ');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title>${cssTags}</head><body><div id="root"></div><script type="module" src="/${JS_FILE}"></script></body></html>`;
}

function getSubdomain(hostname) {
  if (hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}` || hostname === 'localhost' || hostname === '127.0.0.1') return '';
  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) return hostname.slice(0, -1 * (`.${ROOT_DOMAIN}`).length).replace(/[^a-z0-9-]/gi, '').slice(0, 48);
  return hostname.split('.')[0]?.replace(/[^a-z0-9-]/gi, '').slice(0, 48) || '';
}
function displayName(value) { return (value || 'unknown').split('-').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '); }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
