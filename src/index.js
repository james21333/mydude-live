const ROOT_DOMAIN = "mydude.live";

const ACTIVE_PROJECTS = [
  {
    name: "clawtest",
    url: "https://clawtest.mydude.live",
    description: "Wildcard routing smoke test for autonomous OpenClaw projects."
  },
  {
    name: "testproject",
    url: "https://testproject.mydude.live",
    description: "Example generated project namespace."
  }
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const subdomain = getSubdomain(hostname);

    if (!subdomain) {
      return htmlResponse(renderRootLanding());
    }

    return htmlResponse(renderProjectPage(subdomain));
  }
};

function getSubdomain(hostname) {
  if (hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}`) {
    return "";
  }

  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    const subdomain = hostname.slice(0, -1 * (`.${ROOT_DOMAIN}`).length);
    return sanitizeSubdomain(subdomain);
  }

  // Local preview fallback: /?project=name or first localhost label.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }

  return sanitizeSubdomain(hostname.split(".")[0] || "");
}

function sanitizeSubdomain(value) {
  return value
    .replace(/[^a-z0-9-]/gi, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function htmlResponse(markup) {
  return new Response(markup, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60"
    }
  });
}

function renderRootLanding() {
  const projectCards = ACTIVE_PROJECTS.map(
    (project) => `
      <a class="project-card" href="${escapeHtml(project.url)}">
        <span class="project-name">${escapeHtml(project.name)}</span>
        <span class="project-description">${escapeHtml(project.description)}</span>
      </a>`
  ).join("");

  return pageShell({
    title: "mydude.live AI Ecosystem",
    background: "radial-gradient(circle at top, #26324f 0%, #0b1020 46%, #05070d 100%)",
    body: `
      <main class="root-shell">
        <p class="eyebrow">OpenClaw Launch Surface</p>
        <h1>mydude.live AI Ecosystem</h1>
        <p class="lede">A wildcard domain for launching lightweight AI projects, experiments, and autonomous app fronts.</p>
        <section class="project-list" aria-label="Active projects">
          <h2>Active Projects</h2>
          <div class="project-grid">${projectCards}</div>
        </section>
      </main>`
  });
}

function renderProjectPage(subdomain) {
  const displayName = toDisplayName(subdomain || "unknown");
  const colors = colorsFromName(subdomain || "unknown");

  return pageShell({
    title: `${displayName} | mydude.live`,
    background: `linear-gradient(135deg, ${colors.start}, ${colors.mid} 48%, ${colors.end})`,
    body: `
      <main class="project-shell">
        <div class="orb" aria-hidden="true"></div>
        <p class="eyebrow">Live Wildcard Project</p>
        <h1>Welcome to Project: ${escapeHtml(displayName)}</h1>
        <p class="lede">Generated autonomously by OpenClaw.</p>
        <div class="meta-card">
          <span>Hostname-routed app</span>
          <strong>${escapeHtml(subdomain)}.${ROOT_DOMAIN}</strong>
        </div>
      </main>`
  });
}

function pageShell({ title, background, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: #f8fafc;
      background: ${background};
      display: grid;
      place-items: center;
      padding: 28px;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: -30%;
      background: radial-gradient(circle, rgba(255,255,255,0.09), transparent 28%);
      transform: translate3d(-12%, -10%, 0);
      animation: drift 12s ease-in-out infinite alternate;
      pointer-events: none;
    }
    main {
      position: relative;
      width: min(980px, 100%);
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(2, 6, 23, 0.62);
      box-shadow: 0 30px 100px rgba(0,0,0,0.42);
      backdrop-filter: blur(18px);
    }
    .root-shell, .project-shell { border-radius: 32px; padding: clamp(30px, 7vw, 72px); }
    .eyebrow { margin: 0 0 14px; color: #93c5fd; font-size: 0.82rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(2.4rem, 8vw, 6rem); line-height: 0.95; letter-spacing: -0.07em; }
    h2 { margin: 0 0 18px; font-size: 1rem; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.14em; }
    .lede { max-width: 680px; margin: 24px 0 0; color: #cbd5e1; font-size: clamp(1.05rem, 2.4vw, 1.35rem); line-height: 1.65; }
    .project-list { margin-top: 44px; }
    .project-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .project-card, .meta-card {
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 22px;
      background: rgba(255,255,255,0.075);
      color: inherit;
      text-decoration: none;
      padding: 20px;
    }
    .project-card { display: grid; gap: 8px; transition: transform 180ms ease, border-color 180ms ease, background 180ms ease; }
    .project-card:hover { transform: translateY(-3px); border-color: rgba(147,197,253,0.75); background: rgba(255,255,255,0.12); }
    .project-name { font-size: 1.15rem; font-weight: 800; }
    .project-description { color: #cbd5e1; line-height: 1.5; }
    .project-shell { text-align: center; }
    .project-shell .lede { margin-left: auto; margin-right: auto; }
    .meta-card { width: min(520px, 100%); margin: 34px auto 0; display: grid; gap: 8px; color: #dbeafe; }
    .meta-card span { color: #bfdbfe; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.14em; }
    .meta-card strong { font-size: clamp(1rem, 4vw, 1.5rem); overflow-wrap: anywhere; }
    .orb {
      width: 112px;
      height: 112px;
      margin: 0 auto 28px;
      border-radius: 999px;
      background: radial-gradient(circle at 35% 28%, rgba(255,255,255,0.95), rgba(147,197,253,0.58) 18%, rgba(59,130,246,0.08) 64%);
      box-shadow: 0 0 60px rgba(147,197,253,0.72), inset 0 0 34px rgba(255,255,255,0.2);
      animation: pulse 2.8s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { transform: scale(0.96); } 50% { transform: scale(1.04); } }
    @keyframes drift { to { transform: translate3d(10%, 8%, 0) rotate(8deg); } }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function colorsFromName(name) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const hue = hash % 360;
  return {
    start: `hsl(${hue}, 72%, 19%)`,
    mid: `hsl(${(hue + 42) % 360}, 78%, 24%)`,
    end: `hsl(${(hue + 96) % 360}, 84%, 13%)`
  };
}

function toDisplayName(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const testInternals = { getSubdomain, colorsFromName, toDisplayName };
