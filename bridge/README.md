# My Dude Phase 2 Bridge

Local Node bridge for the live My Dude speaker agent.

- Public route: `wss://bridge.mydude.live/speak`
- Health route: `https://bridge.mydude.live/health`
- Runtime model: `github-copilot/claude-haiku-4.5`
- Local service path on Fast Panda: `/home/josh/.openclaw/bridge/mydude-bridge.mjs`
- Agent self files: `/home/josh/.openclaw/bridge/mydude-speaker-agent/`

The bridge uses GitHub Copilot direct chat completions instead of spawning a full OpenClaw agent turn. That keeps live avatar replies around ~1-2 seconds and lets the speaker update its own SOUL/PERSONALITY files when the user asks it to act or look different.
