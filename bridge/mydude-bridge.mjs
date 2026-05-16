import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.MYDUDE_ALLOWED_ORIGIN || 'https://demo.mydude.live';
const MODEL = 'claude-haiku-4.5';
const AGENT_DIR = '/home/josh/.openclaw/bridge/mydude-speaker-agent';
const AUTH_PROFILE = '/home/josh/.openclaw/agents/main/agent/auth-profiles.json';

let copilotTokenCache = null;

const basePersona = `You are My Dude, a live cartoon avatar speaker.
You are warm, buddy-like, funny, relaxed, and concise.
You speak out loud, so use one natural sentence unless the user clearly asks for more.
No markdown. No bullets. No stage directions. No code.
Keep most replies under 18 words.
If the user describes what the avatar should be, enthusiastically acknowledge and reflect the new identity.
If the user says how they want you to act, adopt that style immediately.`;

const ideHeaders = {
  Accept: 'application/json',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.0',
  'Copilot-Integration-Id': 'vscode-chat',
  'User-Agent': 'GitHubCopilotChat/0.26.0',
  'OpenAI-Intent': 'conversation-panel',
};

function corsHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

async function ensureAgentFiles() {
  await fs.mkdir(AGENT_DIR, { recursive: true });
  const soulPath = path.join(AGENT_DIR, 'SOUL.md');
  const personalityPath = path.join(AGENT_DIR, 'PERSONALITY.json');
  if (!existsSync(soulPath)) await fs.writeFile(soulPath, `# My Dude Speaker Soul\n\n${basePersona}\n`, 'utf8');
  if (!existsSync(personalityPath)) {
    await fs.writeFile(personalityPath, JSON.stringify({
      name: 'My Dude',
      model: `github-copilot/${MODEL}`,
      voice: 'warm buddy',
      style: ['short', 'spoken', 'playful', 'encouraging'],
      appearancePrompt: '',
      userWants: '',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  }
}

async function loadPersonality() {
  await ensureAgentFiles();
  try {
    return JSON.parse(await fs.readFile(path.join(AGENT_DIR, 'PERSONALITY.json'), 'utf8'));
  } catch {
    return { name: 'My Dude', voice: 'warm buddy', style: ['short', 'spoken', 'playful'], appearancePrompt: '', userWants: '' };
  }
}

function inferPersonalityUpdate(text, current) {
  const lower = text.toLowerCase();
  const next = { ...current, updatedAt: new Date().toISOString() };
  next.lastUserUtterance = text;
  if (/look like|make (you|him|it)|avatar|robot|cat|alien|glasses|hat|blue|green|red|purple|gold|yellow/i.test(text)) {
    next.appearancePrompt = text;
  }
  if (/act like|talk like|sound like|personality|be more|be a|you are|your vibe|your soul/i.test(text)) {
    next.userWants = text;
    if (lower.includes('funny')) next.style = [...new Set([...(next.style || []), 'funny'])];
    if (lower.includes('calm')) next.style = [...new Set([...(next.style || []), 'calm'])];
    if (lower.includes('hype') || lower.includes('excited')) next.style = [...new Set([...(next.style || []), 'hype'])];
    if (lower.includes('sarcastic')) next.style = [...new Set([...(next.style || []), 'lightly sarcastic'])];
    if (lower.includes('kid') || lower.includes('child')) next.style = [...new Set([...(next.style || []), 'kid-friendly'])];
  }
  return next;
}

async function persistPersonalityFromUser(text) {
  const current = await loadPersonality();
  const next = inferPersonalityUpdate(text, current);
  await fs.writeFile(path.join(AGENT_DIR, 'PERSONALITY.json'), JSON.stringify(next, null, 2), 'utf8');
  await fs.writeFile(path.join(AGENT_DIR, 'SOUL.md'), `# My Dude Speaker Soul\n\n${basePersona}\n\n## Current user-shaped identity\n- Voice: ${next.voice || 'warm buddy'}\n- Style: ${(next.style || []).join(', ')}\n- Appearance request: ${next.appearancePrompt || 'not set yet'}\n- Personality request: ${next.userWants || 'not set yet'}\n- Last updated: ${next.updatedAt}\n`, 'utf8');
  await fs.writeFile(path.join(AGENT_DIR, 'last-user-request.txt'), `${new Date().toISOString()}\n${text}\n`, 'utf8');
  return next;
}

function readGithubToken() {
  const profiles = JSON.parse(readFileSync(AUTH_PROFILE, 'utf8')).profiles || {};
  const profile = profiles['github-copilot:github'];
  if (!profile?.token) throw new Error('Missing github-copilot auth profile');
  return profile.token;
}

async function getCopilotToken() {
  if (copilotTokenCache && copilotTokenCache.expiresAt - Date.now() > 300_000) return copilotTokenCache.token;
  const githubToken = readGithubToken();
  const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: { ...ideHeaders, Authorization: `Bearer ${githubToken}` },
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: HTTP ${res.status}`);
  const json = await res.json();
  copilotTokenCache = { token: json.token, expiresAt: (json.expires_at || 0) * 1000 };
  return copilotTokenCache.token;
}

function fallbackReply(text) {
  if (/blue|robot|glass/i.test(text)) return 'Oh dude, a blue robot with glasses is absolutely the vibe.';
  if (/reset|start over/i.test(text)) return 'Totally, fresh start—tell me what you want me to become next.';
  return 'I hear you, dude—let me shape myself around that.';
}

async function askBrain(userText, sessionId = 'demo') {
  const personality = await persistPersonalityFromUser(userText);
  const token = await getCopilotToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const system = `${basePersona}\n\nCurrent self file:\n${JSON.stringify(personality, null, 2)}`;
    const res = await fetch('https://api.individual.githubcopilot.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...ideHeaders,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        max_tokens: 60,
        temperature: 0.78,
        stream: false,
        user: `mydude-${String(sessionId).slice(0, 64)}`,
      }),
    });
    const elapsedMs = Date.now() - (Date.now() - 0); // overwritten below would be noisy; client sees its own latency
    const raw = await res.text();
    if (!res.ok) throw new Error(`Copilot chat failed: HTTP ${res.status}: ${raw.slice(0, 180)}`);
    const json = JSON.parse(raw);
    const text = (json.choices?.[0]?.message?.content || fallbackReply(userText)).trim().replace(/\s+/g, ' ');
    return { ok: true, model: `github-copilot/${MODEL}`, text, personality, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

function wsAccept(key) {
  return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

function sendWs(socket, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  socket.write(Buffer.concat([header, data]));
}

function decodeWsFrame(buffer) {
  if (buffer.length < 6) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return { close: true };
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { length = buffer.readUInt16BE(offset); offset += 2; }
  else if (length === 127) { length = Number(buffer.readBigUInt64BE(offset)); offset += 8; }
  const masked = Boolean(buffer[1] & 0x80);
  if (!masked) return null;
  const mask = buffer.subarray(offset, offset + 4); offset += 4;
  const payload = buffer.subarray(offset, offset + length);
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i % 4];
  return { text: out.toString('utf8') };
}

async function handleWsMessage(socket, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return sendWs(socket, { type: 'error', error: 'bad_json' }); }
  if (msg.type === 'ping') return sendWs(socket, { type: 'pong', time: new Date().toISOString() });
  if (msg.type !== 'say' || typeof msg.text !== 'string' || !msg.text.trim()) return sendWs(socket, { type: 'error', error: 'expected_say_text' });
  const started = Date.now();
  sendWs(socket, { type: 'thinking', model: `github-copilot/${MODEL}` });
  try {
    const reply = await askBrain(msg.text.trim().slice(0, 1200), msg.sessionId);
    sendWs(socket, { type: 'reply', ...reply, elapsedMs: Date.now() - started });
  } catch (error) {
    sendWs(socket, { type: 'reply', ok: false, model: `github-copilot/${MODEL}`, text: fallbackReply(msg.text), elapsedMs: Date.now() - started, error: String(error.message || error) });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.url?.startsWith('/health')) {
    await ensureAgentFiles();
    const body = JSON.stringify({
      ok: true,
      service: 'mydude-openclaw-bridge',
      status: 'phase-2-bridge-online',
      brain: `github-copilot/${MODEL}`,
      agentDir: AGENT_DIR,
      ws: '/speak',
      time: new Date().toISOString(),
    });
    res.writeHead(200, corsHeaders());
    res.end(body);
    return;
  }
  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.on('upgrade', (req, socket) => {
  if (!req.url?.startsWith('/speak')) return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${wsAccept(key)}`,
    `Access-Control-Allow-Origin: ${ALLOWED_ORIGIN}`,
    '',
    '',
  ].join('\r\n'));
  sendWs(socket, { type: 'ready', model: `github-copilot/${MODEL}` });
  socket.on('data', (buffer) => {
    const frame = decodeWsFrame(buffer);
    if (frame?.close) return socket.end();
    if (frame?.text) handleWsMessage(socket, frame.text);
  });
});

await ensureAgentFiles();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`mydude bridge listening on http://127.0.0.1:${PORT} using github-copilot/${MODEL}`);
});
