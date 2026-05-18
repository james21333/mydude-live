import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw, Sparkles } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import drawingGrammar from '../shared/avatar-drawing-grammar.json';
import qualityPresets from '../shared/avatar-quality-presets.json';
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



const DRAWING_SHAPES = new Set(drawingGrammar.shapes || []);
const DRAWING_MATERIALS = new Set(drawingGrammar.materials || []);
const DRAWING_ANCHORS = new Set(drawingGrammar.anchors || []);

const MATERIAL_COLORS = Object.freeze({
  glossyBlue: ['#7dd3fc', '#2563eb', '#dbeafe'], glossyPink: ['#f9a8d4', '#db2777', '#fff1f2'], glossyGreen: ['#86efac', '#059669', '#dcfce7'],
  glossyGold: ['#fde047', '#b45309', '#fef9c3'], glossyPurple: ['#c4b5fd', '#7c3aed', '#f5f3ff'], glossyRed: ['#fb7185', '#be123c', '#ffe4e6'], glossyOrange: ['#fdba74', '#ea580c', '#ffedd5'],
  softWhite: ['#ffffff', '#cbd5e1', '#f8fafc'], warmCream: ['#fff7ed', '#fdba74', '#ffedd5'], charcoalRubber: ['#475569', '#020617', '#cbd5e1'],
  blackGlass: ['#1e293b', '#020617', '#93c5fd'], screenGlow: ['#67e8f9', '#0f172a', '#cffafe'], chrome: ['#f8fafc', '#64748b', '#ffffff'],
  brushedMetal: ['#cbd5e1', '#475569', '#f8fafc'], mattePlastic: ['#93c5fd', '#334155', '#dbeafe'], rubber: ['#64748b', '#0f172a', '#cbd5e1'],
  canvas: ['#f8fafc', '#94a3b8', '#ffffff'], wood: ['#b45309', '#78350f', '#fed7aa'], fur: ['#d97706', '#92400e', '#ffedd5'],
  feather: ['#bae6fd', '#0284c7', '#f0f9ff'], scale: ['#34d399', '#047857', '#dcfce7'], water: ['#38bdf8', '#0369a1', '#e0f2fe'],
  cloud: ['#f8fafc', '#94a3b8', '#ffffff'], flame: ['#fb923c', '#dc2626', '#fef3c7'], leaf: ['#4ade80', '#166534', '#dcfce7'],
  candy: ['#f9a8d4', '#7c3aed', '#fff1f2'], neon: ['#22d3ee', '#a855f7', '#f0fdfa'], shadow: ['#334155', '#020617', '#94a3b8'], highlight: ['#ffffff', '#e0f2fe', '#ffffff'],
});

const ANCHOR_POINTS = Object.freeze({
  body: [0, 90], bodyFront: [0, 92], bodyBack: [0, 118], bodyTop: [0, -20], bodyBottom: [0, 205], head: [0, -95], face: [0, -105], forehead: [0, -178],
  leftEye: [-48, -122], rightEye: [48, -122], eyes: [0, -122], mouth: [0, -62], leftCheek: [-76, -82], rightCheek: [76, -82], leftEar: [-118, -124], rightEar: [118, -124],
  leftArm: [-150, 62], rightArm: [150, 62], leftHand: [-195, 120], rightHand: [195, 120], leftLeg: [-62, 218], rightLeg: [62, 218], leftFoot: [-72, 258], rightFoot: [72, 258],
  top: [0, -230], back: [0, 135], front: [0, 32], left: [-190, 80], right: [190, 80], ground: [0, 265], orbit: [0, 0], free: [0, 0],
});

const MASCOT_RIG = Object.freeze({
  body: { cx: 0, cy: 92, rx: 86, ry: 118 },
  head: { cx: 0, cy: 20, rx: 78, ry: 70 },
});

