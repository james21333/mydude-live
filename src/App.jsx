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


const SCENE_PRIMITIVES = Object.freeze([
  'body_blob','body_capsule','body_box','body_sphere','body_triangle','body_star','body_cloud','body_flame','body_crystal','body_monitor','body_car','body_boat','body_plane','body_rocket','body_house','body_tree','body_mushroom','body_book','body_phone','body_lightbulb',
  'head_round','head_square','head_screen','head_animal','head_bird','head_fish','head_reptile','head_flower','head_planet','head_helmet','head_crown','head_hat','head_hair','head_mask','head_skull',
  'eyes_dot','eyes_googly','eyes_sleepy','eyes_star','eyes_heart','eyes_pixel','eyes_windshield','eyes_porthole','eyes_cyclops','eyes_glasses','eyes_sunglasses','eyes_binocular','eyes_robot','eyes_cat','eyes_cartoon',
  'mouth_smile','mouth_grin','mouth_screen','mouth_grille','mouth_beak','mouth_snout','mouth_tusk','mouth_fang','mouth_wave','mouth_speaker','mouth_mustache','mouth_tongue',
  'limb_arm','limb_wing','limb_fin','limb_tentacle','limb_branch','limb_wheel','limb_track','limb_leg','limb_boot','limb_claw','limb_paw','limb_flipper','limb_propeller','limb_rope',
  'accessory_hat','accessory_cap','accessory_crown','accessory_tie','accessory_bowtie','accessory_cape','accessory_backpack','accessory_toolbelt','accessory_badge','accessory_flag','accessory_microphone','accessory_sword','accessory_wand','accessory_umbrella','accessory_balloon','accessory_book','accessory_headphones','accessory_antenna','accessory_halo','accessory_lightning',
  'texture_stripes','texture_spots','texture_stars','texture_grid','texture_circuit','texture_wood','texture_metal','texture_glass','texture_fur','texture_scales','texture_feathers','texture_cloud','texture_flame','texture_water','texture_leaf',
  'scene_sky','scene_space','scene_ocean','scene_farm','scene_city','scene_desert','scene_forest','scene_jungle','scene_castle','scene_lab','scene_office','scene_stage','scene_road','scene_mountain','scene_beach','scene_underwater','scene_volcano','scene_snow','scene_candy','scene_dream',
  'object_sun','object_moon','object_star','object_cloud','object_rainbow','object_tree','object_flower','object_rock','object_wave','object_anchor','object_podium','object_flag','object_keyboard','object_mouse','object_orbit','object_satellite','object_comet','object_gear','object_wire','object_spark',
  'symbol_question','symbol_exclamation','symbol_idea','symbol_joke','symbol_music','symbol_heart','symbol_laugh','symbol_magic','symbol_money','symbol_time','symbol_map','symbol_compass','symbol_code'
]);

const SCENE_PALETTES = Object.freeze({
  blue: ['#38bdf8', '#2563eb', '#dbeafe'], pink: ['#f472b6', '#be185d', '#fff1f2'], green: ['#34d399', '#047857', '#dcfce7'],
  gold: ['#facc15', '#b45309', '#fef9c3'], purple: ['#a78bfa', '#6d28d9', '#ede9fe'], red: ['#fb7185', '#be123c', '#ffe4e6'],
  gray: ['#94a3b8', '#334155', '#f8fafc'], orange: ['#fb923c', '#c2410c', '#ffedd5']
});

