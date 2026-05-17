# My Dude Streaming Bridge

Local Node bridge for the live My Dude speaker agent.

- Public route: `wss://bridge.mydude.live/speak`
- Health route: `https://bridge.mydude.live/health`
- Runtime model: `github-copilot/gpt-4o-mini`
- Local service path on Fast Panda: `/home/josh/.openclaw/bridge/mydude-bridge.mjs`
- Agent self files: `/home/josh/.openclaw/bridge/mydude-speaker-agent/`

The browser never receives Josh's GitHub/Copilot auth. The bridge reads the existing server-side OpenClaw GitHub Copilot auth profile, exchanges it for a Copilot chat token, and streams deltas back over the WebSocket.

The frontend speaks streamed sentence/phrase chunks immediately with browser-native TTS. Avatar building now runs in parallel, so perceived voice latency is bounded by WebSocket setup + LLM first delta + first browser speech chunk rather than by the full agent/tool/build cycle.

Current smoke evidence from `bridge.mydude.live/speak`: first streamed delta around ~1.5s and total reply around ~1.6s on `github-copilot/gpt-4o-mini`.