const ATTACHMENT_SOCKETS = Object.freeze({
  'body.center': () => [MASCOT_RIG.body.cx, MASCOT_RIG.body.cy],
  'body.front': () => [MASCOT_RIG.body.cx, MASCOT_RIG.body.cy + 2],
  'body.leftShoulder': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.72, MASCOT_RIG.body.cy - MASCOT_RIG.body.ry * 0.05],
  'body.rightShoulder': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.72, MASCOT_RIG.body.cy - MASCOT_RIG.body.ry * 0.05],
  'body.leftHand': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.62, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.46],
  'body.rightHand': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.62, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.46],
  'body.leftHip': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.34, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.82],
  'body.rightHip': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.34, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.82],
  'body.leftFoot': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.34, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 1.02],
  'body.rightFoot': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.34, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 1.02],
  'body.patchLeft': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.34, MASCOT_RIG.body.cy - MASCOT_RIG.body.ry * 0.26],
  'body.patchRight': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.36, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.22],
  'head.center': () => [MASCOT_RIG.head.cx, MASCOT_RIG.head.cy],
  'head.leftEar': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.86, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.06],
  'head.rightEar': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.86, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.06],
  'head.leftHorn': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.34, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.72],
  'head.rightHorn': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.34, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.72],
  'head.leftEye': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.38, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.1],
  'head.rightEye': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.38, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.1],
  'head.mouth': () => [MASCOT_RIG.head.cx, MASCOT_RIG.head.cy + MASCOT_RIG.head.ry * 0.38],
  'head.patchLeft': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.42, MASCOT_RIG.head.cy + MASCOT_RIG.head.ry * 0.18],
});

function rigPoint(item) {
  const socket = item?.attach?.socket;
  if (socket && ATTACHMENT_SOCKETS[socket]) return ATTACHMENT_SOCKETS[socket]();
  return ANCHOR_POINTS[item.anchor] || ANCHOR_POINTS.free;
}

