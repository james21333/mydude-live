import manifest from '../dist/.vite/manifest.json' assert { type: 'json' };

const ROOT_DOMAIN = 'mydude.live';
const ENTRY = Object.values(manifest).find((item) => item.isEntry);
const JS_FILE = ENTRY?.file || 'assets/index.js';
const CSS_FILES = ENTRY?.css || [];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const assetResponse = await env.ASSETS?.fetch(request);
    if (assetResponse && assetResponse.status !== 404) return assetResponse;
    return new Response(renderShell(url.hostname.toLowerCase()), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' }
    });
  }
};

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
