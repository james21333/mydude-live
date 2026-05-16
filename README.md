# mydude-live

Cloudflare Worker for the `mydude.live` wildcard AI ecosystem.

## Behavior

- `https://mydude.live` renders the dark-mode ecosystem landing page.
- `https://<project>.mydude.live` dynamically parses the subdomain and renders a unique project page.
- Project pages derive a deterministic background gradient from the subdomain name, so every wildcard app gets a distinct look.

## Commands

```bash
npm install
npm run build
npm run deploy
```

Cloudflare should run `npm run build` before `npx wrangler deploy`.