function clampDrawingNumber(value, min, max, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function materialForPrompt(prompt = '') {
  const lower = prompt.toLowerCase();
  if (/pink|dudette/.test(lower)) return 'glossyPink';
  if (/green|cow|farm|tree|leaf/.test(lower)) return 'glossyGreen';
  if (/gold|yellow|idea|lightbulb|sun/.test(lower)) return 'glossyGold';
  if (/purple|alien|space/.test(lower)) return 'glossyPurple';
  if (/red|car|fire/.test(lower)) return 'glossyRed';
  if (/orange|cat|kitten/.test(lower)) return 'glossyOrange';
  if (/computer|monitor|robot|metal/.test(lower)) return 'chrome';
  if (/boat|sail/.test(lower)) return 'canvas';
  return 'glossyBlue';
}

function layer(shape, anchor, x, y, sx, sy, material, options = {}) {
  return { shape, anchor, x, y, scale: [sx, sy], material, ...options };
}


function matchQualityPreset(prompt = '') {
  const lower = prompt.toLowerCase();
  return (qualityPresets.presets || []).find(preset => (preset.match || []).some(token => lower.includes(String(token).toLowerCase()))) || null;
}

function presetSceneSpec(prompt = '') {
  const preset = matchQualityPreset(prompt);
  if (!preset) return null;
  return {
    kind: 'scene',
    prompt,
    title: preset.title,
    summary: preset.summary,
    palette: preset.palette || colorHint(prompt) || 'blue',
    scene: inferScene(prompt),
    body: inferBody(prompt),
    head: inferHead(prompt),
    eyes: inferEyes(prompt),
    mouth: inferMouth(prompt),
    primitives: [],
    layers: sanitizeDrawingLayers(preset.layers, prompt),
  };
}

function fallbackDrawingLayers(prompt = '') {
  const preset = matchQualityPreset(prompt);
  if (preset?.layers?.length) return preset.layers;
  const l = prompt.toLowerCase();
  const mat = materialForPrompt(prompt);
  const layers = [layer('shadow', 'ground', 0, 18, 1.5, 0.28, 'shadow', { opacity: 0.28 })];
  if (/sail|boat/.test(l)) {
    layers.push(layer('hull', 'body', 0, 82, 1.35, 0.75, 'wood'), layer('curvedSail', 'head', 18, -8, 1.08, 1.45, 'canvas'), layer('rope', 'bodyFront', -54, 8, 0.45, 1.2, 'brushedMetal'), layer('flag', 'top', 60, 42, 0.48, 0.42, 'glossyRed'));
  } else if (/car|truck/.test(l)) {
    layers.push(layer('carBody', 'body', 0, 70, 1.45, 0.82, mat), layer('windshield', 'face', 0, 0, 1.05, 0.7, 'blackGlass'), layer('wheel', 'leftFoot', -25, -10, 0.62, 0.62, 'charcoalRubber'), layer('wheel', 'rightFoot', 25, -10, 0.62, 0.62, 'charcoalRubber'));
  } else if (/computer|monitor/.test(l)) {
    layers.push(layer('monitor', 'body', 0, 42, 1.18, 1, 'chrome'), layer('screen', 'face', 0, -2, 0.9, 0.58, 'screenGlow'), layer('keyboard', 'bodyBottom', 0, 10, 1.05, 0.32, 'charcoalRubber'));
  } else if (/idea|funny|abstract|joke/.test(l)) {
    layers.push(layer('lightbulb', 'body', 0, 20, 1.05, 1.2, 'glossyGold'), layer('microphone', 'leftHand', 28, -18, 0.42, 0.72, 'chrome'), layer('question', 'orbit', -178, -110, 0.42, 0.42, 'neon'), layer('spark', 'orbit', 176, -152, 0.6, 0.6, 'glossyGold'));
  } else if (/bush|president|statesman/.test(l)) {
    layers.push(layer('roundedBox', 'body', 0, 70, 1.05, 1.1, 'charcoalRubber'), layer('sphere', 'head', 0, -10, 0.92, 0.88, 'warmCream'), layer('hairCap', 'forehead', 0, 24, 0.86, 0.42, 'softWhite'), layer('tie', 'bodyFront', 0, 18, 0.4, 0.82, 'glossyRed'), layer('podium', 'ground', 0, -24, 1.05, 0.5, 'wood'), layer('flag', 'right', -18, -58, 0.55, 0.55, 'glossyBlue'));
  } else {
    layers.push(layer('capsule', 'body', 0, 70, 1.08, 1.25, mat), layer('squircle', 'head', 0, 0, 0.96, 0.92, mat));
  }
  layers.push(layer(/funny|idea|abstract/.test(l) ? 'googlyEye' : /computer|robot/.test(l) ? 'pixelEye' : 'eyeBall', 'leftEye', 0, 0, 0.32, 0.32, 'softWhite'));
  layers.push(layer(/funny|idea|abstract/.test(l) ? 'googlyEye' : /computer|robot/.test(l) ? 'pixelEye' : 'eyeBall', 'rightEye', 0, 0, 0.32, 0.32, 'softWhite'));
  layers.push(layer(/car/.test(l) ? 'mouthGrille' : /computer|robot/.test(l) ? 'mouthScreen' : /funny|idea|abstract/.test(l) ? 'mouthGrin' : 'mouthSmile', 'mouth', 0, 0, 0.78, 0.38, 'charcoalRubber', { role: 'mouth' }));
  return layers;
}

function sanitizeDrawingLayers(rawLayers, prompt = '') {
  const source = Array.isArray(rawLayers) && rawLayers.length ? rawLayers : fallbackDrawingLayers(prompt);
  const cleaned = source.slice(0, drawingGrammar.rules?.maxLayers || 42).map((raw, index) => {
    const shape = DRAWING_SHAPES.has(raw?.shape) ? raw.shape : 'blob';
    const anchor = DRAWING_ANCHORS.has(raw?.anchor) ? raw.anchor : 'free';
    const scale = Array.isArray(raw?.scale) ? raw.scale : [raw?.sx, raw?.sy];
    const material = DRAWING_MATERIALS.has(raw?.material) ? raw.material : materialForPrompt(prompt);
    return {
      id: String(raw?.id || `${shape}-${index}`).slice(0, 32),
      shape,
      anchor,
      x: clampDrawingNumber(raw?.x, -280, 280, 0),
      y: clampDrawingNumber(raw?.y, -280, 280, 0),
      scale: [clampDrawingNumber(scale?.[0], 0.05, 3.2, 1), clampDrawingNumber(scale?.[1], 0.05, 3.2, 1)],
      rotate: clampDrawingNumber(raw?.rotate, -180, 180, 0),
      material,
      opacity: clampDrawingNumber(raw?.opacity, 0.08, 1, 1),
      role: raw?.role === 'mouth' ? 'mouth' : raw?.role === 'eye' ? 'eye' : 'part',
      z: clampDrawingNumber(raw?.z, -20, 20, index),
      attach: raw?.attach && typeof raw.attach === 'object' && typeof raw.attach.socket === 'string' ? { socket: String(raw.attach.socket).slice(0, 40) } : null,
    };
  }).sort((a, b) => a.z - b.z);
  if (!cleaned.some(item => item.role === 'mouth')) cleaned.push(layer('mouthSmile', 'mouth', 0, 0, 0.78, 0.36, 'charcoalRubber', { role: 'mouth', z: 30 }));
  return cleaned;
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
  const preset = !Array.isArray(spec?.layers) || spec.layers.length < 7 ? presetSceneSpec(prompt) : null;
  if (preset) return preset;
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
    layers: sanitizeDrawingLayers(spec?.layers, prompt),
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
  const layers = sanitizeDrawingLayers(scene.layers, scene.prompt || scene.title || '');
  return <div className={`avatar-card scene-card drawing-card ${status} built`} style={{ '--scene-primary': voiceTheme.bot || primary, '--scene-dark': dark, '--scene-light': light }}>
    <svg className="scene-svg drawing-svg" viewBox="0 0 720 620" role="img" aria-label={scene.summary || scene.title}>
      <defs>
        <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#020617" floodOpacity="0.35"/></filter>
        <filter id="innerGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="-3" stdDeviation="5" floodColor="#ffffff" floodOpacity="0.22"/></filter>
        {Object.entries(MATERIAL_COLORS).map(([name, colors]) => <linearGradient id={`mat-${name}`} x1="0" x2="1" y1="0" y2="1" key={name}>
          <stop offset="0%" stopColor={colors[2]} stopOpacity=".98"/><stop offset="38%" stopColor={colors[0]}/><stop offset="100%" stopColor={colors[1]}/>
        </linearGradient>)}
        {Object.entries(MATERIAL_COLORS).map(([name, colors]) => <radialGradient id={`shine-${name}`} cx="32%" cy="22%" r="74%" key={`shine-${name}`}>
          <stop offset="0%" stopColor="#fff" stopOpacity=".72"/><stop offset="36%" stopColor={colors[0]} stopOpacity=".88"/><stop offset="100%" stopColor={colors[1]} stopOpacity=".95"/>
        </radialGradient>)}
      </defs>
      <rect x="92" y="58" width="536" height="500" rx="58" fill="rgba(15,23,42,.2)" />
      <g className={`drawing-character ${status === 'speaking' ? 'scene-speaking' : ''}`} transform="translate(360 292)" filter="url(#softShadow)">
        {layers.map(item => <DrawingLayer key={item.id} item={item} mouthOpen={mouthOpen} />)}
      </g>
      <text className="scene-label" x="360" y="586" textAnchor="middle">{scene.title}</text>
    </svg>
  </div>;
}

function DrawingLayer({ item, mouthOpen }) {
  const [ax, ay] = rigPoint(item);
  const [sx, sy] = item.scale || [1, 1];
  const mouthScale = item.role === 'mouth' && mouthOpen ? 1.45 : 1;
  const transform = `translate(${ax + item.x} ${ay + item.y}) rotate(${item.rotate || 0}) scale(${sx} ${sy * mouthScale})`;
  return <g transform={transform} opacity={item.opacity ?? 1} className={`draw-layer draw-${item.shape} role-${item.role || 'part'}`}>
    <Shape3D shape={item.shape} material={item.material} mouthOpen={mouthOpen && item.role === 'mouth'} />
  </g>;
}

function fillFor(material) { return `url(#shine-${MATERIAL_COLORS[material] ? material : 'glossyBlue'})`; }
function strokeFor(material) { return MATERIAL_COLORS[material]?.[1] || '#1d4ed8'; }

function Shape3D({ shape, material = 'glossyBlue', mouthOpen = false }) {
  const fill = fillFor(material);
  const stroke = strokeFor(material);
  const common = { fill, stroke, strokeWidth: 4, filter: 'url(#innerGlow)' };
  if (shape === 'shadow') return <ellipse cx="0" cy="0" rx="116" ry="32" fill="#020617" opacity=".7" stroke="none"/>;
  if (['sphere','eyeBall'].includes(shape)) return <g><ellipse cx="0" cy="8" rx="58" ry="54" {...common}/><ellipse cx="-16" cy="-12" rx="17" ry="12" fill="#fff" opacity=".72" stroke="none"/>{shape === 'eyeBall' && <circle cx="8" cy="10" r="16" fill="#020617" stroke="none"/>}</g>;
  if (shape === 'googlyEye') return <g><circle cx="0" cy="0" r="48" fill="#fff" stroke="#cbd5e1" strokeWidth="4"/><circle cx="12" cy="10" r="15" fill="#020617"/></g>;
  if (shape === 'pixelEye') return <g><rect x="-36" y="-28" width="72" height="56" rx="10" fill="#0f172a" stroke="#67e8f9" strokeWidth="4"/><rect x="-16" y="-8" width="32" height="18" fill="#86efac"/></g>;
  if (shape === 'sleepyEye') return <path d="M-44 0 Q0 24 44 0" fill="none" stroke="#f8fafc" strokeWidth="12" strokeLinecap="round"/>;
  if (shape === 'heartEye' || shape === 'heart') return <path d="M0 42 C-58 5 -54 -44 -15 -36 C-4 -34 0 -22 0 -22 C0 -22 4 -34 15 -36 C54 -44 58 5 0 42 Z" fill="#fb7185" stroke="#be123c" strokeWidth="4"/>;
  if (shape === 'starEye' || shape === 'star' || shape === 'spark') return <path d="M0 -60 L17 -18 L62 -16 L26 10 L38 56 L0 30 L-38 56 L-26 10 L-62 -16 L-17 -18 Z" {...common}/>;
  if (['squircle','roundedBox','monitor','screen'].includes(shape)) return <g><rect x="-86" y="-66" width="172" height="132" rx={shape === 'screen' ? 18 : 36} {...common}/><ellipse cx="-28" cy="-34" rx="34" ry="14" fill="#fff" opacity=".23" stroke="none"/></g>;
  if (['capsule','bean','blob','egg','body_blob'].includes(shape)) return <g><path d="M-78 -74 C-18 -116 82 -82 96 5 C110 95 30 132 -48 104 C-126 76 -138 -34 -78 -74 Z" {...common}/><ellipse cx="-34" cy="-45" rx="38" ry="16" fill="#fff" opacity=".22" stroke="none"/></g>;
  if (shape === 'mascotBody') return <g><path d="M-72 -78 C-30 -116 44 -108 80 -58 C112 -12 104 84 62 126 C26 160 -42 152 -74 112 C-116 62 -118 -34 -72 -78 Z" {...common}/><path d="M-38 -56 C-5 -86 48 -70 66 -32 C36 -48 -4 -46 -38 -20 Z" fill="#fff" opacity=".18" stroke="none"/><ellipse cx="-30" cy="-14" rx="34" ry="72" fill="#fff" opacity=".12" stroke="none"/></g>;
  if (shape === 'mascotHead') return <g><path d="M-72 -52 C-36 -94 34 -96 72 -54 C106 -16 98 56 50 82 C12 104 -50 90 -76 48 C-98 12 -94 -24 -72 -52 Z" {...common}/><ellipse cx="-26" cy="-34" rx="30" ry="14" fill="#fff" opacity=".28" stroke="none"/></g>;
  if (shape === 'stubbyArm') return <g><path d="M-32 -62 C12 -74 42 -34 34 12 C28 52 -6 76 -38 54 C-64 34 -68 -42 -32 -62 Z" {...common}/><ellipse cx="-8" cy="-32" rx="18" ry="9" fill="#fff" opacity=".2" stroke="none"/></g>;
  if (shape === 'stubbyLeg') return <g><path d="M-28 -36 C8 -50 38 -18 34 24 C30 60 -14 68 -36 38 C-52 14 -50 -22 -28 -36 Z" {...common}/></g>;
  if (shape === 'hoof') return <g><ellipse rx="42" ry="28" fill="url(#shine-charcoalRubber)" stroke="#020617" strokeWidth="4"/><ellipse cx="-10" cy="-10" rx="13" ry="8" fill="#fff" opacity=".26" stroke="none"/><path d="M0 -20 V16" stroke="#94a3b8" strokeWidth="3" opacity=".45"/></g>;
  if (shape === 'cuteEye') return <g><ellipse cx="0" cy="2" rx="44" ry="42" fill="#fff" stroke="#cbd5e1" strokeWidth="4"/><circle cx="10" cy="10" r="14" fill="#020617" stroke="none"/><circle cx="4" cy="2" r="5" fill="#fff" opacity=".95" stroke="none"/></g>;
  if (shape === 'bodyPatch' || shape === 'attachedSpot') return <path d="M-48 -18 C-36 -42 8 -46 40 -22 C58 -8 48 28 10 36 C-28 44 -62 12 -48 -18 Z" fill="#334155" stroke="#1e293b" strokeWidth="3" opacity=".86"/>;
  if (shape === 'softEar') return <g><path d="M-44 18 C-60 -20 -18 -58 30 -38 C54 -18 28 26 -24 42 Z" fill="url(#shine-warmCream)" stroke="#fdba74" strokeWidth="4"/><ellipse cx="-8" cy="-8" rx="20" ry="12" fill="#fff7ed" opacity=".5" stroke="none"/></g>;
  if (shape === 'softHorn') return <path d="M-12 40 C-8 -8 2 -44 20 -74 C18 -28 28 18 -12 40 Z" fill="url(#shine-canvas)" stroke="#d6d3d1" strokeWidth="4"/>;
  if (shape === 'carBody') return <g><rect x="-130" y="-34" width="260" height="88" rx="42" {...common}/><path d="M-58 -32 L-20 -82 H62 L104 -32 Z" fill={fill} stroke={stroke} strokeWidth="4"/><ellipse cx="-74" cy="54" rx="34" ry="34" fill="#020617"/><ellipse cx="78" cy="54" rx="34" ry="34" fill="#020617"/></g>;
  if (shape === 'windshield') return <path d="M-72 -34 H72 L50 38 H-54 Z" fill="url(#shine-blackGlass)" stroke="#bfdbfe" strokeWidth="4"/>;
  if (shape === 'wheel' || shape === 'tire') return <g><circle r="48" fill="#020617"/><circle r="22" fill="url(#shine-chrome)"/></g>;
  if (shape === 'hull') return <path d="M-140 -42 H140 L90 54 H-96 Z" {...common}/>;
  if (shape === 'sail' || shape === 'curvedSail') return <path d="M-28 92 C35 38 58 -36 30 -112 C92 -40 126 50 72 112 Z" {...common}/>;
  if (shape === 'lightbulb') return <g><path d="M-64 -18 C-64 -88 -12 -126 34 -102 C90 -72 72 2 38 34 C24 48 18 60 18 82 H-24 C-24 58 -34 48 -48 32 C-58 20 -64 2 -64 -18 Z" {...common}/><rect x="-28" y="78" width="58" height="42" rx="12" fill="url(#shine-brushedMetal)" stroke="#64748b" strokeWidth="4"/></g>;
  if (shape === 'rocket') return <g><path d="M0 -120 C74 -42 68 68 0 132 C-68 68 -74 -42 0 -120 Z" {...common}/><circle cx="0" cy="-26" r="32" fill="url(#shine-screenGlow)" stroke="#e0f2fe" strokeWidth="5"/></g>;
  if (shape === 'mouthSmile') return <path d={mouthOpen ? 'M-52 -8 Q0 42 52 -8 Q0 18 -52 -8 Z' : 'M-52 0 Q0 34 52 0'} fill={mouthOpen ? '#0f172a' : 'none'} stroke="#0f172a" strokeWidth="13" strokeLinecap="round"/>;
  if (shape === 'mouthGrin') return <path d="M-60 -6 Q0 52 62 -6 Q0 24 -60 -6 Z" fill="#0f172a" stroke="#0f172a" strokeWidth="7"/>;
  if (shape === 'mouthO') return <ellipse rx="34" ry={mouthOpen ? 42 : 22} fill="#0f172a"/>;
  if (shape === 'mouthScreen') return <rect x="-52" y="-18" width="104" height={mouthOpen ? 48 : 28} rx="12" fill="#020617" stroke="#67e8f9" strokeWidth="4"/>;
  if (shape === 'mouthGrille') return <g stroke="#020617" strokeWidth="9" strokeLinecap="round"><path d="M-56 0 H56"/><path d="M-32 -18 V18 M0 -18 V18 M32 -18 V18"/></g>;
  if (shape === 'snout') return <g><ellipse rx="54" ry="34" fill="url(#shine-warmCream)" stroke="#92400e" strokeWidth="4"/><circle cx="-18" cy="0" r="7" fill="#020617"/><circle cx="18" cy="0" r="7" fill="#020617"/></g>;
  if (shape === 'beak') return <path d="M-42 -28 L76 0 L-42 32 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="4"/>;
  if (shape === 'animalEar') return <path d="M-44 34 C-60 -16 -22 -62 20 -48 C54 -18 30 30 -44 34 Z" {...common}/>;
  if (shape === 'horn') return <path d="M-18 48 C-12 -18 0 -62 28 -92 C18 -28 32 22 -18 48 Z" fill="url(#shine-canvas)" stroke="#d6d3d1" strokeWidth="4"/>;
  if (shape === 'wing') return <path d="M-8 -70 C-92 -24 -108 42 -22 82 C-30 34 18 12 -8 -70 Z" {...common}/>;
  if (shape === 'fin') return <path d="M-16 -58 C34 -10 32 36 -34 70 C-18 24 -16 -18 -16 -58 Z" {...common}/>;
  if (shape === 'fender') return <path d="M-64 20 C-48 -38 50 -42 66 20 C22 2 -20 2 -64 20 Z" {...common}/>;
  if (shape === 'spot') return <ellipse rx="52" ry="34" fill="url(#shine-charcoalRubber)" stroke="#0f172a" strokeWidth="3" opacity=".9"/>;
  if (shape === 'paw' || shape === 'mitten') return <g><ellipse rx="42" ry="34" {...common}/><circle cx="-18" cy="-24" r="10" fill="#fff" opacity=".32"/><circle cx="4" cy="-30" r="10" fill="#fff" opacity=".32"/><circle cx="24" cy="-20" r="10" fill="#fff" opacity=".32"/></g>;
  if (shape === 'claw') return <path d="M-44 30 L-14 -42 L8 22 L42 -38 L34 34 Z" fill="url(#shine-canvas)" stroke="#d6d3d1" strokeWidth="4"/>;
  if (shape === 'antenna') return <g><path d="M0 54 C-4 8 8 -28 32 -62" fill="none" stroke="url(#shine-neon)" strokeWidth="10" strokeLinecap="round"/><circle cx="34" cy="-66" r="18" fill="url(#shine-neon)" stroke="#67e8f9" strokeWidth="4"/></g>;
  if (shape === 'wire') return <path d="M-62 -28 C-8 -76 44 -28 12 30 C-8 68 38 82 70 38" fill="none" stroke="url(#shine-brushedMetal)" strokeWidth="12" strokeLinecap="round"/>;
  if (shape === 'button' || shape === 'bolt') return <circle r="30" {...common}/>;
  if (shape === 'hairCap') return <path d="M-76 -8 C-42 -62 54 -64 82 -4 C42 -24 -34 -24 -76 -8 Z" fill="url(#shine-softWhite)" stroke="#94a3b8" strokeWidth="4"/>;
  if (shape === 'keyboard') return <g><rect x="-92" y="-28" width="184" height="56" rx="14" fill="url(#shine-charcoalRubber)" stroke="#64748b" strokeWidth="4"/>{[-48,0,48].map(x => <rect key={x} x={x-18} y="-8" width="36" height="16" rx="4" fill="#cbd5e1" opacity=".7"/> )}</g>;
  if (shape === 'rope') return <path d="M-12 -70 C28 -28 -34 18 10 72" fill="none" stroke="#f5deb3" strokeWidth="12" strokeLinecap="round" strokeDasharray="10 8"/>;
  if (shape === 'tie') return <path d="M0 -46 L34 -10 L12 86 H-12 L-34 -10 Z" fill="url(#shine-glossyRed)" stroke="#991b1b" strokeWidth="4"/>;
  if (shape === 'podium') return <path d="M-90 -44 H90 L68 58 H-68 Z" fill="url(#shine-wood)" stroke="#78350f" strokeWidth="5"/>;
  if (shape === 'flag') return <g><path d="M-30 58 V-58" stroke="#f8fafc" strokeWidth="8"/><path d="M-26 -58 H66 V-4 H-26 Z" fill="url(#shine-glossyBlue)" stroke="#e0f2fe" strokeWidth="4"/></g>;
  if (shape === 'exclamation') return <text y="34" textAnchor="middle" fontSize="112" fontWeight="900" fill="url(#shine-neon)" stroke="#0f172a" strokeWidth="3">!</text>;
  if (shape === 'musicNote') return <text y="30" textAnchor="middle" fontSize="104" fontWeight="900" fill="url(#shine-neon)" stroke="#0f172a" strokeWidth="3">♪</text>;
  if (shape === 'codeBracket') return <text y="28" textAnchor="middle" fontSize="92" fontWeight="900" fill="url(#shine-screenGlow)" stroke="#0f172a" strokeWidth="3">{'{}'}</text>;
  if (shape === 'gear') return <circle r="48" fill="none" stroke="url(#shine-chrome)" strokeWidth="16" strokeDasharray="12 8"/>;
  if (shape === 'coin') return <g><circle r="48" fill="url(#shine-glossyGold)" stroke="#b45309" strokeWidth="5"/><text y="18" textAnchor="middle" fontSize="52" fontWeight="900" fill="#92400e">$</text></g>;
  if (shape === 'question') return <text y="30" textAnchor="middle" fontSize="112" fontWeight="900" fill="url(#shine-neon)" stroke="#0f172a" strokeWidth="3">?</text>;
  if (shape === 'microphone') return <g><rect x="-20" y="-60" width="40" height="82" rx="20" fill="url(#shine-chrome)" stroke="#64748b" strokeWidth="4"/><path d="M0 20 V74 M-34 74 H34" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round"/></g>;
  return <g><ellipse cx="0" cy="8" rx="70" ry="58" {...common}/><ellipse cx="-24" cy="-18" rx="30" ry="13" fill="#fff" opacity=".22" stroke="none"/></g>;
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
