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
const params = new URLSearchParams(window.location.search);
const BRAIN_ENABLED = params.get('brain') !== '0';
const VOICE_DEBUG_ENABLED = ['1', 'true'].includes(params.get('voices')) || ['1', 'true'].includes(params.get('voice')) || ['1', 'true'].includes(params.get('debug'));
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
  const isEnglishUk = /en[-_]gb/i.test(lang) || /english.*(united kingdom|uk)|uk english|english uk/i.test(id);
  const isGoogleEnglishUk = /google/.test(id) && isEnglishUk;

  if (isGoogleEnglishUk) return 10000;

  const isEnglish = isEnglishVoice(voice);
  if (!isEnglish) return -1000;

  let score = 0;
  if (isEnglishUk) score += 240;
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

function isEnglishVoice(voice) {
  if (!voice) return false;
  const id = `${voice.name || ''} ${voice.lang || ''}`.toLowerCase();
  return /^en([-_]|$)/i.test(voice.lang || '') || /english|samantha|alex|daniel|karen|zira|david|aria|jenny|guy|michelle/.test(id);
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
const MOUTH_PULSE_MS = 150;
const MOUTH_CLOSE_MS = 130;
const MOUTH_SEQUENCE = Object.freeze([2, 1, 0, 1, 2, 1, 0, 0]);
const STANDARD_MOUTH_SCALE = Object.freeze({ x: 0.38, y: 0.2 });
const BARGE_IN_MIN_SPEECH_MS = 1000;
const BARGE_IN_VOLUME_THRESHOLD = 0.12;
const BARGE_IN_REQUIRED_FRAMES = 8;
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
  body: { cx: 0, cy: 118, rx: 92, ry: 108 },
  head: { cx: 0, cy: 38, rx: 84, ry: 70 },
});

const ATTACHMENT_SOCKET_NAMES = new Set(drawingGrammar.rules?.attachmentMath?.sockets || []);

const ATTACHMENT_SOCKETS = Object.freeze({
  'body.center': () => [MASCOT_RIG.body.cx, MASCOT_RIG.body.cy],
  'body.front': () => [MASCOT_RIG.body.cx, MASCOT_RIG.body.cy + 2],
  'body.leftShoulder': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.46, MASCOT_RIG.body.cy - MASCOT_RIG.body.ry * 0.08],
  'body.rightShoulder': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.46, MASCOT_RIG.body.cy - MASCOT_RIG.body.ry * 0.08],
  'body.leftHand': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.52, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.2],
  'body.rightHand': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.52, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.2],
  'body.leftHip': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.25, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.58],
  'body.rightHip': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.25, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.58],
  'body.leftFoot': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.24, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 1.04],
  'body.rightFoot': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.24, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 1.04],
  'body.patchLeft': () => [MASCOT_RIG.body.cx - MASCOT_RIG.body.rx * 0.24, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.04],
  'body.patchRight': () => [MASCOT_RIG.body.cx + MASCOT_RIG.body.rx * 0.24, MASCOT_RIG.body.cy + MASCOT_RIG.body.ry * 0.18],
  'head.center': () => [MASCOT_RIG.head.cx, MASCOT_RIG.head.cy],
  'head.leftEar': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.78, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.02],
  'head.rightEar': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.78, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.02],
  'head.leftHorn': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.32, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.66],
  'head.rightHorn': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.32, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.66],
  'head.leftEye': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.27, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.07],
  'head.rightEye': () => [MASCOT_RIG.head.cx + MASCOT_RIG.head.rx * 0.27, MASCOT_RIG.head.cy - MASCOT_RIG.head.ry * 0.07],
  'head.mouth': () => [MASCOT_RIG.head.cx, MASCOT_RIG.head.cy + MASCOT_RIG.head.ry * 0.34],
  'head.patchLeft': () => [MASCOT_RIG.head.cx - MASCOT_RIG.head.rx * 0.42, MASCOT_RIG.head.cy + MASCOT_RIG.head.ry * 0.18],
});

function rigPoint(item) {
  const socket = item?.attach?.socket;
  if (socket && ATTACHMENT_SOCKETS[socket]) return ATTACHMENT_SOCKETS[socket]();
  return ANCHOR_POINTS[item.anchor] || ANCHOR_POINTS.free;
}

const SOCKET_COMPATIBILITY = Object.freeze({
  mascotBody: ['body.center'],
  mascotHead: ['head.center'],
  stubbyArm: ['body.leftShoulder', 'body.rightShoulder', 'body.leftHand', 'body.rightHand'],
  wing: ['body.leftShoulder', 'body.rightShoulder'], finLimb: ['body.leftShoulder', 'body.rightShoulder'],
  noodleArm: ['body.leftShoulder', 'body.rightShoulder'],
  tentacle: ['body.leftShoulder', 'body.rightShoulder', 'body.leftHand', 'body.rightHand'],
  stubbyLeg: ['body.leftHip', 'body.rightHip'],
  leg: ['body.leftHip', 'body.rightHip'],
  boot: ['body.leftFoot', 'body.rightFoot'],
  hoof: ['body.leftHand', 'body.rightHand', 'body.leftFoot', 'body.rightFoot'],
  paw: ['body.leftHand', 'body.rightHand', 'body.leftFoot', 'body.rightFoot'],
  mitten: ['body.leftHand', 'body.rightHand'],
  claw: ['body.leftHand', 'body.rightHand'],
  softEar: ['head.leftEar', 'head.rightEar'],
  animalEar: ['head.leftEar', 'head.rightEar'],
  softHorn: ['head.leftHorn', 'head.rightHorn'],
  horn: ['head.leftHorn', 'head.rightHorn'],
  antenna: ['head.leftHorn', 'head.rightHorn'],
  cuteEye: ['head.leftEye', 'head.rightEye'],
  googlyEye: ['head.leftEye', 'head.rightEye'],
  eyeBall: ['head.leftEye', 'head.rightEye'],
  pixelEye: ['head.leftEye', 'head.rightEye'],
  sleepyEye: ['head.leftEye', 'head.rightEye'],
  heartEye: ['head.leftEye', 'head.rightEye'],
  starEye: ['head.leftEye', 'head.rightEye'],
  snout: ['head.mouth'],
  beak: ['head.mouth'],
  mouthSmile: ['head.mouth'],
  mouthGrin: ['head.mouth'],
  mouthO: ['head.mouth'],
  mouthScreen: ['head.mouth'],
  mouthGrille: ['head.mouth'],
  bodyPatch: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'],
  attachedSpot: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'],
  spot: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'],
  stripe: ['body.front', 'body.center'],
  panel: ['body.front', 'body.center'],
  button: ['body.front'],
  tie: ['body.front'],
  bowtie: ['body.front'],
  badge: ['body.front'],
});

const FLOATING_ARTIFACT_SHAPES = new Set(['hoof', 'paw', 'claw', 'softEar', 'animalEar', 'softHorn', 'horn', 'snout', 'bodyPatch', 'attachedSpot', 'spot', 'stripe', 'panel', 'button', 'badge']);

function sideFromRaw(raw = {}, fallback = 'left') {
  const text = `${raw.id || ''} ${raw.anchor || ''} ${raw.attach?.socket || ''}`.toLowerCase();
  if (/right/.test(text) || Number(raw.x) > 0) return 'right';
  if (/left/.test(text) || Number(raw.x) < 0) return 'left';
  return fallback;
}

