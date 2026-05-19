import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw, Sparkles } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ROOT_DOMAIN = 'mydude.live';
const ACTIVE_PROJECTS = [
  { name: 'demo', url: 'https://demo.mydude.live', description: 'Live voice-box and avatar-builder demo.' },
  { name: 'clawtest', url: 'https://clawtest.mydude.live', description: 'Wildcard routing smoke test for autonomous OpenClaw projects.' },
  { name: 'testproject', url: 'https://testproject.mydude.live', description: 'Example generated project namespace.' },
];

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const BRAIN_ENABLED = new URLSearchParams(window.location.search).get('brain') === '1';
const VOICE_DEBUG_ENABLED = ['1', 'true'].includes(new URLSearchParams(window.location.search).get('voices'));
const BRIDGE_WS_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'ws://127.0.0.1:8787/speak'
  : 'wss://bridge.mydude.live/speak';

function getSubdomain(hostname = window.location.hostname.toLowerCase()) {
  if (hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}` || hostname === 'localhost' || hostname === '127.0.0.1') return '';
  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) return hostname.slice(0, -1 * (`.${ROOT_DOMAIN}`).length).replace(/[^a-z0-9-]/gi, '').slice(0, 48);
  return hostname.split('.')[0]?.replace(/[^a-z0-9-]/gi, '').slice(0, 48) || '';
}

function displayName(value) {
  return (value || 'unknown').split('-').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}


function detectVoicePlatform() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'windows';
  return 'other';
}

function isChromeBrowser() {
  const ua = navigator.userAgent || '';
  return /Chrome|CriOS/i.test(ua) && !/Edg|OPR|Opera|SamsungBrowser/i.test(ua);
}

function scoreVoiceForPlatform(voice, platform) {
  const name = voice.name || '';
  const lang = voice.lang || '';
  const id = `${name} ${lang}`.toLowerCase();
  const isGoogleEnglishUk = /google/.test(id) && (/en[-_]gb/i.test(lang) || /english.*(united kingdom|uk)|uk english|english uk/i.test(id));
  const isPaulinaEsMx = /paulina/.test(id) && (/es[-_]mx/i.test(lang) || /spanish.*mexico|mexico.*spanish|mexican spanish/i.test(id));

  if (isGoogleEnglishUk) return 10000;
  if (isPaulinaEsMx) return 9000;

  const isEnglish = /^en([-_]|$)/i.test(lang) || /english|samantha|alex|daniel|karen|zira|david|aria|jenny|guy|michelle/.test(id);
  if (!isEnglish) return -1000;

  let score = 0;
  if (/en[-_]us/i.test(lang)) score += 24;
  if (/en[-_]gb/i.test(lang)) score += 16;
  if (/en[-_]au/i.test(lang)) score += 10;
  if (voice.default) score += 6;
  if (voice.localService) score += 4;
  if (/natural|neural|premium|enhanced|google|microsoft|apple/.test(id)) score += 18;
  if (isChromeBrowser() && /eddy/.test(id) && /en[-_]gb|english.*united kingdom|united kingdom|uk/i.test(id)) score += 220;

  if (platform === 'mac') {
    if (/google.*(us|english)|google us english/.test(id)) score += 90;
    if (/samantha|alex/.test(id)) score += 80;
    if (/daniel|karen/.test(id)) score += 62;
  } else if (platform === 'ios') {
    if (/samantha/.test(id)) score += 90;
    if (/daniel/.test(id)) score += 78;
    if (/karen/.test(id)) score += 72;
    if (/moira|tessa|rishi/.test(id)) score += 55;
  } else if (platform === 'android') {
    if (/google/.test(id)) score += 100;
    if (/english.*united states|us english/.test(id)) score += 38;
  } else if (platform === 'windows') {
    if (/google/.test(id)) score += 100;
    if (/microsoft/.test(id)) score += 78;
    if (/aria|jenny|michelle|guy|zira|mark|david/.test(id)) score += 44;
  } else {
    if (/google|microsoft|samantha|alex|daniel|karen/.test(id)) score += 60;
  }

  if (/compact|novelty|whisper|zarvox|bells|boing|bubbles|cellos|hysterical|trinoids|pipe organ|bad news|good news/.test(id)) score -= 120;
  return score;
}

function isPaulinaVoiceChoice(voice) {
  if (!voice) return false;
  const id = `${voice.name || ''} ${voice.lang || ''}`.toLowerCase();
  return /paulina/.test(id) && (/es[-_]mx/i.test(voice.lang || '') || /es-mx|spanish.*mexico|mexico.*spanish|mexican spanish/i.test(id));
}

function pickBestVoice(voices, platform = detectVoicePlatform()) {
  return voices
    .filter(Boolean)
    .map(voice => ({ voice, score: scoreVoiceForPlatform(voice, platform) }))
    .sort((a, b) => b.score - a.score)[0]?.voice || null;
}

const DEFAULT_PROSODY = Object.freeze({ rate: 1.08, pitch: 1.08, volume: 1, pauseAfter: 0 });
const DIRECTOR_PRESETS = Object.freeze({
  normal: { rate: 1.08, pitch: 1.08, volume: 1, pauseAfter: 0 },
  warm: { rate: 1.04, pitch: 1.06, volume: 1, pauseAfter: 80 },
  happy: { rate: 1.1, pitch: 1.13, volume: 1, pauseAfter: 60 },
  excited: { rate: 1.16, pitch: 1.18, volume: 1, pauseAfter: 50 },
  curious: { rate: 1.04, pitch: 1.14, volume: 1, pauseAfter: 120 },
  thinking: { rate: 0.94, pitch: 1.0, volume: 0.96, pauseAfter: 240 },
  calm: { rate: 0.96, pitch: 0.98, volume: 0.98, pauseAfter: 150 },
  whisper: { rate: 0.9, pitch: 0.94, volume: 0.72, pauseAfter: 160 },
  emphasis: { rate: 0.98, pitch: 1.16, volume: 1, pauseAfter: 90 },
  slow: { rate: 0.88, pitch: 1.02, volume: 1, pauseAfter: 160 },
  fast: { rate: 1.2, pitch: 1.08, volume: 1, pauseAfter: 40 },
});

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeDirectorSyntax(text = '') {
  return String(text)
    .replace(/\{\{\s*([a-z][a-z-]*)(?::\s*(\d+))?\s*\}\}/gi, (_, tag, value) => `[${tag.toLowerCase()}${value ? `:${value}` : ''}]`)
    .replace(/\{\s*([a-z][a-z-]*)(?::\s*(\d+))?\s*\}/gi, (_, tag, value) => `[${tag.toLowerCase()}${value ? `:${value}` : ''}]`);
}

function plainSpeechText(text = '') {
  return normalizeDirectorSyntax(text)
    .replace(/\[(?:pause|beat|breath)(?::\d{1,4})?\]/gi, ' ')
    .replace(/\[(?:normal|warm|happy|excited|curious|thinking|calm|whisper|emphasis|slow|fast)\]/gi, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitSpeechTextIntoPhrases(text, prosody) {
  const chunks = [];
  const phrasePattern = /[^,.!?;:—–]+[,.!?;:—–]?/g;
  const phrases = text.match(phrasePattern) || [text];
  for (const phrase of phrases) {
    const clean = phrase.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const punctuation = clean.match(/[,.!?;:—–]$/)?.[0] || '';
    const punctuationPause = punctuation === ',' ? 130
      : punctuation === ';' || punctuation === ':' || punctuation === '—' || punctuation === '–' ? 220
      : punctuation === '.' ? 260
      : punctuation === '?' ? 300
      : punctuation === '!' ? 180
      : 60;
    const punctuationBoost = punctuation === '!' ? { pitch: 0.05, rate: 0.03 }
      : punctuation === '?' ? { pitch: 0.04, rate: -0.02 }
      : { pitch: 0, rate: 0 };
    chunks.push({
      type: 'speak',
      text: clean,
      rate: clampNumber(prosody.rate + punctuationBoost.rate, 0.65, 1.35, 1.08),
      pitch: clampNumber(prosody.pitch + punctuationBoost.pitch, 0.65, 1.45, 1.08),
      volume: clampNumber(prosody.volume, 0.45, 1, 1),
      pauseAfter: Math.max(prosody.pauseAfter || 0, punctuationPause),
    });
  }
  return chunks;
}

function compileSpeechPlan(text = '', options = {}) {
  const normalized = normalizeDirectorSyntax(text);
  const tokens = normalized.split(/(\[(?:[a-z][a-z-]*)(?::\d{1,4})?\])/gi).filter(Boolean);
  const chunks = [];
  let prosody = { ...DEFAULT_PROSODY, rate: options.rate || DEFAULT_PROSODY.rate };

  for (const token of tokens) {
    const directive = token.match(/^\[([a-z][a-z-]*)(?::(\d{1,4}))?\]$/i);
    if (directive) {
      const tag = directive[1].toLowerCase();
      const value = directive[2];
      if (tag === 'pause' || tag === 'beat' || tag === 'breath') {
        const fallback = tag === 'breath' ? 320 : tag === 'beat' ? 180 : 240;
        chunks.push({ type: 'pause', duration: clampNumber(value, 80, 1400, fallback) });
      } else if (DIRECTOR_PRESETS[tag]) {
        prosody = { ...prosody, ...DIRECTOR_PRESETS[tag] };
      }
      continue;
    }
    chunks.push(...splitSpeechTextIntoPhrases(token, prosody));
  }

  const speakChunks = chunks.filter(chunk => chunk.type === 'speak' && chunk.text.trim());
  return {
    displayText: plainSpeechText(normalized),
    chunks: chunks.length ? chunks : splitSpeechTextIntoPhrases(normalized, prosody),
    usedDirectives: normalized !== plainSpeechText(normalized) || speakChunks.length > 1,
  };
}

function colorsFromName(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    start: `hsl(${hue}, 72%, 18%)`,
    mid: `hsl(${(hue + 44) % 360}, 78%, 24%)`,
    end: `hsl(${(hue + 100) % 360}, 84%, 12%)`,
    accent: `hsl(${(hue + 72) % 360}, 95%, 68%)`,
  };
}

function avatarThemeForVoice(voiceChoice) {
  if (!isPaulinaVoiceChoice(voiceChoice)) return {};
  return {
    bot: '#f472b6',
    eye: '#fff1f2',
    limb: 'rgba(244,114,182,.62)',
    panel: 'rgba(249,168,212,.28)',
  };
}

function App() {
  const subdomain = getSubdomain();
  if (subdomain === 'demo' || window.location.search.includes('demo=1')) return <DemoApp />;
  if (!subdomain) return <RootLanding />;
  return <ProjectPage subdomain={subdomain} />;
}

function RootLanding() {
  return <main className="ecosystem-page">
    <p className="eyebrow">OpenClaw Launch Surface</p>
    <h1>mydude.live AI Ecosystem</h1>
    <p className="lede">A wildcard domain for launching lightweight AI projects, experiments, and autonomous app fronts.</p>
    <section className="project-list"><h2>Active Projects</h2><div className="project-grid">{ACTIVE_PROJECTS.map(project => <a className="project-card" href={project.url} key={project.name}><span>{project.name}</span><small>{project.description}</small></a>)}</div></section>
  </main>;
}

function ProjectPage({ subdomain }) {
  const colors = colorsFromName(subdomain);
  return <main className="generic-project" style={{ '--start': colors.start, '--mid': colors.mid, '--end': colors.end, '--accent': colors.accent }}>
    <div className="orb" />
    <p className="eyebrow">Live Wildcard Project</p>
    <h1>Welcome to Project: {displayName(subdomain)}</h1>
    <p className="lede">Generated autonomously by OpenClaw.</p>
    <div className="meta-card"><span>Hostname-routed app</span><strong>{subdomain}.{ROOT_DOMAIN}</strong></div>
  </main>;
}

function DemoApp() {
  const [activated, setActivated] = useState(false);
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [message, setMessage] = useState('Tap Start. I will listen, talk, and build my cartoon avatar in under one minute.');
  const [avatar, setAvatar] = useState(null);
  const [volume, setVolume] = useState(0.18);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [log, setLog] = useState(['Ready for one-click live mode.']);
  const [debug, setDebug] = useState('idle — press Start');
  const [brainStatus, setBrainStatus] = useState(BRAIN_ENABLED ? 'speaker agent: standby' : 'speaker agent: off');
  const [voiceInventory, setVoiceInventory] = useState([]);
  const [voiceChoice, setVoiceChoice] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('voice: loading browser voices');
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const speakingTimer = useRef(null);
  const mouthCloseTimer = useRef(null);
  const activatedRef = useRef(false);
  const statusRef = useRef('idle');
  const listenTokenRef = useRef(0);
  const sessionIdRef = useRef(window.crypto?.randomUUID?.() || `mydude-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const voiceRef = useRef(null);
  const speechRunRef = useRef(0);
  const streamQueueRef = useRef([]);
  const streamSpeakingRef = useRef(false);
  const streamAfterRef = useRef(null);
  const personalityRef = useRef(null);

  const avatarSeed = avatar?.prompt || 'voice-orb';
  const colors = useMemo(() => colorsFromName(avatarSeed), [avatarSeed]);
  const avatarVoiceTheme = useMemo(() => avatarThemeForVoice(voiceChoice), [voiceChoice]);


  useEffect(() => {
    let cancelled = false;
    const loadVoices = () => {
      if (!window.speechSynthesis) {
        setVoiceStatus('voice: browser speech unavailable');
        return;
      }
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) {
        setVoiceStatus('voice: waiting for browser voices');
        return;
      }
      const platform = detectVoicePlatform();
      const picked = pickBestVoice(voices, platform);
      if (cancelled) return;
      voiceRef.current = picked;
      setVoiceInventory(voices);
      setVoiceChoice(picked ? { name: picked.name, lang: picked.lang, localService: picked.localService, default: picked.default, platform, manual: false } : null);
      setVoiceStatus(picked ? `voice: ${picked.name} (${picked.lang || 'unknown'})` : 'voice: default browser voice');
    };
    loadVoices();
    const timer = window.setTimeout(loadVoices, 350);
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (window.speechSynthesis?.onvoiceschanged === loadVoices) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    activatedRef.current = activated;
  }, [activated]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    cancelAnimationFrame(animationRef.current);
    clearInterval(speakingTimer.current);
    clearTimeout(mouthCloseTimer.current);
    audioRef.current?.getTracks?.().forEach(track => track.stop());
  }, []);

  async function activate() {
    activatedRef.current = true;
    setActivated(true);
    setMessage("Hey, what's up?");
    setTranscript('Greeting… then I will listen.');
    setDebug('start clicked — greeting first, listener next');
    appendLog('Live mode activated. Greeting from the click before listener starts.');
    speak("Hey, what's up?", {
      rate: 1.02,
      after: () => {
        setTranscript('Listening… say something now.');
        startListening();
        startAudioMeter();
      },
    });
  }

  async function startAudioMeter() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length / 255;
        setVolume(Math.max(0.08, Math.min(1, avg * 2.8)));
        animationRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      appendLog('Mic meter unavailable until browser permission is granted.');
    }
  }

  function startListening() {
    const listenToken = listenTokenRef.current + 1;
    listenTokenRef.current = listenToken;
    window.speechSynthesis?.cancel?.();
    speechRunRef.current += 1;
    clearInterval(speakingTimer.current);
    setMouthOpen(false);
    activatedRef.current = true;
    if (!SpeechRecognition) {
      setMessage('This browser does not expose SpeechRecognition. Chrome should support it, so try refreshing and allowing microphone access.');
      setDebug('SpeechRecognition missing');
      setStatus('idle');
      return;
    }
    try { recognitionRef.current?.abort?.(); } catch {}
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => {
      statusRef.current = 'listening';
      setStatus('listening');
      setTranscript('Listening… say something now.');
      setMessage('Listening now. Say anything.');
      setDebug('listener started — waiting for speech');
    };
    recognition.onspeechstart = () => setDebug('speech detected');
    recognition.onsoundstart = () => setDebug('sound detected');
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      const heard = (finalText || interim).trim();
      if (heard) {
        setTranscript(heard);
        setMessage(`I heard: ${heard}`);
        setDebug(finalText.trim() ? 'final speech result received' : 'interim speech result received');
      }
      if (finalText.trim()) handleUserUtterance(finalText.trim());
    };
    recognition.onerror = (event) => {
      const error = event.error || 'unknown';
      if (error === 'aborted') {
        setDebug('listener reset internally');
        return;
      }
      setDebug(`listener error: ${error}`);
      appendLog(`Speech listener error: ${error}`);
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        setMessage('Chrome is blocking microphone/speech. Click the lock icon in the address bar and allow Microphone, then press Listen.');
      }
      setStatus('idle');
    };
    recognition.onend = () => {
      setDebug('listener ended');
      if (listenToken !== listenTokenRef.current || recognitionRef.current !== recognition) return;
      if (activatedRef.current && !['building', 'speaking'].includes(statusRef.current)) {
        window.setTimeout(() => {
          if (listenToken !== listenTokenRef.current || recognitionRef.current !== recognition) return;
          try {
            recognition.start();
            setDebug('listener restarted');
          } catch (error) {
            setDebug(`restart blocked: ${error.message || 'unknown'}`);
          }
        }, 250);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      setDebug(`start failed: ${error.message || 'unknown'}`);
      setMessage('Chrome did not start the listener. Press Listen again.');
      setStatus('idle');
    }
  }

  function handleUserUtterance(text) {
    appendLog(`Heard: ${text}`);
    listenTokenRef.current += 1;
    try { recognitionRef.current?.abort?.(); } catch {}
    if (shouldUpdateAvatar(text)) buildAvatar(text);
    else talkWithBrain(text);
  }

  function shouldUpdateAvatar(text) {
    return /\b(look like|make (you|him|it)|avatar|turn into|become|robot|cat|alien|glasses|hat|blue|green|red|purple|gold|yellow|eyes?)\b/i.test(text);
  }

  function talkWithBrain(prompt) {
    statusRef.current = 'speaking';
    setStatus('speaking');
    setMessage('Thinking…');
    setBuildProgress(0);
    const fallbackReply = 'I hear you.';
    const finish = () => { statusRef.current = 'listening'; setStatus('listening'); startListening(); };
    if (BRAIN_ENABLED) startStreamingSpeakerReply(prompt, null, fallbackReply, finish);
    else speak(fallbackReply, { after: finish });
  }

  function buildAvatar(prompt) {
    statusRef.current = 'building';
    setStatus('building');
    setMessage('Thinking…');
    setBuildProgress(8);
    const built = makeAvatar(prompt);
    const fallbackReply = 'Done.';
    const finish = () => { statusRef.current = 'listening'; setStatus('listening'); startListening(); };

    if (BRAIN_ENABLED) {
      startStreamingSpeakerReply(prompt, built, fallbackReply, finish);
    } else {
      speak(fallbackReply, { after: finish });
    }

    [28, 54, 78, 100].forEach((progress, index) => {
      setTimeout(() => setBuildProgress(progress), 120 + index * 160);
    });
    setTimeout(() => {
      setAvatar(built);
      setMessage(current => current === 'Thinking…' ? `Built: ${built.summary}` : current);
      appendLog(`Avatar built: ${built.summary}`);
    }, 520);
  }

  function startStreamingSpeakerReply(prompt, built, fallback, after) {
    setBrainStatus('speaker agent: connecting');
    statusRef.current = 'speaking';
    setStatus('speaking');
    streamQueueRef.current = [];
    streamSpeakingRef.current = false;
    streamAfterRef.current = after;
    window.speechSynthesis?.cancel?.();
    speechRunRef.current += 1;
    const speechRun = speechRunRef.current;
    let settled = false;
    let fullText = '';
    let pending = '';
    let firstSpoken = false;
    const started = performance.now();
    const instruction = `Answer naturally as My Dude. Do not force avatar-appearance questions or ask what you should look like. If the user asks you to change personality, vibe, or way of talking, adopt it and keep it until Reset. Use speech-director tags only when useful.`;

    const flushPending = (force = false) => {
      const match = pending.match(/^([\s\S]*?[.!?…—]|[\s\S]{80,}?[ ,;:])/);
      if (!force && !match) return;
      const chunk = (force ? pending : match[0]).trim();
      pending = force ? '' : pending.slice(match[0].length);
      if (!chunk) return;
      if (!firstSpoken) {
        firstSpoken = true;
        setBrainStatus(`speaker agent: first speech in ${Math.round(performance.now() - started)}ms`);
      }
      enqueueSpeech(chunk, speechRun);
    };

    const timeout = window.setTimeout(() => {
      if (settled || firstSpoken) return;
      settled = true;
      setBrainStatus('speaker agent: timeout, using instant fallback');
      setMessage(fallback);
      speak(fallback, { after });
    }, 4500);

    try {
      const socket = new WebSocket(BRIDGE_WS_URL);
      socket.onopen = () => setBrainStatus('speaker agent: connected');
      socket.onmessage = (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (payload.type === 'ready') {
          setBrainStatus(`speaker agent: ready (${payload.model || 'haiku'})`);
          socket.send(JSON.stringify({
            type: 'say',
            sessionId: sessionIdRef.current,
            text: prompt,
            instruction,
            avatar: built ? { name: built.name, summary: built.summary } : null,
            personality: personalityRef.current,
          }));
        }
        if (payload.type === 'thinking') setBrainStatus(`speaker agent: thinking (${payload.model || 'haiku'})`);
        if (payload.type === 'delta' && typeof payload.text === 'string') {
          fullText += payload.text;
          pending += payload.text;
          const display = plainSpeechText(fullText);
          if (display) setMessage(display);
          flushPending(false);
        }
        if (payload.type === 'reply' && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          if (payload.text && !fullText.trim()) {
            fullText = payload.text;
            pending = payload.text;
          }
          flushPending(true);
          if (payload.personality) personalityRef.current = payload.personality;
          const display = plainSpeechText(fullText || payload.text || fallback) || fallback;
          setMessage(display);
          appendLog(`Speaker agent: ${display}`);
          setBrainStatus(`speaker agent: streamed in ${payload.elapsedMs || Math.round(performance.now() - started)}ms`);
          if (!firstSpoken && !(fullText || payload.text)) speak(fallback, { after });
          else finishStreamWhenQuiet(speechRun);
          try { socket.close(); } catch {}
        }
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        setBrainStatus('speaker agent: connection error, using Phase 1 line');
        speak(fallback, { after });
      };
    } catch {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        setBrainStatus('speaker agent: unavailable, using Phase 1 line');
        speak(fallback, { after });
      }
    }
  }

  function enqueueSpeech(text, speechRun) {
    const speechPlan = compileSpeechPlan(text);
    const chunks = speechPlan.chunks.length ? speechPlan.chunks : [{ type: 'speak', text: plainSpeechText(text), ...DEFAULT_PROSODY }];
    streamQueueRef.current.push(...chunks);
    drainSpeechQueue(speechRun);
  }

  function finishStreamWhenQuiet(speechRun) {
    const check = () => {
      if (speechRun !== speechRunRef.current) return;
      if (!streamSpeakingRef.current && streamQueueRef.current.length === 0) {
        const after = streamAfterRef.current;
        streamAfterRef.current = null;
        after?.();
        return;
      }
      window.setTimeout(check, 120);
    };
    check();
  }

  function drainSpeechQueue(speechRun) {
    if (streamSpeakingRef.current || speechRun !== speechRunRef.current || !window.speechSynthesis) return;
    const chunk = streamQueueRef.current.shift();
    if (!chunk) return;
    streamSpeakingRef.current = true;
    if (chunk.type === 'pause') {
      setMouthOpen(false);
      window.setTimeout(() => {
        streamSpeakingRef.current = false;
        drainSpeechQueue(speechRun);
      }, chunk.duration);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = chunk.rate || 1.08;
    utterance.pitch = chunk.pitch || 1.08;
    utterance.volume = chunk.volume ?? 1;
    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }
    const pulseMouth = () => {
      setMouthOpen(true);
      clearTimeout(mouthCloseTimer.current);
      mouthCloseTimer.current = setTimeout(() => setMouthOpen(false), 48);
    };
    utterance.onstart = () => {
      pulseMouth();
      clearInterval(speakingTimer.current);
      speakingTimer.current = setInterval(pulseMouth, 118);
    };
    utterance.onboundary = (event) => {
      if (event.name === 'word' || event.charIndex >= 0) pulseMouth();
    };
    const done = () => {
      if (speechRun !== speechRunRef.current) return;
      clearInterval(speakingTimer.current);
      clearTimeout(mouthCloseTimer.current);
      setMouthOpen(false);
      window.setTimeout(() => {
        streamSpeakingRef.current = false;
        drainSpeechQueue(speechRun);
      }, chunk.pauseAfter || 40);
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }


  function selectVoice(voice) {
    if (!voice) return;
    const platform = detectVoicePlatform();
    voiceRef.current = voice;
    setVoiceChoice({ name: voice.name, lang: voice.lang, localService: voice.localService, default: voice.default, platform, manual: true });
    setVoiceStatus(`voice: ${voice.name} (${voice.lang || 'unknown'}) selected`);
    appendLog(`Voice selected: ${voice.name} (${voice.lang || 'unknown'})`);
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      speechRunRef.current += 1;
      const preview = new SpeechSynthesisUtterance('Voice selected.');
      preview.voice = voice;
      preview.lang = voice.lang || 'en-US';
      preview.rate = 1.08;
      preview.pitch = 1.08;
      window.speechSynthesis.speak(preview);
    }
  }

  function speak(text, options = {}) {
    if (!window.speechSynthesis) {
      options.after?.();
      return;
    }
    window.speechSynthesis.cancel();
    clearInterval(speakingTimer.current);
    clearTimeout(mouthCloseTimer.current);
    const speechRun = speechRunRef.current + 1;
    speechRunRef.current = speechRun;
    const speechPlan = options.speechPlan || compileSpeechPlan(text, options);
    const chunks = speechPlan.chunks.length ? speechPlan.chunks : [{ type: 'speak', text: plainSpeechText(text), ...DEFAULT_PROSODY }];
    setStatus('speaking');
    if (speechPlan.displayText && speechPlan.displayText !== text) appendLog(`Speech directed: ${speechPlan.displayText}`);

    const pulseMouth = () => {
      setMouthOpen(true);
      clearTimeout(mouthCloseTimer.current);
      mouthCloseTimer.current = setTimeout(() => setMouthOpen(false), 48);
    };

    const speakChunk = (index = 0) => {
      if (speechRun !== speechRunRef.current) return;
      const chunk = chunks[index];
      if (!chunk) {
        clearInterval(speakingTimer.current);
        clearTimeout(mouthCloseTimer.current);
        setMouthOpen(false);
        options.after?.();
        return;
      }
      if (chunk.type === 'pause') {
        setMouthOpen(false);
        window.setTimeout(() => speakChunk(index + 1), chunk.duration);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      utterance.rate = chunk.rate || options.rate || 1.08;
      utterance.pitch = chunk.pitch || 1.08;
      utterance.volume = chunk.volume ?? 1;
      if (voiceRef.current) {
        utterance.voice = voiceRef.current;
        utterance.lang = voiceRef.current.lang || 'en-US';
      } else {
        utterance.lang = 'en-US';
      }
      utterance.onstart = () => {
        pulseMouth();
        clearInterval(speakingTimer.current);
        speakingTimer.current = setInterval(pulseMouth, 118);
      };
      utterance.onboundary = (event) => {
        if (event.name === 'word' || event.charIndex >= 0) pulseMouth();
      };
      utterance.onend = () => {
        if (speechRun !== speechRunRef.current) return;
        clearInterval(speakingTimer.current);
        clearTimeout(mouthCloseTimer.current);
        setMouthOpen(false);
        window.setTimeout(() => speakChunk(index + 1), chunk.pauseAfter || 40);
      };
      utterance.onerror = () => {
        if (speechRun === speechRunRef.current) window.setTimeout(() => speakChunk(index + 1), 80);
      };
      window.speechSynthesis.speak(utterance);
    };

    speakChunk();
  }

  function resetDemo() {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    speechRunRef.current += 1;
    clearInterval(speakingTimer.current);
    setAvatar(null);
    personalityRef.current = null;
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = window.crypto?.randomUUID?.() || `mydude-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    resetSpeakerSession(previousSessionId);
    setTranscript('');
    setBuildProgress(0);
    statusRef.current = 'listening';
    setStatus('listening');
    setMessage('Reset complete. I am listening.');
    setDebug('reset — starting listener');
    appendLog('Demo reset. Avatar and conversation vibe cleared.');
    speak('Reset complete. I am listening.', { after: startListening });
  }

  function resetSpeakerSession(sessionId) {
    if (!BRAIN_ENABLED) return;
    try {
      const socket = new WebSocket(BRIDGE_WS_URL);
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'reset', sessionId }));
        window.setTimeout(() => socket.close(), 120);
      };
    } catch {}
  }

  function appendLog(item) {
    setLog(items => [item, ...items].slice(0, 5));
  }

  return <main className="demo-page" style={{ '--start': colors.start, '--mid': colors.mid, '--end': colors.end, '--accent': colors.accent }}>
    <section className="demo-hero compact">
      <p className="eyebrow"><Sparkles size={16}/> My Dude</p>
      <div className={`status-pill ${status}`}>{status}</div>
    </section>

    <section className="stage">
      <CartoonAvatar avatar={avatar} mouthOpen={mouthOpen} status={status} voiceTheme={avatarVoiceTheme} />
      <div className="voice-panel controls-below compact-controls">
        <div className="control-copy">
          <p>{message}</p>
          <div className="transcript live-transcript"><strong>I heard:</strong> <span>{transcript || 'waiting for voice...'}</span></div>
          <div className="listener-debug"><strong>Mic:</strong> {debug}<br/><strong>Voice:</strong> {voiceStatus}{BRAIN_ENABLED && <><br/><strong>Brain:</strong> {brainStatus}</>}</div>
        </div>
        {status === 'building' && <div className="progress"><span style={{ width: `${buildProgress}%` }} /></div>}
        <div className="actions">
          {!activated ? <button className="primary" onClick={activate}><Mic size={16}/> Start</button> : <button className="primary" onClick={startListening}><Mic size={16}/> Listen</button>}
          <button className="secondary" onClick={resetDemo}><RotateCcw size={16}/> Reset</button>
        </div>
      </div>
    </section>

    {VOICE_DEBUG_ENABLED && <section className="voice-inventory-panel">
      <div className="voice-inventory-header">
        <strong>Voice inventory</strong>
        <span>{voiceInventory.length} browser voices exposed on {voiceChoice?.platform || detectVoicePlatform()}</span>
      </div>
      <div className="voice-choice">{voiceChoice?.manual ? 'Selected' : 'Auto-picked'}: {voiceChoice ? `${voiceChoice.name} (${voiceChoice.lang || 'unknown'})` : 'browser default fallback'}</div>
      <div className="voice-list">
        {voiceInventory.map((voice, index) => <button type="button" className={voice.name === voiceChoice?.name && voice.lang === voiceChoice?.lang ? 'selected' : ''} onClick={() => selectVoice(voice)} key={`${voice.name}-${voice.lang}-${index}`}>
          <span>{voice.name || 'Unnamed voice'}</span>
          <small>{voice.lang || 'unknown'} · {voice.localService ? 'local' : 'network/unknown'}{voice.default ? ' · default' : ''}</small>
        </button>)}
      </div>
    </section>}

    <section className="log-panel">{log.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}</section>
  </main>;
}


function CartoonAvatar({ avatar, mouthOpen, status, voiceTheme = {} }) {
  const isBuilt = Boolean(avatar);
  const style = {
    '--bot': voiceTheme.bot || avatar?.color,
    '--eye': voiceTheme.eye || avatar?.eyeColor,
    '--limb': voiceTheme.limb,
    '--panel': voiceTheme.panel,
  };
  return <div className={`avatar-card ${status} ${isBuilt ? 'built' : 'unbuilt'}`} style={style}>
    <div className="character">
      <div className="antenna" />
      <div className="head">
        {avatar?.accessory === 'hat' && <div className="hat" />}
        <div className="shine" />
        <div className={`eyes ${avatar?.eyes || 'friendly'}`}><span/><span/></div>
        {avatar?.accessory === 'glasses' && <div className="glasses"><i/><i/></div>}
        <div className={`mouth ${mouthOpen ? 'open' : ''}`} />
      </div>
      <div className="character-lower">
        <div className="arm left-arm"><span /></div>
        <div className="torso"><span/><span/><span/></div>
        <div className="arm right-arm"><span /></div>
      </div>
      <div className="legs">
        <div className="leg"><span /></div>
        <div className="leg"><span /></div>
      </div>
    </div>
  </div>;
}

function makeAvatar(prompt) {
  const lower = prompt.toLowerCase();
  const color = lower.includes('blue') ? '#38bdf8' : lower.includes('green') ? '#34d399' : lower.includes('red') ? '#fb7185' : lower.includes('purple') ? '#a78bfa' : lower.includes('gold') || lower.includes('yellow') ? '#facc15' : '#60a5fa';
  const accessory = lower.includes('glass') ? 'glasses' : lower.includes('hat') ? 'hat' : 'none';
  const eyes = lower.includes('sleep') ? 'sleepy' : lower.includes('angry') ? 'focused' : 'friendly';
  const name = lower.includes('robot') ? 'Pocket Robot' : lower.includes('cat') ? 'Cartoon Cat' : lower.includes('alien') ? 'Tiny Alien' : 'My Dude';
  return {
    prompt,
    color,
    eyeColor: lower.includes('green eye') ? '#86efac' : '#e0f2fe',
    accessory,
    eyes,
    name,
    buildTime: 4,
    summary: `${name}, a ${colorName(color)} cartoon avatar with ${eyes} eyes${accessory === 'glasses' ? ' and square glasses' : ''}`,
  };
}

function colorName(hex) {
  return ({ '#38bdf8': 'blue', '#34d399': 'green', '#fb7185': 'red', '#a78bfa': 'purple', '#facc15': 'gold', '#60a5fa': 'sky-blue' })[hex] || 'colorful';
}

createRoot(document.getElementById('root')).render(<App />);