function sanitizeSceneSpec(spec, prompt = '') {
  const primitiveSet = new Set(SCENE_PRIMITIVES);
  const paletteName = String(spec?.palette || colorHint(prompt) || 'blue').toLowerCase();
  const primitives = Array.isArray(spec?.primitives) ? spec.primitives.filter(item => primitiveSet.has(item)).slice(0, 14) : [];
  const scene = SCENE_PRIMITIVES.includes(spec?.scene) ? spec.scene : inferScene(prompt);
  const body = SCENE_PRIMITIVES.includes(spec?.body) ? spec.body : inferBody(prompt);
  const head = SCENE_PRIMITIVES.includes(spec?.head) ? spec.head : inferHead(prompt);
  const eyes = SCENE_PRIMITIVES.includes(spec?.eyes) ? spec.eyes : inferEyes(prompt);
  const mouth = SCENE_PRIMITIVES.includes(spec?.mouth) ? spec.mouth : inferMouth(prompt);
  return {
    kind: 'scene',
    prompt,
    title: String(spec?.title || titleFromPrompt(prompt)).slice(0, 48),
    summary: String(spec?.summary || `Transformed into ${titleFromPrompt(prompt)}`).slice(0, 120),
    palette: SCENE_PALETTES[paletteName] ? paletteName : 'blue',
    scene,
    body,
    head,
    eyes,
    mouth,
    primitives: [...new Set([scene, body, head, eyes, mouth, ...primitives])].slice(0, 18),
  };
}