function inferSocket(shape, raw = {}, role = 'part') {
  if (role === 'mouth' || /^mouth/.test(shape)) return 'head.mouth';
  if (role === 'eye' || /eye/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightEye' : 'head.leftEye';
  if (shape === 'mascotBody') return 'body.center';
  if (shape === 'mascotHead') return 'head.center';
  if (/ear/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightEar' : 'head.leftEar';
  if (/horn|antenna/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightHorn' : 'head.leftHorn';
  if (/snout|beak/i.test(shape)) return 'head.mouth';
  if (/hoof/.test(shape) && /hand|arm|shoulder/i.test(`${raw.id || ''} ${raw.anchor || ''} ${raw.attach?.socket || ''}`)) return sideFromRaw(raw) === 'right' ? 'body.rightHand' : 'body.leftHand';
  if (/hoof|boot/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightFoot' : 'body.leftFoot';
  if (/stubbyLeg|\bleg\b/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightHip' : 'body.leftHip';
  if (/arm|mitten|paw|claw|tentacle|flipper|wing|finLimb/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightHand' : 'body.leftHand';
  if (/patch|spot|stripe|panel|button|badge/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.patchRight' : 'body.patchLeft';
  if (/tie|bowtie/.test(shape)) return 'body.front';
  return null;
}

function normalizeAttach(raw, shape, role) {
  const requested = raw?.attach && typeof raw.attach === 'object' ? String(raw.attach.socket || '') : '';
  const allowed = SOCKET_COMPATIBILITY[shape];
  if (requested && ATTACHMENT_SOCKET_NAMES.has(requested) && (!allowed || allowed.includes(requested))) return { socket: requested };
  const inferred = inferSocket(shape, raw, role);
  if (inferred && ATTACHMENT_SOCKET_NAMES.has(inferred) && (!allowed || allowed.includes(inferred))) return { socket: inferred };
  return null;
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

function fallbackDrawingLayers(prompt = '', options = {}) {
  const preset = !options.skipPreset ? matchQualityPreset(prompt) : null;
  if (preset?.layers?.length) return preset.layers;
  const l = prompt.toLowerCase();
  const mat = materialForPrompt(prompt);
  const eyeShape = /funny|idea|abstract|silly/.test(l) ? 'googlyEye' : /computer|robot|screen/.test(l) ? 'pixelEye' : 'cuteEye';
  const mouthShape = /computer|robot|screen/.test(l) ? 'mouthScreen' : /funny|idea|abstract|joke/.test(l) ? 'mouthGrin' : /bird|duck|chicken/.test(l) ? 'beak' : 'mouthSmile';
  const bodyMaterial = /idea|funny|abstract|joke/.test(l) ? 'glossyGold' : mat;
  const layers = [
    layer('shadow', 'ground', 0, 6, 0.98, 0.18, 'shadow', { opacity: 0.24, z: -10 }),
    layer('mascotBody', 'free', 0, 0, 0.62, 0.6, bodyMaterial, { z: 2, attach: { socket: 'body.center' } }),
    layer('stubbyLeg', 'free', 0, -4, 0.21, 0.25, bodyMaterial, { z: 4, attach: { socket: 'body.leftHip' } }),
    layer('stubbyLeg', 'free', 0, -4, 0.21, 0.25, bodyMaterial, { z: 4, attach: { socket: 'body.rightHip' } }),
    layer('hoof', 'free', 0, -4, 0.2, 0.13, 'charcoalRubber', { z: 6, attach: { socket: 'body.leftFoot' } }),
    layer('hoof', 'free', 0, -4, 0.2, 0.13, 'charcoalRubber', { z: 6, attach: { socket: 'body.rightFoot' } }),
    layer('mascotHead', 'free', 0, 0, 0.94, 0.84, bodyMaterial, { z: 8, attach: { socket: 'head.center' } }),
  ];
  if (!/computer|monitor|screen|car|boat|sail|rocket/.test(l)) {
    layers.push(
      layer('stubbyArm', 'free', -2, 0, 0.22, 0.26, bodyMaterial, { rotate: -10, z: 5, attach: { socket: 'body.leftHand' } }),
      layer('stubbyArm', 'free', 2, 0, 0.22, 0.26, bodyMaterial, { rotate: 10, z: 5, attach: { socket: 'body.rightHand' } }),
    );
  }
  if (/cat|dog|bear|rabbit|bunny|animal|mouse|fox|tiger|lion|elephant/.test(l)) {
    layers.push(layer('softEar', 'free', -3, 6, 0.34, 0.42, bodyMaterial, { rotate: -24, z: 9, attach: { socket: 'head.leftEar' } }), layer('softEar', 'free', 3, 6, 0.34, 0.42, bodyMaterial, { rotate: 24, z: 9, attach: { socket: 'head.rightEar' } }));
  }
  if (/dragon|unicorn|goat|horn|devil|monster/.test(l)) {
    layers.push(layer('softHorn', 'free', 0, 0, 0.18, 0.34, 'canvas', { rotate: -8, z: 10, attach: { socket: 'head.leftHorn' } }), layer('softHorn', 'free', 0, 0, 0.18, 0.34, 'canvas', { rotate: 8, z: 10, attach: { socket: 'head.rightHorn' } }));
  }
  if (/alien|robot|bug|insect/.test(l)) {
    layers.push(layer('antenna', 'free', 0, 0, 0.22, 0.36, 'neon', { rotate: -18, z: 10, attach: { socket: 'head.leftHorn' } }), layer('antenna', 'free', 0, 0, 0.22, 0.36, 'neon', { rotate: 18, z: 10, attach: { socket: 'head.rightHorn' } }));
  }
  if (/cow|dog|pig|bear|mouse|fox|cat|animal/.test(l)) layers.push(layer('snout', 'free', 0, -2, 0.42, 0.24, 'warmCream', { z: 24, attach: { socket: 'head.mouth' } }));
  if (/spot|cow|dog|dalmatian|pattern/.test(l)) layers.push(layer('bodyPatch', 'free', 0, 0, 0.3, 0.22, 'charcoalRubber', { rotate: -10, z: 11, attach: { socket: 'body.patchLeft' } }), layer('bodyPatch', 'free', 0, 0, 0.23, 0.16, 'charcoalRubber', { rotate: 8, z: 11, attach: { socket: 'body.patchRight' } }));
  if (/computer|monitor|screen/.test(l)) layers.push(layer('screen', 'free', 0, 2, 0.5, 0.28, 'screenGlow', { z: 13, attach: { socket: 'body.front' } }), layer('button', 'free', -20, 28, 0.14, 0.14, 'glossyRed', { z: 14, attach: { socket: 'body.front' } }));
  if (/car|truck|vehicle/.test(l)) layers.push(layer('carBody', 'ground', 0, -34, 0.7, 0.3, 'glossyRed', { z: 13 }), layer('wheel', 'ground', -50, -20, 0.25, 0.25, 'charcoalRubber', { z: 15 }), layer('wheel', 'ground', 50, -20, 0.25, 0.25, 'charcoalRubber', { z: 15 }));
  if (/sail|boat|ship/.test(l)) layers.push(layer('hull', 'ground', 0, -34, 0.72, 0.26, 'wood', { z: 13 }), layer('curvedSail', 'free', 8, -20, 0.45, 0.62, 'canvas', { z: 12, attach: { socket: 'head.rightHorn' } }));
  if (/rocket|spaceship|space ship/.test(l)) layers.push(layer('rocket', 'free', 0, -12, 0.38, 0.54, 'glossyPurple', { z: 13, attach: { socket: 'body.front' } }));
  if (/idea|funny|abstract|joke/.test(l)) layers.push(layer('question', 'orbit', -158, -120, 0.36, 0.36, 'neon', { z: 12 }), layer('spark', 'orbit', 156, -150, 0.42, 0.42, 'glossyGold', { z: 12 }));
  if (/zebra|stripe|striped/.test(l)) layers.push(layer('stripe', 'free', -10, -12, 0.42, 0.24, 'charcoalRubber', { rotate: -18, z: 12, attach: { socket: 'body.front' } }), layer('stripe', 'free', 10, 14, 0.34, 0.2, 'charcoalRubber', { rotate: -18, z: 12, attach: { socket: 'body.patchRight' } }));
  if (/skateboard|skate board/.test(l)) layers.push(layer('roundedBox', 'ground', 0, -28, 0.78, 0.16, 'wood', { z: 14 }), layer('wheel', 'ground', -58, -14, 0.24, 0.24, 'charcoalRubber', { z: 15 }), layer('wheel', 'ground', 58, -14, 0.24, 0.24, 'charcoalRubber', { z: 15 }));
  if (/dragon|bird|bat|wing/.test(l)) layers.push(layer('wing', 'free', -8, 4, 0.42, 0.34, bodyMaterial, { rotate: -22, z: 3, attach: { socket: 'body.leftShoulder' } }), layer('wing', 'free', 8, 4, 0.42, 0.34, bodyMaterial, { rotate: 22, z: 3, attach: { socket: 'body.rightShoulder' } }));
  layers.push(
    layer(eyeShape, 'free', 0, 0, 0.24, 0.24, 'softWhite', { role: 'eye', z: 20, attach: { socket: 'head.leftEye' } }),
    layer(eyeShape, 'free', 0, 0, 0.24, 0.24, 'softWhite', { role: 'eye', z: 20, attach: { socket: 'head.rightEye' } }),
    layer(mouthShape, 'free', 0, mouthShape === 'mouthGrin' ? 10 : 14, mouthShape === 'beak' ? 0.38 : 0.22, mouthShape === 'beak' ? 0.22 : 0.09, 'charcoalRubber', { role: 'mouth', z: 31, attach: { socket: 'head.mouth' } }),
  );
  return layers;
}

function sanitizeDrawingLayers(rawLayers, prompt = '') {
  const initialSource = Array.isArray(rawLayers) && rawLayers.length ? rawLayers : fallbackDrawingLayers(prompt);
  const hasCore = initialSource.some(raw => raw?.shape === 'mascotBody' || raw?.shape === 'mascotHead');
  const source = !hasCore ? fallbackDrawingLayers(prompt, { skipPreset: true }) : initialSource;
  const cleaned = source.slice(0, drawingGrammar.rules?.maxLayers || 42).map((raw, index) => {
    const shape = DRAWING_SHAPES.has(raw?.shape) ? raw.shape : 'blob';
    if (shape === 'shadow') return null;
    const role = raw?.role === 'mouth' ? 'mouth' : raw?.role === 'eye' ? 'eye' : 'part';
    const attach = normalizeAttach(raw, shape, role);
    if (!attach && FLOATING_ARTIFACT_SHAPES.has(shape) && (!raw?.anchor || raw.anchor === 'free' || raw.anchor === 'orbit')) return null;
    const anchor = attach ? 'free' : DRAWING_ANCHORS.has(raw?.anchor) ? raw.anchor : 'free';
    const rawScale = Array.isArray(raw?.scale) ? raw.scale : [raw?.sx, raw?.sy];
    const baseScale = role === 'mouth' && !['beak', 'mouthScreen', 'mouthGrille'].includes(shape)
      ? [Math.max(Number(rawScale?.[0]) || 0, STANDARD_MOUTH_SCALE.x), Math.max(Number(rawScale?.[1]) || 0, STANDARD_MOUTH_SCALE.y)]
      : shape === 'snout'
        ? [Math.min(Number(rawScale?.[0]) || 0.28, 0.32), Math.min(Number(rawScale?.[1]) || 0.15, 0.17)]
        : rawScale;
    const scale = shape === 'mascotHead'
      ? [Math.max(Number(baseScale?.[0]) || 0, 0.9), Math.max(Number(baseScale?.[1]) || 0, 0.78)]
      : shape === 'mascotBody'
        ? [Math.min(Number(baseScale?.[0]) || 1, 0.68), Math.min(Number(baseScale?.[1]) || 1, 0.66)]
        : baseScale;
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
      role,
      z: clampDrawingNumber(raw?.z, -20, 40, index),
      attach,
    };
  }).filter(Boolean).sort((a, b) => a.z - b.z);
  if (!cleaned.some(item => item.role === 'mouth')) cleaned.push(layer('mouthSmile', 'free', 0, 14, STANDARD_MOUTH_SCALE.x, STANDARD_MOUTH_SCALE.y, 'charcoalRubber', { role: 'mouth', z: 30, attach: { socket: 'head.mouth' } }));
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
  const preset = presetSceneSpec(prompt);
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
  const [mouthPhase, setMouthPhase] = useState(0);
  const [buildProgress, setBuildProgress] = useState(0);
  const [log, setLog] = useState(['Ready for one-click live mode.']);
  const [debug, setDebug] = useState('idle — press Start');
  const [brainStatus, setBrainStatus] = useState(BRAIN_ENABLED ? 'speaker agent: standby' : 'speaker agent: off');
  const [voiceInventory, setVoiceInventory] = useState([]);
  const [voiceChoice, setVoiceChoice] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('voice: loading browser voices');
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [micStatus, setMicStatus] = useState('mic devices: not checked');
  const [typedFallback, setTypedFallback] = useState('');
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const speakingTimer = useRef(null);
  const mouthCloseTimer = useRef(null);
  const mouthStepRef = useRef(0);
  const lastMouthPulseRef = useRef(0);
  const activatedRef = useRef(false);
  const statusRef = useRef('idle');
  const listenTokenRef = useRef(0);
  const listenRestartTimerRef = useRef(null);
  const listenerOptionsRef = useRef({});
  const sessionIdRef = useRef(window.crypto?.randomUUID?.() || `mydude-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const voiceRef = useRef(null);
  const speechRunRef = useRef(0);
  const streamQueueRef = useRef([]);
  const streamSpeakingRef = useRef(false);
  const streamAfterRef = useRef(null);
  const speakerSocketRef = useRef(null);
  const speechStartedAtRef = useRef(0);
  const bargeInFramesRef = useRef(0);
  const bargeInCooldownRef = useRef(0);
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
    clearTimeout(listenRestartTimerRef.current);
    audioRef.current?.getTracks?.().forEach(track => track.stop());
  }, []);

  function estimateSyllables(text = '') {
    const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
    return Math.max(1, words.reduce((total, word) => {
      const compact = word.replace(/(?:e|ed|es)$/i, '');
      const groups = compact.match(/[aeiouy]+/g)?.length || 1;
      return total + Math.max(1, groups);
    }, 0));
  }

  function mouthPulseMsForText(text = '', rate = 1) {
    const words = Math.max(1, (String(text).match(/\S+/g) || []).length);
    const syllables = estimateSyllables(text);
    const safeRate = Math.max(0.72, Math.min(1.35, Number(rate) || 1));
    const estimatedSpeechMs = Math.max(800, (words / 2.45) * 1000 / safeRate);
    const syllableMs = estimatedSpeechMs / Math.max(1, syllables);
    return Math.max(105, Math.min(210, syllableMs));
  }

  function estimateUtteranceMs(text = '', rate = 1) {
    const words = Math.max(1, (String(text).match(/\S+/g) || []).length);
    const safeRate = Math.max(0.72, Math.min(1.35, Number(rate) || 1));
    return Math.max(900, Math.min(12000, (words / 2.35) * 1000 / safeRate + 650));
  }

  function pulseMouthFrame(forceOpen = false, minGap = 65) {
    const now = performance.now();
    if (!forceOpen && now - lastMouthPulseRef.current < minGap) return;
    lastMouthPulseRef.current = now;
    mouthStepRef.current = forceOpen ? 0 : (mouthStepRef.current + 1) % MOUTH_SEQUENCE.length;
    setMouthPhase(forceOpen ? 2 : MOUTH_SEQUENCE[mouthStepRef.current]);
    clearTimeout(mouthCloseTimer.current);
    mouthCloseTimer.current = setTimeout(() => setMouthPhase(0), MOUTH_CLOSE_MS);
  }

  function stopAudioMeter() {
    cancelAnimationFrame(animationRef.current);
    audioRef.current?.getTracks?.().forEach(track => track.stop());
    audioRef.current = null;
    analyserRef.current = null;
  }

  function stopSpeakingAndListen(reason = 'voice interruption') {
    if (!activatedRef.current || statusRef.current !== 'speaking') return;
    const now = performance.now();
    if (now - bargeInCooldownRef.current < 1200) return;
    bargeInCooldownRef.current = now;
    bargeInFramesRef.current = 0;
    speechRunRef.current += 1;
    streamQueueRef.current = [];
    streamSpeakingRef.current = false;
    streamAfterRef.current = null;
    try { speakerSocketRef.current?.close?.(); } catch {}
    speakerSocketRef.current = null;
    window.speechSynthesis?.cancel?.();
    clearInterval(speakingTimer.current);
    clearTimeout(mouthCloseTimer.current);
    setMouthPhase(0);
    statusRef.current = 'listening';
    setStatus('listening');
    setMessage('I stopped talking. Listening now.');
    setDebug(`${reason} — speech stopped, listener restarting`);
    appendLog('User interrupted while I was speaking; returned to listener.');
    resumeListening();
  }

  async function activate() {
    activatedRef.current = true;
    setActivated(true);

    const platform = detectVoicePlatform();
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const refreshedVoice = pickBestVoice(voices, platform);
    if (refreshedVoice) {
      voiceRef.current = refreshedVoice;
      setVoiceChoice({ name: refreshedVoice.name, lang: refreshedVoice.lang, localService: refreshedVoice.localService, default: refreshedVoice.default, platform, manual: false });
      setVoiceStatus(`voice: ${refreshedVoice.name} (${refreshedVoice.lang || 'unknown'})`);
    }

    if (platform === 'mac' && isChromeBrowser()) {
      listenerOptionsRef.current = { desktopChrome: true };
      setMessage('Listening now. Say anything.');
      setTranscript('Listening… say something now.');
      setDebug('start clicked — desktop Chrome mic permission first');
      appendLog('Live mode activated. Desktop Chrome mic permission primed before listener start.');
      const meterStarted = await startAudioMeter();
      if (meterStarted) {
        window.setTimeout(() => {
          if (!activatedRef.current) return;
          stopAudioMeter();
          setMicStatus('meter released before Web Speech start');
          startListening({ desktopChrome: true });
        }, 450);
      } else {
        startListening({ desktopChrome: true });
      }
      return;
    }

    listenerOptionsRef.current = {};
    setMessage("Hey, what's up?");
    setTranscript('Greeting… then I will listen.');
    setDebug('start clicked — greeting first, listener next');
    appendLog('Live mode activated. Greeting from the click before listener starts.');
    speak("Hey, what's up?", {
      rate: 1.02,
      after: () => {
        setTranscript('Listening… say something now.');
        resumeListening();
        startAudioMeter();
      },
    });
  }

  async function refreshMicDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setMicStatus('mic devices: enumerateDevices unavailable');
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(device => device.kind === 'audioinput');
      setMicDevices(inputs);
      setMicStatus(inputs.length ? `mic devices: ${inputs.length} input(s)` : 'mic devices: none exposed');
      return inputs;
    } catch (error) {
      setMicStatus(`mic devices error: ${error.message || 'unknown'}`);
      return [];
    }
  }

  async function startAudioMeter(deviceId = selectedMicId) {
    try {
      stopAudioMeter();
      const audioConstraint = deviceId ? { deviceId: { exact: deviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      audioRef.current = stream;
      await refreshMicDevices();
      const track = stream.getAudioTracks?.()[0];
      const label = track?.label || 'default/unnamed mic';
      setMicStatus(`meter active: ${label}`);
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextCtor();
      if (ctx.state === 'suspended') await ctx.resume?.();
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
        if (statusRef.current === 'speaking' && activatedRef.current) {
          const speakingLongEnough = performance.now() - speechStartedAtRef.current > BARGE_IN_MIN_SPEECH_MS;
          const loudEnoughForBargeIn = avg > BARGE_IN_VOLUME_THRESHOLD;
          bargeInFramesRef.current = speakingLongEnough && loudEnoughForBargeIn ? bargeInFramesRef.current + 1 : 0;
          if (bargeInFramesRef.current >= BARGE_IN_REQUIRED_FRAMES) stopSpeakingAndListen('user started talking');
        } else {
          bargeInFramesRef.current = 0;
        }
        animationRef.current = requestAnimationFrame(loop);
      };
      loop();
      return true;
    } catch (error) {
      const reason = error?.name || error?.message || 'unknown';
      setMicStatus(`meter unavailable: ${reason}`);
      appendLog(`Mic meter unavailable: ${reason}`);
      return false;
    }
  }

  async function changeMicDevice(event) {
    const deviceId = event.target.value;
    setSelectedMicId(deviceId);
    setMicStatus('switching mic…');
    await startAudioMeter(deviceId);
  }

  function resumeListening() {
    startListening(listenerOptionsRef.current || {});
  }

  function startListening(options = {}) {
    listenerOptionsRef.current = options;
    const listenToken = listenTokenRef.current + 1;
    listenTokenRef.current = listenToken;
    clearTimeout(listenRestartTimerRef.current);
    window.speechSynthesis?.cancel?.();
    speechRunRef.current += 1;
    clearInterval(speakingTimer.current);
    setMouthPhase(0);
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
    recognition.onaudiostart = () => setDebug('audio capture started');
    recognition.onaudioend = () => setDebug('audio capture ended');
    recognition.onsoundstart = () => setDebug('sound detected');
    recognition.onsoundend = () => setDebug('sound ended');
    recognition.onspeechstart = () => setDebug('speech detected');
    recognition.onspeechend = () => setDebug('speech ended');
    recognition.onnomatch = () => setDebug('listener no-match');
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
        setMessage('Chrome is blocking microphone/speech. Click the lock icon in the address bar and allow Microphone, then press Start again.');
      }
      setStatus('idle');
    };
    recognition.onend = () => {
      const isDesktopChrome = Boolean(options.desktopChrome);
      setDebug(isDesktopChrome ? 'listener ended — waiting before retry' : 'listener ended');
      if (listenToken !== listenTokenRef.current || recognitionRef.current !== recognition) return;
      if (activatedRef.current && !['building', 'speaking'].includes(statusRef.current)) {
        const restartDelay = isDesktopChrome ? 2200 : 350;
        listenRestartTimerRef.current = window.setTimeout(() => {
          if (listenToken !== listenTokenRef.current || recognitionRef.current !== recognition) return;
          if (!activatedRef.current || ['building', 'speaking'].includes(statusRef.current)) return;
          if (isDesktopChrome) {
            setDebug('desktop listener retrying after silence');
            startListening(options);
            return;
          }
          try {
            recognition.start();
            setDebug('listener restarted');
          } catch (error) {
            setDebug(`restart blocked: ${error.message || 'unknown'}`);
          }
        }, restartDelay);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      if (options.desktopChrome) {
        window.setTimeout(() => {
          if (listenToken !== listenTokenRef.current || recognitionRef.current !== recognition) return;
          if (statusRef.current === 'listening') return;
          setDebug('desktop Chrome listener did not confirm start — retrying');
          try { recognition.abort?.(); } catch {}
          window.setTimeout(() => startListening(options), 120);
        }, 900);
      }
    } catch (error) {
      setDebug(`start failed: ${error.message || 'unknown'}`);
      setMessage('Chrome did not start the listener. Press Stop, then Start again.');
      setStatus('idle');
    }
  }

  function submitTypedFallback(event) {
    event?.preventDefault?.();
    const text = typedFallback.trim();
    if (!text) return;
    setTypedFallback('');
    setTranscript(text);
    setMessage(`I heard: ${text}`);
    setDebug('typed desktop fallback submitted');
    handleUserUtterance(text);
  }

  function handleUserUtterance(text) {
    appendLog(`Heard: ${text}`);
    listenTokenRef.current += 1;
    clearTimeout(listenRestartTimerRef.current);
    try { recognitionRef.current?.abort?.(); } catch {}
    if (wantsReset(text)) {
      resetDemo();
      return;
    }
    if (shouldUpdateAvatar(text)) buildAvatar(text);
    else talkWithBrain(text);
  }

  function wantsReset(text = '') {
    return /(reset|start over|clear (it|this|avatar|everything)|new session|go back to default)/i.test(text);
  }

  function shouldUpdateAvatar(text) {
    return /\b(look like|make (you|him|it)|avatar|turn into|become|transform|change into|be a|be an|robot|cat|alien|computer|sailboat|boat|car|truck|cow|animal|monster|dragon|idea|funny idea|glasses|hat|blue|green|red|purple|gold|yellow|pink|eyes?)\b/i.test(text);
  }

  function talkWithBrain(prompt) {
    statusRef.current = 'speaking';
    setStatus('speaking');
    setMessage('Thinking…');
    setBuildProgress(0);
    startAudioMeter();
    const fallbackReply = '';
    const finish = () => { statusRef.current = 'listening'; setStatus('listening'); resumeListening(); };
    if (BRAIN_ENABLED) startStreamingSpeakerReply(prompt, null, fallbackReply, finish);
    else finish();
  }

  function buildAvatar(prompt) {
    statusRef.current = 'building';
    setStatus('building');
    setMessage('Thinking…');
    setBuildProgress(8);
    startAudioMeter();
    const built = makeAvatar(prompt);
    const fallbackReply = 'Done.';
    const finish = () => { statusRef.current = 'listening'; setStatus('listening'); resumeListening(); };

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
    speechStartedAtRef.current = Number.POSITIVE_INFINITY;
    bargeInFramesRef.current = 0;
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

    const finishWithoutFallbackSpeech = (statusText) => {
      setBrainStatus(statusText);
      if (fallback) {
        setMessage(fallback);
        speak(fallback, { after });
      } else {
        setMessage('Listening now. Say anything.');
        after?.();
      }
    };

    const timeout = window.setTimeout(() => {
      if (settled || firstSpoken) return;
      settled = true;
      finishWithoutFallbackSpeech('speaker agent: timeout, returning to listener');
    }, 4500);

    try {
      const socket = new WebSocket(BRIDGE_WS_URL);
      speakerSocketRef.current = socket;
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
          const display = plainSpeechText(fullText);
          if (display) setMessage(display);
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
          if (payload.personality) personalityRef.current = payload.personality;
          if (payload.sceneSpec) {
            const nextScene = sanitizeSceneSpec(payload.sceneSpec, prompt);
            setAvatar(nextScene);
            appendLog(`Scene built: ${nextScene.summary}`);
          }
          const display = plainSpeechText(fullText || payload.text || fallback) || fallback;
          pending = '';
          streamQueueRef.current = [];
          streamSpeakingRef.current = false;
          streamAfterRef.current = null;
          if (speakerSocketRef.current === socket) speakerSocketRef.current = null;
          setBrainStatus(`speaker agent: final speech in ${payload.elapsedMs || Math.round(performance.now() - started)}ms`);
          if (display) {
            setMessage(display);
            appendLog(`Speaker agent: ${display}`);
            speak(display, { after });
          } else {
            setMessage('Listening now. Say anything.');
            after?.();
          }
          try { socket.close(); } catch {}
        }
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        finishWithoutFallbackSpeech('speaker agent: connection error, returning to listener');
      };
      socket.onclose = () => {
        if (speakerSocketRef.current === socket) speakerSocketRef.current = null;
      };
    } catch {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        finishWithoutFallbackSpeech('speaker agent: unavailable, returning to listener');
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
    const started = performance.now();
    const check = () => {
      if (speechRun !== speechRunRef.current) return;
      const browserSpeaking = !!window.speechSynthesis?.speaking;
      const queueEmpty = !streamSpeakingRef.current && streamQueueRef.current.length === 0;
      const stalledAfterSpeech = performance.now() - started > 45000 && !browserSpeaking;
      if (queueEmpty || stalledAfterSpeech) {
        if (stalledAfterSpeech) {
          appendLog('Speaker stream watchdog restored listener after speech ended.');
          streamSpeakingRef.current = false;
          streamQueueRef.current = [];
          clearInterval(speakingTimer.current);
          clearTimeout(mouthCloseTimer.current);
          setMouthPhase(0);
        }
        const after = streamAfterRef.current;
        streamAfterRef.current = null;
        after?.();
        return;
      }
      window.setTimeout(check, 160);
    };
    check();
  }

  function drainSpeechQueue(speechRun) {
    if (streamSpeakingRef.current || speechRun !== speechRunRef.current || !window.speechSynthesis) return;
    const chunk = streamQueueRef.current.shift();
    if (!chunk) return;
    streamSpeakingRef.current = true;
    speechStartedAtRef.current = Number.POSITIVE_INFINITY;
    bargeInFramesRef.current = 0;
    if (chunk.type === 'pause') {
      setMouthPhase(0);
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
    if (voiceRef.current && isEnglishVoice(voiceRef.current)) {
      utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }
    const pulseMouth = () => pulseMouthFrame(false, 90);
    const startMouthPulse = () => {
      speechStartedAtRef.current = performance.now();
      const pulseMs = mouthPulseMsForText(chunk.text, utterance.rate || 1);
      pulseMouthFrame(true);
      clearInterval(speakingTimer.current);
      speakingTimer.current = setInterval(pulseMouth, Math.max(MOUTH_PULSE_MS, pulseMs));
    };
    utterance.onstart = startMouthPulse;
    utterance.onboundary = (event) => {
      if (event.name === 'word' || event.charIndex >= 0) pulseMouth();
    };
    let finished = false;
    let watchdog = null;
    const done = () => {
      if (finished) return;
      finished = true;
      if (watchdog) window.clearTimeout(watchdog);
      if (speechRun !== speechRunRef.current) return;
      clearInterval(speakingTimer.current);
      clearTimeout(mouthCloseTimer.current);
      setMouthPhase(0);
      window.setTimeout(() => {
        streamSpeakingRef.current = false;
        drainSpeechQueue(speechRun);
      }, chunk.pauseAfter || 40);
    };
    utterance.onend = done;
    utterance.onerror = done;
    watchdog = window.setTimeout(done, estimateUtteranceMs(chunk.text, utterance.rate || 1) + 1800);
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
    speechStartedAtRef.current = Number.POSITIVE_INFINITY;
    bargeInFramesRef.current = 0;
    const speechPlan = options.speechPlan || compileSpeechPlan(text, options);
    const chunks = speechPlan.chunks.length ? speechPlan.chunks : [{ type: 'speak', text: plainSpeechText(text), ...DEFAULT_PROSODY }];
    setStatus('speaking');
    if (speechPlan.displayText && speechPlan.displayText !== text) appendLog(`Speech directed: ${speechPlan.displayText}`);

    const pulseMouth = () => pulseMouthFrame(false, 90);
    const startMouthPulse = (text = '', rate = 1) => {
      speechStartedAtRef.current = performance.now();
      const pulseMs = mouthPulseMsForText(text, rate);
      pulseMouthFrame(true);
      clearInterval(speakingTimer.current);
      speakingTimer.current = setInterval(pulseMouth, Math.max(MOUTH_PULSE_MS, pulseMs));
    };

    const speakChunk = (index = 0) => {
      if (speechRun !== speechRunRef.current) return;
      const chunk = chunks[index];
      if (!chunk) {
        clearInterval(speakingTimer.current);
        clearTimeout(mouthCloseTimer.current);
        setMouthPhase(0);
        options.after?.();
        return;
      }
      if (chunk.type === 'pause') {
        setMouthPhase(0);
        window.setTimeout(() => speakChunk(index + 1), chunk.duration);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      speechStartedAtRef.current = Number.POSITIVE_INFINITY;
      bargeInFramesRef.current = 0;
      utterance.rate = chunk.rate || options.rate || 1.08;
      utterance.pitch = chunk.pitch || 1.08;
      utterance.volume = chunk.volume ?? 1;
      if (voiceRef.current && isEnglishVoice(voiceRef.current)) {
        utterance.voice = voiceRef.current;
        utterance.lang = voiceRef.current.lang || 'en-US';
      } else {
        utterance.lang = 'en-US';
      }
      utterance.onstart = () => startMouthPulse(chunk.text, utterance.rate || 1);
      utterance.onboundary = (event) => {
        if (event.name === 'word' || event.charIndex >= 0) pulseMouth();
      };
      let finished = false;
      let watchdog = null;
      const finishChunk = (delay = chunk.pauseAfter || 40) => {
        if (finished) return;
        finished = true;
        if (watchdog) window.clearTimeout(watchdog);
        if (speechRun !== speechRunRef.current) return;
        clearInterval(speakingTimer.current);
        clearTimeout(mouthCloseTimer.current);
        setMouthPhase(0);
        window.setTimeout(() => speakChunk(index + 1), delay);
      };
      utterance.onend = () => finishChunk();
      utterance.onerror = () => finishChunk(80);
      watchdog = window.setTimeout(() => finishChunk(), estimateUtteranceMs(chunk.text, utterance.rate || 1) + 1800);
      window.speechSynthesis.speak(utterance);
    };

    speakChunk();
  }

  function stopDemo() {
    listenTokenRef.current += 1;
    activatedRef.current = false;
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
    window.speechSynthesis?.cancel?.();
    clearTimeout(listenRestartTimerRef.current);
    speechRunRef.current += 1;
    streamQueueRef.current = [];
    streamSpeakingRef.current = false;
    streamAfterRef.current = null;
    try { speakerSocketRef.current?.close?.(); } catch {}
    speakerSocketRef.current = null;
    clearInterval(speakingTimer.current);
    clearTimeout(mouthCloseTimer.current);
    stopAudioMeter();
    setActivated(false);
    setStatus('idle');
    statusRef.current = 'idle';
    setTranscript('');
    setMessage('Tap Start. I will listen, talk, and build my cartoon avatar in under one minute.');
    setMouthPhase(0);
    setVolume(0.18);
    setBuildProgress(0);
    setAvatar(null);
    personalityRef.current = null;
    listenerOptionsRef.current = {};
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = window.crypto?.randomUUID?.() || `mydude-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    resetSpeakerSession(previousSessionId);
    setDebug('stopped — press Start');
    setBrainStatus(BRAIN_ENABLED ? 'speaker agent: standby' : 'speaker agent: off');
    appendLog('Demo stopped. Back at Start.');
  }

  function resetDemo() {
    listenTokenRef.current += 1;
    clearTimeout(listenRestartTimerRef.current);
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    speechRunRef.current += 1;
    try { speakerSocketRef.current?.close?.(); } catch {}
    speakerSocketRef.current = null;
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
    speak('Reset complete. I am listening.', { after: resumeListening });
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

  return <main className={`demo-page ${VOICE_DEBUG_ENABLED ? 'debug-mode' : ''}`} data-debug-mode={VOICE_DEBUG_ENABLED ? 'on' : 'off'} style={{ '--start': colors.start, '--mid': colors.mid, '--end': colors.end, '--accent': colors.accent }}>
    {VOICE_DEBUG_ENABLED && <aside style={{ position: 'fixed', top: 8, left: 8, right: 8, zIndex: 99999, padding: 12, borderRadius: 14, background: 'rgba(2,6,23,.96)', color: '#fff', border: '2px solid #22c55e', boxShadow: '0 18px 60px rgba(0,0,0,.55)', fontSize: 13, lineHeight: 1.35, pointerEvents: 'auto' }}>
      <strong style={{ color: '#86efac' }}>DEBUG MODE ON</strong>
      <div><strong>Mic:</strong> {debug}</div>
      <div><strong>Transcript:</strong> {transcript || 'waiting for voice...'}</div>
      <div><strong>Voice:</strong> {voiceStatus}</div>
      <div><strong>Mic meter:</strong> {micStatus} · level {Math.round(volume * 100)}%</div>
      <label style={{ display: 'block', marginTop: 6 }}><strong>Input:</strong> <select value={selectedMicId} onChange={changeMicDevice} style={{ maxWidth: '100%', marginLeft: 6, color: '#111', background: '#fff' }}>
        <option value="">Chrome default microphone</option>
        {micDevices.map((device, index) => <option value={device.deviceId} key={device.deviceId || index}>{device.label || `Microphone ${index + 1}`}</option>)}
      </select></label>
      <div style={{ height: 8, marginTop: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(148,163,184,.35)' }}><span style={{ display: 'block', height: '100%', width: `${Math.round(volume * 100)}%`, background: '#22c55e' }} /></div>
      <form onSubmit={submitTypedFallback} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input value={typedFallback} onChange={event => setTypedFallback(event.target.value)} placeholder="Desktop fallback: type what you said" style={{ flex: 1, minWidth: 0, borderRadius: 8, border: '1px solid #64748b', padding: '7px 8px', color: '#111', background: '#fff' }} />
        <button type="submit" style={{ borderRadius: 8, border: 0, padding: '7px 10px', background: '#22c55e', color: '#052e16', fontWeight: 800 }}>Send</button>
      </form>
      <div><strong>Brain:</strong> {BRAIN_ENABLED ? brainStatus : 'off'}</div>
      <div><strong>URL:</strong> {window.location.href}</div>
    </aside>}
    <section className="demo-hero compact">
      <p className="eyebrow"><Sparkles size={16}/> My Dude</p>
      <div className={`status-pill ${status}`}>{status}</div>
    </section>

    <section className="stage">
      <CartoonAvatar avatar={avatar} mouthPhase={mouthPhase} status={status} voiceTheme={avatarVoiceTheme} />
      <div className="voice-panel controls-below compact-controls">
        <div className="control-copy">
          <p>{message}</p>
          <div className="transcript live-transcript"><strong>I heard:</strong> <span>{transcript || 'waiting for voice...'}</span></div>
          <div className="listener-debug"><strong>Mic:</strong> {debug}<br/><strong>Voice:</strong> {voiceStatus}{BRAIN_ENABLED && <><br/><strong>Brain:</strong> {brainStatus}</>}</div>
        </div>
        {status === 'building' && <div className="progress"><span style={{ width: `${buildProgress}%` }} /></div>}
        <div className="actions">
          {!activated ? <button className="primary" onClick={activate}><Mic size={16}/> Start</button> : <button className="primary" onClick={stopDemo}>Stop</button>}
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


function CartoonAvatar({ avatar, mouthPhase, status, voiceTheme = {} }) {
  if (avatar?.kind === 'scene') return <SceneAvatar scene={avatar} mouthPhase={mouthPhase} status={status} voiceTheme={voiceTheme} />;
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
        <div className={`mouth ${mouthPhase > 1 ? 'open' : mouthPhase === 1 ? 'mid' : 'closed'}`} />
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

function SceneAvatar({ scene, mouthPhase, status, voiceTheme = {} }) {
  const palette = SCENE_PALETTES[scene.palette] || SCENE_PALETTES.blue;
  const [primary, dark, light] = palette;
  const layers = sanitizeDrawingLayers(scene.layers, scene.prompt || scene.title || '');
  return <div className={`avatar-card scene-card drawing-card ${status} built`} style={{ '--scene-primary': voiceTheme.bot || primary, '--scene-dark': dark, '--scene-light': light }}>
    <svg className="scene-svg drawing-svg" viewBox="0 0 720 620" role="img" aria-label={scene.summary || scene.title}>
      <defs>
        <filter id="innerGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="-3" stdDeviation="5" floodColor="#ffffff" floodOpacity="0.22"/></filter>
        {Object.entries(MATERIAL_COLORS).map(([name, colors]) => <linearGradient id={`mat-${name}`} x1="0" x2="1" y1="0" y2="1" key={name}>
          <stop offset="0%" stopColor={colors[2]} stopOpacity=".98"/><stop offset="38%" stopColor={colors[0]}/><stop offset="100%" stopColor={colors[1]}/>
        </linearGradient>)}
        {Object.entries(MATERIAL_COLORS).map(([name, colors]) => <radialGradient id={`shine-${name}`} cx="32%" cy="22%" r="74%" key={`shine-${name}`}>
          <stop offset="0%" stopColor="#fff" stopOpacity=".72"/><stop offset="36%" stopColor={colors[0]} stopOpacity=".88"/><stop offset="100%" stopColor={colors[1]} stopOpacity=".95"/>
        </radialGradient>)}
      </defs>
      <g transform="translate(360 150)">
        <g transform="scale(2)">
          <g className="drawing-character">
            {status === 'listening' && <animateTransform attributeName="transform" type="translate" values="-2 0; 2 0; -2 0" dur="5.2s" repeatCount="indefinite" additive="sum" />}
            {layers.map(item => <DrawingLayer key={item.id} item={item} mouthPhase={mouthPhase} status={status} />)}
          </g>
        </g>
      </g>
    </svg>
  </div>;
}

function DrawingLayer({ item, mouthPhase = 0, status = 'idle' }) {
  const [ax, ay] = rigPoint(item);
  const [sx, sy] = item.scale || [1, 1];
  const mouthScale = item.role === 'mouth' ? (mouthPhase === 2 ? 3 : mouthPhase === 1 ? 1.8 : 1) : 1;
  const transform = `translate(${ax + item.x} ${ay + item.y}) rotate(${item.rotate || 0}) scale(${sx} ${sy * mouthScale})`;
  const isSlowWalkingPart = status === 'listening' && (item.shape === 'stubbyLeg' || (item.shape === 'hoof' && /Foot$/.test(item.attach?.socket || '')));
  const isSpeakingArm = status === 'speaking' && item.shape === 'stubbyArm';
  return <g transform={transform} opacity={item.opacity ?? 1} className={`draw-layer draw-${item.shape} role-${item.role || 'part'}`}>
    {isSlowWalkingPart && <animateTransform attributeName="transform" type="rotate" values="-2; 2; -2" dur="3.8s" repeatCount="indefinite" additive="sum" />}
    {isSpeakingArm && <animateTransform attributeName="transform" type="rotate" values="0; 0; -4; 2; 0; 0" dur="2.8s" repeatCount="indefinite" additive="sum" />}
    <Shape3D shape={item.shape} material={item.material} mouthPhase={item.role === 'mouth' ? mouthPhase : 0} />
  </g>;
}

function fillFor(material) { return `url(#shine-${MATERIAL_COLORS[material] ? material : 'glossyBlue'})`; }
function strokeFor(material) { return MATERIAL_COLORS[material]?.[1] || '#1d4ed8'; }

function Shape3D({ shape, material = 'glossyBlue', mouthPhase = 0 }) {
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
  if (shape === 'mascotBody') return <g><path d="M-72 -70 C-38 -114 46 -112 76 -62 C112 -4 106 76 58 116 C18 150 -46 144 -78 106 C-112 64 -110 -22 -72 -70 Z" {...common} strokeWidth="6"/><path d="M-54 -54 C-28 -96 38 -92 66 -42 C88 0 74 70 36 96 C4 118 -42 108 -60 66 C-76 26 -76 -18 -54 -54 Z" fill="#fff" opacity=".14" stroke="none"/><ellipse cx="-34" cy="-30" rx="28" ry="54" fill="#fff" opacity=".22" stroke="none"/><ellipse cx="34" cy="42" rx="20" ry="42" fill="#0f172a" opacity=".035" stroke="none"/></g>;
  if (shape === 'mascotHead') return <g><path d="M-78 -52 C-42 -92 44 -92 78 -50 C110 -10 100 54 52 82 C12 106 -54 92 -82 50 C-104 16 -100 -22 -78 -52 Z" {...common} strokeWidth="6"/><ellipse cx="-28" cy="-38" rx="34" ry="15" fill="#fff" opacity=".34" stroke="none"/><path d="M-62 30 C-28 64 28 66 62 30" fill="none" stroke="#fff" strokeWidth="9" opacity=".1" strokeLinecap="round"/></g>;
  if (shape === 'stubbyArm') return <g><path d="M-24 -44 C10 -58 34 -30 30 8 C26 38 0 58 -28 44 C-52 30 -56 -28 -24 -44 Z" {...common}/><ellipse cx="-5" cy="-24" rx="14" ry="7" fill="#fff" opacity=".22" stroke="none"/></g>;
  if (shape === 'stubbyLeg') return <g><path d="M-24 -30 C6 -42 30 -16 28 20 C26 48 -10 58 -30 34 C-44 12 -42 -18 -24 -30 Z" {...common}/></g>;
  if (shape === 'hoof') return <g><ellipse rx="42" ry="28" fill="url(#shine-charcoalRubber)" stroke="#020617" strokeWidth="4"/><ellipse cx="-10" cy="-10" rx="13" ry="8" fill="#fff" opacity=".26" stroke="none"/><path d="M0 -20 V16" stroke="#94a3b8" strokeWidth="3" opacity=".45"/></g>;
  if (shape === 'cuteEye') return <g><ellipse cx="0" cy="2" rx="44" ry="42" fill="#fff" stroke="#cbd5e1" strokeWidth="4"/><circle cx="6" cy="8" r="15" fill="#020617" stroke="none"/><circle cx="0" cy="0" r="6" fill="#fff" opacity=".95" stroke="none"/><path d="M-30 -34 Q0 -52 30 -34" fill="none" stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" opacity=".75"/></g>;
  if (shape === 'bodyPatch' || shape === 'attachedSpot') return <path d="M-48 -18 C-36 -42 8 -46 40 -22 C58 -8 48 28 10 36 C-28 44 -62 12 -48 -18 Z" fill={material === 'charcoalRubber' ? '#111827' : '#334155'} stroke={material === 'charcoalRubber' ? '#020617' : '#1e293b'} strokeWidth="3" opacity=".9"/>;
  if (shape === 'stripe') return <path d="M-64 -24 C-36 -36 28 -34 64 -18 L56 4 C20 -10 -26 -8 -56 8 Z" fill="#334155" stroke="#1e293b" strokeWidth="3" opacity=".82"/>;
  if (shape === 'softEar') return <g><path d="M-44 18 C-60 -20 -18 -58 30 -38 C54 -18 28 26 -24 42 Z" fill="url(#shine-warmCream)" stroke="#fdba74" strokeWidth="5"/><path d="M-32 12 C-34 -14 -10 -36 20 -28 C30 -8 10 18 -22 30 Z" fill="#fed7aa" opacity=".55" stroke="none"/></g>;
  if (shape === 'softHorn') return <path d="M-12 40 C-8 -8 2 -44 20 -74 C18 -28 28 18 -12 40 Z" fill="url(#shine-canvas)" stroke="#d6d3d1" strokeWidth="4"/>;
  if (shape === 'carBody') return <g><rect x="-130" y="-34" width="260" height="88" rx="42" {...common}/><path d="M-58 -32 L-20 -82 H62 L104 -32 Z" fill={fill} stroke={stroke} strokeWidth="4"/><ellipse cx="-74" cy="54" rx="34" ry="34" fill="#020617"/><ellipse cx="78" cy="54" rx="34" ry="34" fill="#020617"/></g>;
  if (shape === 'windshield') return <path d="M-72 -34 H72 L50 38 H-54 Z" fill="url(#shine-blackGlass)" stroke="#bfdbfe" strokeWidth="4"/>;
  if (shape === 'wheel' || shape === 'tire') return <g><circle r="48" fill="#020617"/><circle r="22" fill="url(#shine-chrome)"/></g>;
  if (shape === 'hull') return <path d="M-140 -42 H140 L90 54 H-96 Z" {...common}/>;
  if (shape === 'sail' || shape === 'curvedSail') return <path d="M-28 92 C35 38 58 -36 30 -112 C92 -40 126 50 72 112 Z" {...common}/>;
  if (shape === 'lightbulb') return <g><path d="M-64 -18 C-64 -88 -12 -126 34 -102 C90 -72 72 2 38 34 C24 48 18 60 18 82 H-24 C-24 58 -34 48 -48 32 C-58 20 -64 2 -64 -18 Z" {...common}/><rect x="-28" y="78" width="58" height="42" rx="12" fill="url(#shine-brushedMetal)" stroke="#64748b" strokeWidth="4"/></g>;
  if (shape === 'rocket') return <g><path d="M0 -120 C74 -42 68 68 0 132 C-68 68 -74 -42 0 -120 Z" {...common}/><circle cx="0" cy="-26" r="32" fill="url(#shine-screenGlow)" stroke="#e0f2fe" strokeWidth="5"/></g>;
  if (shape === 'mouthSmile') {
    const cowMouth = material === 'warmCream';
    const mouthFill = cowMouth ? '#3b1f16' : '#0f172a';
    const mouthStroke = cowMouth ? '#6b2a1a' : '#0f172a';
    const tongueFill = cowMouth ? '#f3a6a6' : '#f472b6';
    if (mouthPhase === 2) return <g><ellipse cx="0" cy="2" rx="28" ry="28" fill={mouthFill} stroke={mouthStroke} strokeWidth="7"/><ellipse cx="0" cy="16" rx="15" ry="7" fill={tongueFill} opacity=".72" stroke="none"/><ellipse cx="-15" cy="-4" rx="8" ry="3.5" fill="#fff" opacity=".12" stroke="none"/></g>;
    if (mouthPhase === 1) return <g><ellipse cx="0" cy="3" rx="24" ry="14" fill={mouthFill} stroke={mouthStroke} strokeWidth="6"/><ellipse cx="-11" cy="0" rx="6" ry="2.5" fill="#fff" opacity=".1" stroke="none"/></g>;
    return <ellipse cx="0" cy="2" rx="17" ry="3.5" fill={cowMouth ? '#4a2418' : '#0f172a'} stroke="none"/>;
  }
  if (shape === 'mouthGrin') return <path d="M-60 -6 Q0 52 62 -6 Q0 24 -60 -6 Z" fill="#0f172a" stroke="#0f172a" strokeWidth="7"/>;
  if (shape === 'mouthO') return <ellipse rx="34" ry={mouthPhase === 2 ? 42 : mouthPhase === 1 ? 30 : 18} fill="#0f172a"/>;
  if (shape === 'mouthScreen') return <rect x="-52" y="-18" width="104" height={mouthPhase === 2 ? 48 : mouthPhase === 1 ? 36 : 22} rx="12" fill="#020617" stroke="#67e8f9" strokeWidth="4"/>;
  if (shape === 'mouthGrille') return <g stroke="#020617" strokeWidth="9" strokeLinecap="round"><path d="M-56 0 H56"/><path d="M-32 -18 V18 M0 -18 V18 M32 -18 V18"/></g>;
  if (shape === 'snout') return <g><ellipse rx="46" ry="28" fill="url(#shine-warmCream)" stroke="#92400e" strokeWidth="4"/><circle cx="-14" cy="0" r="6" fill="#020617"/><circle cx="14" cy="0" r="6" fill="#020617"/></g>;
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