function titleFromPrompt(prompt = '') {
  return prompt.toLowerCase().replace(/^(i want you to|make you|turn into|become|look like|be a|be an)\s+/i, '').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).slice(0, 5).join(' ') || 'Wild Idea';
}
function colorHint(text = '') { const lower = text.toLowerCase(); return ['pink','green','gold','purple','red','orange','gray','blue'].find(c => lower.includes(c)); }
function inferScene(text = '') { const l=text.toLowerCase(); if(/boat|sail|ocean|sea|wave/.test(l)) return 'scene_ocean'; if(/car|road|truck|bus/.test(l)) return 'scene_road'; if(/cow|farm|pasture|barn/.test(l)) return 'scene_farm'; if(/space|alien|rocket|planet/.test(l)) return 'scene_space'; if(/computer|robot|lab|science/.test(l)) return 'scene_lab'; if(/king|castle|dragon/.test(l)) return 'scene_castle'; if(/stage|funny|joke|comed/.test(l)) return 'scene_stage'; if(/forest|tree|bear/.test(l)) return 'scene_forest'; if(/city|president|bush|statesman/.test(l)) return 'scene_city'; return 'scene_sky'; }
function inferBody(text = '') { const l=text.toLowerCase(); if(/computer|monitor|screen/.test(l)) return 'body_monitor'; if(/car|truck|bus/.test(l)) return 'body_car'; if(/boat|sail/.test(l)) return 'body_boat'; if(/plane/.test(l)) return 'body_plane'; if(/rocket/.test(l)) return 'body_rocket'; if(/tree/.test(l)) return 'body_tree'; if(/mushroom/.test(l)) return 'body_mushroom'; if(/book/.test(l)) return 'body_book'; if(/phone/.test(l)) return 'body_phone'; if(/idea|lightbulb/.test(l)) return 'body_lightbulb'; if(/star/.test(l)) return 'body_star'; if(/cloud/.test(l)) return 'body_cloud'; return 'body_blob'; }
function inferHead(text = '') { const l=text.toLowerCase(); if(/computer|robot|screen|car/.test(l)) return 'head_screen'; if(/animal|cow|cat|dog|bear/.test(l)) return 'head_animal'; if(/bird/.test(l)) return 'head_bird'; if(/fish/.test(l)) return 'head_fish'; if(/helmet|space|astronaut/.test(l)) return 'head_helmet'; if(/king|queen/.test(l)) return 'head_crown'; if(/president|bush|statesman/.test(l)) return 'head_hair'; return 'head_round'; }
function inferEyes(text = '') { const l=text.toLowerCase(); if(/car/.test(l)) return 'eyes_windshield'; if(/computer|robot/.test(l)) return 'eyes_pixel'; if(/funny|silly|idea/.test(l)) return 'eyes_googly'; if(/sleep/.test(l)) return 'eyes_sleepy'; if(/love/.test(l)) return 'eyes_heart'; if(/star/.test(l)) return 'eyes_star'; if(/glass/.test(l)) return 'eyes_glasses'; if(/cat/.test(l)) return 'eyes_cat'; return 'eyes_cartoon'; }
function inferMouth(text = '') { const l=text.toLowerCase(); if(/computer|screen/.test(l)) return 'mouth_screen'; if(/car/.test(l)) return 'mouth_grille'; if(/bird/.test(l)) return 'mouth_beak'; if(/cow|dog|pig/.test(l)) return 'mouth_snout'; if(/funny|joke|silly/.test(l)) return 'mouth_grin'; return 'mouth_smile'; }

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
    return /\b(look like|make (you|him|it)|avatar|turn into|become|transform|change into|be a|be an|robot|cat|alien|computer|sailboat|boat|car|truck|cow|animal|monster|dragon|idea|funny idea|glasses|hat|blue|green|red|purple|gold|yellow|pink|eyes?)\b/i.test(text);
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
        if (payload.type === 'scene' && payload.sceneSpec) {
          const nextScene = sanitizeSceneSpec(payload.sceneSpec, prompt);
          setAvatar(nextScene);
          setMessage(current => current === 'Thinking…' ? `Built: ${nextScene.summary}` : current);
          appendLog(`Scene built: ${nextScene.summary}`);
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
          if (payload.sceneSpec) {
            const nextScene = sanitizeSceneSpec(payload.sceneSpec, prompt);
            setAvatar(nextScene);
            appendLog(`Scene built: ${nextScene.summary}`);
          }
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
  if (avatar?.kind === 'scene') return <SceneAvatar scene={avatar} mouthOpen={mouthOpen} status={status} voiceTheme={voiceTheme} />;
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

function SceneAvatar({ scene, mouthOpen, status, voiceTheme = {} }) {
  const palette = SCENE_PALETTES[scene.palette] || SCENE_PALETTES.blue;
  const [primary, dark, light] = palette;
  const bgClass = String(scene.scene || 'scene_sky').replace('scene_', '');
  const body = String(scene.body || 'body_blob').replace('body_', '');
  const head = String(scene.head || 'head_round').replace('head_', '');
  const eyes = String(scene.eyes || 'eyes_cartoon').replace('eyes_', '');
  const mouth = String(scene.mouth || 'mouth_smile').replace('mouth_', '');
  const extras = (scene.primitives || []).filter(item => /^object_|^symbol_|^accessory_|^texture_|^limb_/.test(item)).slice(0, 9);
  return <div className={`avatar-card scene-card ${status} built scene-${bgClass}`} style={{ '--scene-primary': voiceTheme.bot || primary, '--scene-dark': dark, '--scene-light': light }}>
    <svg className="scene-svg" viewBox="0 0 720 620" role="img" aria-label={scene.summary || scene.title}>
      <defs>
        <radialGradient id="sceneGlow" cx="50%" cy="35%" r="70%"><stop offset="0%" stopColor="var(--scene-light)" stopOpacity="0.72"/><stop offset="58%" stopColor="var(--scene-primary)" stopOpacity="0.2"/><stop offset="100%" stopColor="transparent"/></radialGradient>
        <linearGradient id="bodyFill" x1="0" x2="1" y1="0" y2="1"><stop stopColor="var(--scene-primary)"/><stop offset="1" stopColor="var(--scene-dark)"/></linearGradient>
      </defs>
      <rect width="720" height="620" rx="34" fill="url(#sceneGlow)"/>
      <SceneBackdrop scene={scene.scene} />
      <g className={`scene-character scene-body-${body} ${status === 'speaking' ? 'scene-speaking' : ''}`}>
        <BodyShape type={body} />
        <HeadShape type={head} />
        <EyeShape type={eyes} />
        <MouthShape type={mouth} open={mouthOpen} />
        <PrimitiveExtras items={extras} />
      </g>
      <text className="scene-label" x="360" y="586" textAnchor="middle">{scene.title}</text>
    </svg>
  </div>;
}

function SceneBackdrop({ scene }) {
  const name = String(scene || 'scene_sky');
  const ground = /ocean|beach|underwater/.test(name) ? '#0ea5e9' : /farm|forest|jungle/.test(name) ? '#16a34a' : /road|city/.test(name) ? '#475569' : /space/.test(name) ? '#020617' : /desert/.test(name) ? '#d97706' : '#1d4ed8';
  return <g className="scene-backdrop">
    <circle cx="610" cy="90" r="42" fill="#fde68a" opacity=".88" />
    <path d="M0 450 C120 415 210 480 335 445 C470 408 570 458 720 430 L720 620 L0 620 Z" fill={ground} opacity=".68" />
    {/space/.test(name) && [120,210,450,555,640].map((x,i)=><circle key={x} cx={x} cy={70+i*38} r={i%2?4:6} fill="#fff" opacity=".9"/>)}
    {/ocean|boat|beach|underwater/.test(name) && [0,1,2].map(i=><path key={i} d={`M${40+i*30} ${470+i*34} C140 ${440+i*30} 210 ${500+i*20} 330 ${465+i*22} C450 ${430+i*25} 530 ${492+i*18} 680 ${455+i*25}`} fill="none" stroke="#bfdbfe" strokeWidth="8" opacity=".55"/>)}
    {/city|road/.test(name) && [90,160,540,610].map((x,i)=><rect key={x} x={x} y={250-i*20} width="64" height={210+i*20} rx="8" fill="#334155" opacity=".62"/>)}
    {/farm|forest|jungle/.test(name) && [90,560,625].map(x=><g key={x}><rect x={x} y="335" width="24" height="96" fill="#854d0e"/><circle cx={x+12} cy="315" r="54" fill="#22c55e" opacity=".78"/></g>)}
  </g>;
}

function BodyShape({ type }) {
  if (type === 'car') return <g><rect x="210" y="320" width="300" height="105" rx="42" fill="url(#bodyFill)"/><circle cx="280" cy="430" r="36" fill="#0f172a"/><circle cx="440" cy="430" r="36" fill="#0f172a"/><path d="M280 318 L330 250 H415 L470 318 Z" fill="var(--scene-light)" opacity=".55"/></g>;
  if (type === 'boat') return <g><path d="M205 380 H520 L465 455 H260 Z" fill="url(#bodyFill)"/><path d="M360 180 V380" stroke="var(--scene-light)" strokeWidth="12"/><path d="M370 190 L500 355 H370 Z" fill="var(--scene-primary)"/><path d="M350 215 L245 360 H350 Z" fill="var(--scene-light)" opacity=".78"/></g>;
  if (type === 'monitor') return <g><rect x="235" y="215" width="250" height="170" rx="24" fill="url(#bodyFill)"/><rect x="265" y="245" width="190" height="95" rx="16" fill="#020617" opacity=".8"/><path d="M360 385 V440 M300 440 H420" stroke="var(--scene-light)" strokeWidth="18" strokeLinecap="round"/></g>;
  if (type === 'lightbulb') return <g><path d="M275 260 C275 205 320 165 360 165 C405 165 445 205 445 260 C445 302 420 325 405 354 H315 C300 326 275 302 275 260 Z" fill="url(#bodyFill)"/><rect x="315" y="355" width="90" height="72" rx="18" fill="#64748b"/></g>;
  if (type === 'star') return <path d="M360 175 L405 295 L532 300 L430 374 L466 500 L360 426 L254 500 L290 374 L188 300 L315 295 Z" fill="url(#bodyFill)"/>;
  if (type === 'rocket') return <g><path d="M360 145 C430 220 430 360 360 445 C290 360 290 220 360 145 Z" fill="url(#bodyFill)"/><path d="M310 385 L255 465 L330 430 Z M410 385 L465 465 L390 430 Z" fill="var(--scene-dark)"/></g>;
  return <ellipse cx="360" cy="340" rx="150" ry="135" fill="url(#bodyFill)"/>;
}
function HeadShape({ type }) {
  if (['screen','helmet'].includes(type)) return <rect x="277" y="175" width="166" height="128" rx="28" fill="rgba(15,23,42,.38)" stroke="var(--scene-light)" strokeWidth="8"/>;
  if (type === 'crown') return <path d="M290 205 L320 145 L360 202 L405 145 L435 205 V250 H290 Z" fill="#facc15" opacity=".88"/>;
  if (type === 'animal') return <g><circle cx="298" cy="188" r="36" fill="var(--scene-primary)"/><circle cx="422" cy="188" r="36" fill="var(--scene-primary)"/></g>;
  if (type === 'hair') return <path d="M270 210 C300 145 420 145 452 215 C410 190 315 190 270 210 Z" fill="#e5e7eb"/>;
  return <circle cx="360" cy="235" r="92" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.22)" strokeWidth="5"/>;
}
function EyeShape({ type }) {
  const eyeFill = type === 'heart' ? '#fb7185' : '#f8fafc';
  if (type === 'pixel') return <g fill="#86efac"><rect x="315" y="248" width="26" height="26"/><rect x="380" y="248" width="26" height="26"/></g>;
  if (type === 'windshield') return <path d="M292 250 H430 L405 292 H315 Z" fill="#dbeafe" opacity=".82"/>;
  if (type === 'googly') return <g><circle cx="322" cy="258" r="24" fill="#fff"/><circle cx="397" cy="252" r="29" fill="#fff"/><circle cx="330" cy="263" r="9" fill="#020617"/><circle cx="386" cy="245" r="10" fill="#020617"/></g>;
  return <g fill={eyeFill}><ellipse cx="322" cy="258" rx="23" ry="28"/><ellipse cx="398" cy="258" rx="23" ry="28"/></g>;
}
function MouthShape({ type, open }) {
  if (type === 'grille') return <g stroke="#020617" strokeWidth="8" strokeLinecap="round"><path d="M315 324 H405"/><path d="M330 308 V340 M360 308 V340 M390 308 V340"/></g>;
  if (type === 'screen') return <rect x="320" y="305" width="82" height={open ? 34 : 16} rx="8" fill="#0f172a"/>;
  if (type === 'beak') return <path d="M335 310 L410 330 L335 350 Z" fill="#fbbf24"/>;
  if (type === 'grin') return <path d="M312 315 Q360 370 410 315" fill="none" stroke="#020617" strokeWidth="16" strokeLinecap="round"/>;
  return <rect x="316" y="312" width="88" height={open ? 36 : 18} rx="999" fill="#0f172a"/>;
}
function PrimitiveExtras({ items }) {
  return <g className="scene-extras">{items.map((item, index) => {
    const x = 130 + (index % 5) * 116; const y = index < 5 ? 120 : 505;
    if (item.includes('star') || item.includes('spark')) return <path key={item+index} d={`M${x} ${y-22} L${x+8} ${y-4} L${x+28} ${y} L${x+8} ${y+6} L${x} ${y+24} L${x-8} ${y+6} L${x-28} ${y} L${x-8} ${y-4} Z`} fill="#fde68a" opacity=".9"/>;
    if (item.includes('heart')) return <text key={item+index} x={x} y={y} fontSize="44" textAnchor="middle">♥</text>;
    if (item.includes('question')) return <text key={item+index} x={x} y={y} fontSize="50" textAnchor="middle">?</text>;
    if (item.includes('flag')) return <g key={item+index}><path d={`M${x} ${y+28} V${y-32}`} stroke="#fff" strokeWidth="6"/><path d={`M${x} ${y-32} H${x+48} V${y-4} H${x} Z`} fill="#ef4444"/></g>;
    if (item.includes('gear')) return <circle key={item+index} cx={x} cy={y} r="28" fill="none" stroke="#cbd5e1" strokeWidth="10" strokeDasharray="8 8"/>;
    return <circle key={item+index} cx={x} cy={y} r="22" fill="var(--scene-light)" opacity=".72"/>;
  })}</g>;
}

function makeAvatar(prompt) {
  return sanitizeSceneSpec({}, prompt);
}

function makeLegacyAvatar(prompt) {
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
