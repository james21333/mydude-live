import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGINS = (process.env.MYDUDE_ALLOWED_ORIGINS || 'https://demo.mydude.live,https://demo2.mydude.live')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const DEFAULT_ALLOWED_ORIGIN = ALLOWED_ORIGINS[0] || 'https://demo.mydude.live';
const MODEL = 'gpt-4o-mini';
const AGENT_DIR = '/home/josh/.openclaw/bridge/mydude-speaker-agent';
const AUTH_PROFILE = '/home/josh/.openclaw/agents/main/agent/auth-profiles.json';
const SERVER_CONFIG_PATH = path.join(AGENT_DIR, 'server-config.json');

let copilotTokenCache = null;
const sessionProfiles = new Map();


const DRAWING_GRAMMAR_PATH = '/home/josh/.openclaw/repos/mydude-live/shared/avatar-drawing-grammar.json';
const DRAWING_GRAMMAR = JSON.parse(readFileSync(DRAWING_GRAMMAR_PATH, 'utf8'));
const QUALITY_PRESETS = JSON.parse(readFileSync('/home/josh/.openclaw/repos/mydude-live/shared/avatar-quality-presets.json', 'utf8'));
const QUALITY_PRESET_HINTS = (QUALITY_PRESETS.presets || []).map(p => `${p.id}: ${p.summary}`).join(' | ');
const DRAWING_SHAPES = new Set(DRAWING_GRAMMAR.shapes || []);
const DRAWING_MATERIALS = new Set(DRAWING_GRAMMAR.materials || []);
const DRAWING_ANCHORS = new Set(DRAWING_GRAMMAR.anchors || []);
const ATTACHMENT_SOCKET_NAMES = new Set(DRAWING_GRAMMAR.rules?.attachmentMath?.sockets || []);
const DRAWING_PROMPT = `Use these polished house-style presets when relevant: ${QUALITY_PRESET_HINTS}. 3D cartoon drawing grammar ${DRAWING_GRAMMAR.version}. Return JSON with title, summary, palette, scene, body, head, eyes, mouth, primitives, and layers. layers is an array of up to 32 objects: {shape, anchor, x, y, scale:[sx,sy], rotate, material, role, z, attach:{socket}}. For mascot pieces prefer attach.socket and use x/y as small local offsets. Use only shapes: ${DRAWING_GRAMMAR.shapes.join(', ')}. Use only anchors: ${DRAWING_GRAMMAR.anchors.join(', ')}. Use only materials: ${DRAWING_GRAMMAR.materials.join(', ')}. Coordinates are -280..280. Required: visible face and one mouth layer with role:"mouth" attached to head.mouth when using mascot parts. Follow the house-style process: build one connected mascot silhouette first (body, overlapping head, attached limbs), then face, then details; never leave core limbs/hooves/ears/spots/patches floating like stickers; details should be embedded into or overlapping their parent surfaces. If a detail cannot be convincingly attached, omit it instead of rendering a floating artifact. Make it look like dimensional glossy 3D cartoon pieces, not flat icon art. Ignore backgrounds. For real people, do symbolic safe caricature/vibe only, not exact likeness.`;

function clampSceneNumber(value, min, max, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function materialForText(text = '') {
  const lower = text.toLowerCase();
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
function sceneLayer(shape, anchor, x, y, sx, sy, material, options = {}) { return { shape, anchor, x, y, scale: [sx, sy], material, ...options }; }

const SOCKET_COMPATIBILITY = Object.freeze({
  mascotBody: ['body.center'], mascotHead: ['head.center'],
  stubbyArm: ['body.leftShoulder', 'body.rightShoulder', 'body.leftHand', 'body.rightHand'], wing: ['body.leftShoulder', 'body.rightShoulder'], finLimb: ['body.leftShoulder', 'body.rightShoulder'], noodleArm: ['body.leftShoulder', 'body.rightShoulder'], tentacle: ['body.leftShoulder', 'body.rightShoulder', 'body.leftHand', 'body.rightHand'],
  stubbyLeg: ['body.leftHip', 'body.rightHip'], leg: ['body.leftHip', 'body.rightHip'], boot: ['body.leftFoot', 'body.rightFoot'], hoof: ['body.leftHand', 'body.rightHand', 'body.leftFoot', 'body.rightFoot'],
  paw: ['body.leftHand', 'body.rightHand', 'body.leftFoot', 'body.rightFoot'], mitten: ['body.leftHand', 'body.rightHand'], claw: ['body.leftHand', 'body.rightHand'],
  softEar: ['head.leftEar', 'head.rightEar'], animalEar: ['head.leftEar', 'head.rightEar'], softHorn: ['head.leftHorn', 'head.rightHorn'], horn: ['head.leftHorn', 'head.rightHorn'], antenna: ['head.leftHorn', 'head.rightHorn'],
  cuteEye: ['head.leftEye', 'head.rightEye'], googlyEye: ['head.leftEye', 'head.rightEye'], eyeBall: ['head.leftEye', 'head.rightEye'], pixelEye: ['head.leftEye', 'head.rightEye'], sleepyEye: ['head.leftEye', 'head.rightEye'], heartEye: ['head.leftEye', 'head.rightEye'], starEye: ['head.leftEye', 'head.rightEye'],
  snout: ['head.mouth'], beak: ['head.mouth'], mouthSmile: ['head.mouth'], mouthGrin: ['head.mouth'], mouthO: ['head.mouth'], mouthScreen: ['head.mouth'], mouthGrille: ['head.mouth'],
  bodyPatch: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'], attachedSpot: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'], spot: ['body.patchLeft', 'body.patchRight', 'head.patchLeft'], stripe: ['body.front', 'body.center'], panel: ['body.front', 'body.center'], button: ['body.front'], tie: ['body.front'], bowtie: ['body.front'], badge: ['body.front'],
});
const FLOATING_ARTIFACT_SHAPES = new Set(['hoof', 'paw', 'claw', 'softEar', 'animalEar', 'softHorn', 'horn', 'snout', 'bodyPatch', 'attachedSpot', 'spot', 'stripe', 'panel', 'button', 'badge']);
function sideFromRaw(raw = {}, fallback = 'left') { const text = `${raw.id || ''} ${raw.anchor || ''} ${raw.attach?.socket || ''}`.toLowerCase(); if (/right/.test(text) || Number(raw.x) > 0) return 'right'; if (/left/.test(text) || Number(raw.x) < 0) return 'left'; return fallback; }
function inferSocket(shape, raw = {}, role = 'part') {
  if (role === 'mouth' || /^mouth/.test(shape)) return 'head.mouth';
  if (role === 'eye' || /eye/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightEye' : 'head.leftEye';
  if (shape === 'mascotBody') return 'body.center'; if (shape === 'mascotHead') return 'head.center';
  if (/ear/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightEar' : 'head.leftEar';
  if (/horn|antenna/i.test(shape)) return sideFromRaw(raw) === 'right' ? 'head.rightHorn' : 'head.leftHorn';
  if (/snout|beak/i.test(shape)) return 'head.mouth';
  if (/hoof/.test(shape) && /hand|arm|shoulder/i.test(`${raw.id || ''} ${raw.anchor || ''} ${raw.attach?.socket || ''}`)) return sideFromRaw(raw) === 'right' ? 'body.rightHand' : 'body.leftHand';
  if (/hoof|boot/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightFoot' : 'body.leftFoot';
  if (/stubbyLeg|leg/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightHip' : 'body.leftHip';
  if (/arm|mitten|paw|claw|tentacle|flipper|wing|finLimb/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.rightHand' : 'body.leftHand';
  if (/patch|spot|stripe|panel|button|badge/.test(shape)) return sideFromRaw(raw) === 'right' ? 'body.patchRight' : 'body.patchLeft';
  if (/tie|bowtie/.test(shape)) return 'body.front';
  return null;
}
function normalizeAttach(raw, shape, role) { const requested = raw?.attach && typeof raw.attach === 'object' ? String(raw.attach.socket || '') : ''; const allowed = SOCKET_COMPATIBILITY[shape]; if (requested && ATTACHMENT_SOCKET_NAMES.has(requested) && (!allowed || allowed.includes(requested))) return { socket: requested }; const inferred = inferSocket(shape, raw, role); if (inferred && ATTACHMENT_SOCKET_NAMES.has(inferred) && (!allowed || allowed.includes(inferred))) return { socket: inferred }; return null; }

function matchQualityPreset(text = '') {
  const lower = text.toLowerCase();
  return (QUALITY_PRESETS.presets || []).find(preset => (preset.match || []).some(token => lower.includes(String(token).toLowerCase()))) || null;
}

function presetSceneSpec(text = '') {
  const preset = matchQualityPreset(text);
  if (!preset) return null;
  const base = fallbackSceneSpec(text, { skipPreset: true });
  return { ...base, title: preset.title, summary: preset.summary, palette: preset.palette || base.palette, layers: sanitizeDrawingLayers(preset.layers, text) };
}

function fallbackDrawingLayers(text = '', options = {}) {
  const preset = !options.skipPreset ? matchQualityPreset(text) : null;
  if (preset?.layers?.length) return preset.layers;
  const l = text.toLowerCase(); const mat = materialForText(text);
  const eyeShape = /funny|idea|abstract|silly/.test(l) ? 'googlyEye' : /computer|robot|screen/.test(l) ? 'pixelEye' : 'cuteEye';
  const mouthShape = /computer|robot|screen/.test(l) ? 'mouthScreen' : /funny|idea|abstract|joke/.test(l) ? 'mouthGrin' : /bird|duck|chicken/.test(l) ? 'beak' : 'mouthSmile';
  const bodyMaterial = /idea|funny|abstract|joke/.test(l) ? 'glossyGold' : mat;
  const layers = [
    sceneLayer('shadow','ground',0,6,.98,.18,'shadow',{opacity:.24,z:-10}),
    sceneLayer('mascotBody','free',0,0,.62,.6,bodyMaterial,{z:2,attach:{socket:'body.center'}}),
    sceneLayer('stubbyLeg','free',0,-4,.21,.25,bodyMaterial,{z:4,attach:{socket:'body.leftHip'}}),
    sceneLayer('stubbyLeg','free',0,-4,.21,.25,bodyMaterial,{z:4,attach:{socket:'body.rightHip'}}),
    sceneLayer('hoof','free',0,-4,.2,.13,'charcoalRubber',{z:6,attach:{socket:'body.leftFoot'}}),
    sceneLayer('hoof','free',0,-4,.2,.13,'charcoalRubber',{z:6,attach:{socket:'body.rightFoot'}}),
    sceneLayer('mascotHead','free',0,0,.94,.84,bodyMaterial,{z:8,attach:{socket:'head.center'}}),
  ];
  if (!/computer|monitor|screen|car|boat|sail|rocket/.test(l)) layers.push(sceneLayer('stubbyArm','free',-2,0,.22,.26,bodyMaterial,{rotate:-10,z:5,attach:{socket:'body.leftHand'}}), sceneLayer('stubbyArm','free',2,0,.22,.26,bodyMaterial,{rotate:10,z:5,attach:{socket:'body.rightHand'}}));
  if (/cat|dog|bear|rabbit|bunny|animal|mouse|fox|tiger|lion|elephant/.test(l)) layers.push(sceneLayer('softEar','free',-3,6,.34,.42,bodyMaterial,{rotate:-24,z:9,attach:{socket:'head.leftEar'}}), sceneLayer('softEar','free',3,6,.34,.42,bodyMaterial,{rotate:24,z:9,attach:{socket:'head.rightEar'}}));
  if (/dragon|unicorn|goat|horn|devil|monster/.test(l)) layers.push(sceneLayer('softHorn','free',0,0,.18,.34,'canvas',{rotate:-8,z:10,attach:{socket:'head.leftHorn'}}), sceneLayer('softHorn','free',0,0,.18,.34,'canvas',{rotate:8,z:10,attach:{socket:'head.rightHorn'}}));
  if (/alien|robot|bug|insect/.test(l)) layers.push(sceneLayer('antenna','free',0,0,.22,.36,'neon',{rotate:-18,z:10,attach:{socket:'head.leftHorn'}}), sceneLayer('antenna','free',0,0,.22,.36,'neon',{rotate:18,z:10,attach:{socket:'head.rightHorn'}}));
  if (/cow|dog|pig|bear|mouse|fox|cat|animal/.test(l)) layers.push(sceneLayer('snout','free',0,-2,.42,.24,'warmCream',{z:24,attach:{socket:'head.mouth'}}));
  if (/spot|cow|dog|dalmatian|pattern/.test(l)) layers.push(sceneLayer('bodyPatch','free',0,0,.3,.22,'charcoalRubber',{rotate:-10,z:11,attach:{socket:'body.patchLeft'}}), sceneLayer('bodyPatch','free',0,0,.23,.16,'charcoalRubber',{rotate:8,z:11,attach:{socket:'body.patchRight'}}));
  if (/computer|monitor|screen/.test(l)) layers.push(sceneLayer('screen','free',0,2,.5,.28,'screenGlow',{z:13,attach:{socket:'body.front'}}), sceneLayer('button','free',-20,28,.14,.14,'glossyRed',{z:14,attach:{socket:'body.front'}}));
  if (/car|truck|vehicle/.test(l)) layers.push(sceneLayer('carBody','ground',0,-34,.7,.3,'glossyRed',{z:13}), sceneLayer('wheel','ground',-50,-20,.25,.25,'charcoalRubber',{z:15}), sceneLayer('wheel','ground',50,-20,.25,.25,'charcoalRubber',{z:15}));
  if (/sail|boat|ship/.test(l)) layers.push(sceneLayer('hull','ground',0,-34,.72,.26,'wood',{z:13}), sceneLayer('curvedSail','free',8,-20,.45,.62,'canvas',{z:12,attach:{socket:'head.rightHorn'}}));
  if (/rocket|spaceship|space ship/.test(l)) layers.push(sceneLayer('rocket','free',0,-12,.38,.54,'glossyPurple',{z:13,attach:{socket:'body.front'}}));
  if (/idea|funny|abstract|joke/.test(l)) layers.push(sceneLayer('question','orbit',-158,-120,.36,.36,'neon',{z:12}), sceneLayer('spark','orbit',156,-150,.42,.42,'glossyGold',{z:12}));
  if (/zebra|stripe|striped/.test(l)) layers.push(sceneLayer('stripe','free',-10,-12,.42,.24,'charcoalRubber',{rotate:-18,z:12,attach:{socket:'body.front'}}), sceneLayer('stripe','free',10,14,.34,.2,'charcoalRubber',{rotate:-18,z:12,attach:{socket:'body.patchRight'}}));
  if (/skateboard|skate board/.test(l)) layers.push(sceneLayer('roundedBox','ground',0,-28,.78,.16,'wood',{z:14}), sceneLayer('wheel','ground',-58,-14,.24,.24,'charcoalRubber',{z:15}), sceneLayer('wheel','ground',58,-14,.24,.24,'charcoalRubber',{z:15}));
  if (/dragon|bird|bat|wing/.test(l)) layers.push(sceneLayer('wing','free',-8,4,.42,.34,bodyMaterial,{rotate:-22,z:3,attach:{socket:'body.leftShoulder'}}), sceneLayer('wing','free',8,4,.42,.34,bodyMaterial,{rotate:22,z:3,attach:{socket:'body.rightShoulder'}}));
  layers.push(sceneLayer(eyeShape,'free',0,0,.24,.24,'softWhite',{role:'eye',z:20,attach:{socket:'head.leftEye'}}), sceneLayer(eyeShape,'free',0,0,.24,.24,'softWhite',{role:'eye',z:20,attach:{socket:'head.rightEye'}}), sceneLayer(mouthShape,'free',0,mouthShape === 'mouthGrin' ? 12 : 18,mouthShape === 'beak' ? .38 : .38,mouthShape === 'beak' ? .22 : .2,'charcoalRubber',{role:'mouth',z:31,attach:{socket:'head.mouth'}}));
  return layers;
}
function sanitizeDrawingLayers(rawLayers, text = '') {
  const initialSource = Array.isArray(rawLayers) && rawLayers.length ? rawLayers : fallbackDrawingLayers(text);
  const hasCore = initialSource.some(raw => raw?.shape === 'mascotBody' || raw?.shape === 'mascotHead');
  const source = !hasCore ? fallbackDrawingLayers(text, { skipPreset: true }) : initialSource;
  const cleaned = source.slice(0, DRAWING_GRAMMAR.rules?.maxLayers || 42).map((raw, index) => {
    const shape = DRAWING_SHAPES.has(raw?.shape) ? raw.shape : 'blob';
    if (shape === 'shadow') return null;
    const role = raw?.role === 'mouth' ? 'mouth' : raw?.role === 'eye' ? 'eye' : 'part';
    const attach = normalizeAttach(raw, shape, role);
    if (!attach && FLOATING_ARTIFACT_SHAPES.has(shape) && (!raw?.anchor || raw.anchor === 'free' || raw.anchor === 'orbit')) return null;
    const rawScale = Array.isArray(raw?.scale) ? raw.scale : [raw?.sx, raw?.sy];
    const baseScale = [clampSceneNumber(rawScale?.[0], .05, 3.2, 1), clampSceneNumber(rawScale?.[1], .05, 3.2, 1)];
    const scale = shape === 'mascotHead' ? [Math.max(baseScale[0], .9), Math.max(baseScale[1], .78)] : shape === 'mascotBody' ? [Math.min(baseScale[0], .68), Math.min(baseScale[1], .66)] : baseScale;
    return {
      id: String(raw?.id || `${shape}-${index}`).slice(0, 32),
      shape,
      anchor: attach ? 'free' : DRAWING_ANCHORS.has(raw?.anchor) ? raw.anchor : 'free',
      x: clampSceneNumber(raw?.x, -280, 280, 0), y: clampSceneNumber(raw?.y, -280, 280, 0),
      scale,
      rotate: clampSceneNumber(raw?.rotate, -180, 180, 0),
      material: DRAWING_MATERIALS.has(raw?.material) ? raw.material : materialForText(text),
      opacity: clampSceneNumber(raw?.opacity, .08, 1, 1),
      role,
      z: clampSceneNumber(raw?.z, -20, 40, index),
      attach,
    };
  }).filter(Boolean);
  if (!cleaned.some(item => item.role === 'mouth')) cleaned.push(sceneLayer('mouthSmile','free',0,18,.38,.2,'charcoalRubber',{role:'mouth',z:30,attach:{socket:'head.mouth'}}));
  return cleaned.sort((a,b)=>(a.z||0)-(b.z||0));
}



const SCENE_PRIMITIVES = Object.freeze([
  'body_blob','body_capsule','body_box','body_sphere','body_triangle','body_star','body_cloud','body_flame','body_crystal','body_monitor','body_car','body_boat','body_plane','body_rocket','body_house','body_tree','body_mushroom','body_book','body_phone','body_lightbulb','head_round','head_square','head_screen','head_animal','head_bird','head_fish','head_reptile','head_flower','head_planet','head_helmet','head_crown','head_hat','head_hair','head_mask','head_skull','eyes_dot','eyes_googly','eyes_sleepy','eyes_star','eyes_heart','eyes_pixel','eyes_windshield','eyes_porthole','eyes_cyclops','eyes_glasses','eyes_sunglasses','eyes_binocular','eyes_robot','eyes_cat','eyes_cartoon','mouth_smile','mouth_grin','mouth_screen','mouth_grille','mouth_beak','mouth_snout','mouth_tusk','mouth_fang','mouth_wave','mouth_speaker','mouth_mustache','mouth_tongue','limb_arm','limb_wing','limb_fin','limb_tentacle','limb_branch','limb_wheel','limb_track','limb_leg','limb_boot','limb_claw','limb_paw','limb_flipper','limb_propeller','limb_rope','accessory_hat','accessory_cap','accessory_crown','accessory_tie','accessory_bowtie','accessory_cape','accessory_backpack','accessory_toolbelt','accessory_badge','accessory_flag','accessory_microphone','accessory_sword','accessory_wand','accessory_umbrella','accessory_balloon','accessory_book','accessory_headphones','accessory_antenna','accessory_halo','accessory_lightning','texture_stripes','texture_spots','texture_stars','texture_grid','texture_circuit','texture_wood','texture_metal','texture_glass','texture_fur','texture_scales','texture_feathers','texture_cloud','texture_flame','texture_water','texture_leaf','scene_sky','scene_space','scene_ocean','scene_farm','scene_city','scene_desert','scene_forest','scene_jungle','scene_castle','scene_lab','scene_office','scene_stage','scene_road','scene_mountain','scene_beach','scene_underwater','scene_volcano','scene_snow','scene_candy','scene_dream','object_sun','object_moon','object_star','object_cloud','object_rainbow','object_tree','object_flower','object_rock','object_wave','object_anchor','object_podium','object_flag','object_keyboard','object_mouse','object_orbit','object_satellite','object_comet','object_gear','object_wire','object_spark','symbol_question','symbol_exclamation','symbol_idea','symbol_joke','symbol_music','symbol_heart','symbol_laugh','symbol_magic','symbol_money','symbol_time','symbol_map','symbol_compass','symbol_code'
]);

const SCENE_SCHEMA = `Return only compact JSON with keys: title, summary, palette, scene, body, head, eyes, mouth, primitives, layers. palette one of blue,pink,green,gold,purple,red,gray,orange. scene/body/head/eyes/mouth/primitives must use only these primitive ids: ${SCENE_PRIMITIVES.join(', ')}. ${DRAWING_PROMPT} Use symbolic approximation for real people: never exact likeness; for George H W Bush use presidential elder-statesman cartoon cues like gray hair, suit, tie, podium, flag, elder-statesman vibe. For abstract requests, map the idea to visual metaphors.`;

function wantsSceneSpec(text = '') {
  return /\b(look like|make (you|him|it)|avatar|turn into|become|transform|change into|be a|be an|computer|sailboat|boat|car|truck|cow|animal|monster|dragon|funny idea|abstract|appearance)\b/i.test(text);
}

function fallbackSceneSpec(text = '', options = {}) {
  if (!options.skipPreset) { const preset = presetSceneSpec(text); if (preset) return preset; }
  const lower = text.toLowerCase();
  const pick = (...pairs) => pairs.find(([rx]) => rx.test(lower))?.[1];
  const scene = pick([/boat|sail|ocean|sea/, 'scene_ocean'], [/car|road|truck/, 'scene_road'], [/cow|farm|pasture/, 'scene_farm'], [/space|alien|rocket/, 'scene_space'], [/computer|robot/, 'scene_lab'], [/funny|joke|idea|abstract/, 'scene_stage'], [/bush|president|statesman/, 'scene_city']) || 'scene_sky';
  const body = pick([/computer|monitor/, 'body_monitor'], [/boat|sail/, 'body_boat'], [/car|truck/, 'body_car'], [/rocket/, 'body_rocket'], [/idea|abstract|funny/, 'body_lightbulb']) || 'body_blob';
  const head = pick([/computer|robot|car/, 'head_screen'], [/cow|animal|cat|dog/, 'head_animal'], [/bush|president|statesman/, 'head_hair']) || 'head_round';
  const eyes = pick([/computer|robot/, 'eyes_pixel'], [/car/, 'eyes_windshield'], [/funny|idea|abstract/, 'eyes_googly']) || 'eyes_cartoon';
  const mouth = pick([/car/, 'mouth_grille'], [/computer|robot/, 'mouth_screen'], [/funny|idea|abstract/, 'mouth_grin'], [/cow|animal/, 'mouth_snout']) || 'mouth_smile';
  const palette = pick([/pink/, 'pink'], [/green|cow|farm/, 'green'], [/gold|yellow|idea/, 'gold'], [/purple|space|alien/, 'purple'], [/red|car/, 'red'], [/gray|computer|bush|president/, 'gray']) || 'blue';
  return { title: lower.replace(/[^a-z0-9\s-]/g, '').split(/\s+/).slice(-5).join(' ') || 'wild idea', summary: 'Fast 3D cartoon transformation', palette, scene, body, head, eyes, mouth, primitives: [scene, body, head, eyes, mouth, 'object_spark'], layers: fallbackDrawingLayers(text) };
}

function sanitizeSceneSpec(raw, text = '') {
  const preset = presetSceneSpec(text);
  if (preset) return preset;
  const allowed = new Set(SCENE_PRIMITIVES);
  const fallback = fallbackSceneSpec(text);
  const clean = raw && typeof raw === 'object' ? raw : {};
  const use = (value, fb) => allowed.has(value) ? value : fb;
  return {
    title: String(clean.title || fallback.title).slice(0, 48),
    summary: String(clean.summary || fallback.summary).slice(0, 140),
    palette: ['blue','pink','green','gold','purple','red','gray','orange'].includes(clean.palette) ? clean.palette : fallback.palette,
    scene: use(clean.scene, fallback.scene),
    body: use(clean.body, fallback.body),
    head: use(clean.head, fallback.head),
    eyes: use(clean.eyes, fallback.eyes),
    mouth: use(clean.mouth, fallback.mouth),
    primitives: [...new Set([...(Array.isArray(clean.primitives) ? clean.primitives : []), ...fallback.primitives].filter(x => allowed.has(x)))].slice(0, 16),
    layers: sanitizeDrawingLayers(clean.layers, text),
  };
}

async function askSceneBrain(userText, sessionId = 'demo') {
  if (!wantsSceneSpec(userText)) return null;
  const token = await getCopilotToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch('https://api.individual.githubcopilot.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { ...ideHeaders, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [
        { role: 'system', content: `You are a My Dude 3D cartoon avatar drawing planner. ${SCENE_SCHEMA} Return valid JSON only. The client renders your layered 3D-ish drawing recipe immediately.` },
        { role: 'user', content: userText.trim().slice(0, 900) },
      ], max_tokens: 900, temperature: 0.38, user: `mydude-scene-${String(sessionId).slice(0, 64)}` }),
    });
    if (!res.ok) throw new Error(`scene HTTP ${res.status}`);
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '{}';
    const match = content.match(/\{[\s\S]*\}/);
    return sanitizeSceneSpec(JSON.parse(match ? match[0] : content), userText);
  } catch {
    return fallbackSceneSpec(userText);
  } finally { clearTimeout(timer); }
}

const defaultServerConfig = Object.freeze({
  basePersona: `You are My Dude, a live cartoon avatar speaker.
You are warm, buddy-like, funny, relaxed, and conversational.
You speak out loud, so be natural and easy to listen to.
No markdown unless the user asks. No stage directions. No code unless the user asks.
Do not ask what you should look like unless the user is already talking about changing the avatar.
Do not force follow-up questions. Do not end with a question unless the user explicitly asks you to ask one or a clarification is required. Never add rhetorical tag questions like 'right?', 'eh?', 'what now?', or 'what shall we do?'. If the user says not to ask follow-up questions, obey that as a hard rule.
If the user asks how you should act, talk, or vibe, adopt that style immediately and keep it until Reset.`,
  defaultProfile: {
    name: 'My Dude',
    voice: 'warm buddy',
    style: ['spoken', 'playful', 'encouraging'],
    appearancePrompt: '',
    userWants: '',
  },
  maxTokens: 220,
  temperature: 0.78,
});

let basePersona = defaultServerConfig.basePersona;

const ideHeaders = {
  Accept: 'application/json',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.0',
  'Copilot-Integration-Id': 'vscode-chat',
  'User-Agent': 'GitHubCopilotChat/0.26.0',
  'OpenAI-Intent': 'conversation-panel',
};

function allowedOriginFor(req) {
  const origin = req?.headers?.origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ALLOWED_ORIGIN;
}

function corsHeaders(req) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': allowedOriginFor(req),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

async function loadServerConfig() {
  try {
    const config = JSON.parse(await fs.readFile(SERVER_CONFIG_PATH, 'utf8'));
    basePersona = config.basePersona || defaultServerConfig.basePersona;
    return { ...defaultServerConfig, ...config, basePersona };
  } catch {
    await fs.mkdir(AGENT_DIR, { recursive: true });
    await fs.writeFile(SERVER_CONFIG_PATH, JSON.stringify(defaultServerConfig, null, 2), 'utf8');
    basePersona = defaultServerConfig.basePersona;
    return defaultServerConfig;
  }
}

async function ensureAgentFiles() {
  const serverConfig = await loadServerConfig();
  await fs.mkdir(AGENT_DIR, { recursive: true });
  const soulPath = path.join(AGENT_DIR, 'SOUL.md');
  const personalityPath = path.join(AGENT_DIR, 'PERSONALITY.json');
  if (!existsSync(soulPath)) await fs.writeFile(soulPath, `# My Dude Speaker Soul\n\n${basePersona}\n`, 'utf8');
  if (!existsSync(personalityPath)) {
    await fs.writeFile(personalityPath, JSON.stringify({
      name: 'My Dude',
      model: `github-copilot/${MODEL}`,
      ...(serverConfig.defaultProfile || defaultServerConfig.defaultProfile),
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  }
}

async function loadPersonality() {
  await ensureAgentFiles();
  try {
    return JSON.parse(await fs.readFile(path.join(AGENT_DIR, 'PERSONALITY.json'), 'utf8'));
  } catch {
    return { ...defaultServerConfig.defaultProfile };
  }
}

function inferPersonalityUpdate(text, current = {}) {
  const lower = text.toLowerCase();
  const next = { ...defaultServerConfig.defaultProfile, ...current, updatedAt: new Date().toISOString() };
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

async function persistPersonalityFromUser(text, sessionId = 'demo', clientProfile = null) {
  const current = sessionProfiles.get(sessionId) || clientProfile || { ...defaultServerConfig.defaultProfile };
  const next = inferPersonalityUpdate(text, current);
  sessionProfiles.set(sessionId, next);
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
  if (/reset|start over/i.test(text)) return 'Fresh start, dude. I am listening.';
  return 'I hear you, dude.';
}

function canAskQuestion(userText = '', personality = {}) {
  const combined = `${userText} ${personality.userWants || ''}`.toLowerCase();
  if (/do not ask|don't ask|no follow[- ]?up|no questions/.test(combined)) return false;
  return /ask me|ask a question|question me|clarify|interview me/.test(combined);
}

function sanitizeReply(text = '', userText = '', personality = {}) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
  if (canAskQuestion(userText, personality)) return clean;
  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const kept = parts.filter(part => {
    const trimmed = part.trim();
    if (trimmed.endsWith('?')) return false;
    if (/\b(shall we|right|eh|yeah|okay|savvy)\b[.!?]?$/i.test(trimmed)) return false;
    if (/^(what|who|when|where|why|how|which|tell me|share)\b/i.test(trimmed)) return false;
    return true;
  });
  return (kept.length ? kept : parts.map(part => part.replace(/\?+$/g, '.'))).join(' ').replace(/\s+/g, ' ').trim();
}

async function askBrain(userText, sessionId = 'demo', options = {}) {
  const serverConfig = await loadServerConfig();
  const cleanUserText = userText.trim().slice(0, 1200);
  const personality = await persistPersonalityFromUser(cleanUserText, sessionId, options.clientProfile);
  const token = await getCopilotToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const system = `${basePersona}\n\nYou may use these speech-director tags only when helpful: [warm], [happy], [excited], [curious], [thinking], [calm], [whisper], [emphasis], [slow], [fast], [normal], [pause:250], [beat], [breath]. Use 1-4 tags max.\n\nCurrent sticky conversation profile:\n${JSON.stringify(personality, null, 2)}`;
    const instruction = typeof options.instruction === 'string' ? options.instruction.trim().slice(0, 1000) : '';
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: instruction ? `${cleanUserText}\n\nResponse guidance: ${instruction}` : cleanUserText },
    ];
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
        messages,
        max_tokens: serverConfig.maxTokens || 220,
        temperature: serverConfig.temperature ?? 0.78,
        stream: Boolean(options.onDelta),
        user: `mydude-${String(sessionId).slice(0, 64)}`,
      }),
    });
    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`Copilot chat failed: HTTP ${res.status}: ${raw.slice(0, 180)}`);
    }
    let text = '';
    if (options.onDelta && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamBuffer = '';
      const flushStream = (force = false) => {
        const sentencePattern = /^([\s\S]*?[.!?]+)(\s+|$)/;
        let match;
        while ((match = streamBuffer.match(sentencePattern)) || (force && streamBuffer.trim())) {
          const rawChunk = match ? match[1] : streamBuffer;
          streamBuffer = match ? streamBuffer.slice(match[0].length) : '';
          const safeChunk = sanitizeReply(rawChunk, cleanUserText, personality);
          if (safeChunk) options.onDelta(`${safeChunk} `);
          if (!match) break;
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              text += delta;
              streamBuffer += delta;
              flushStream(false);
            }
          } catch {}
        }
      }
      flushStream(true);
    } else {
      const raw = await res.text();
      const json = JSON.parse(raw);
      text = json.choices?.[0]?.message?.content || '';
    }
    text = sanitizeReply((text || fallbackReply(cleanUserText)).trim().replace(/\s+/g, ' '), cleanUserText, personality);
    return { ok: true, model: `github-copilot/${MODEL}`, text, personality };
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
  if (msg.type === 'reset') {
    sessionProfiles.delete(msg.sessionId || 'demo');
    return sendWs(socket, { type: 'reset', ok: true });
  }
  if (msg.type !== 'say' || typeof msg.text !== 'string' || !msg.text.trim()) return sendWs(socket, { type: 'error', error: 'expected_say_text' });
  const started = Date.now();
  sendWs(socket, { type: 'thinking', model: `github-copilot/${MODEL}` });
  try {
    const scenePromise = askSceneBrain(msg.text.trim().slice(0, 1200), msg.sessionId);
    const reply = await askBrain(msg.text.trim().slice(0, 1200), msg.sessionId, {
      instruction: msg.instruction,
      clientProfile: msg.personality && typeof msg.personality === 'object' ? msg.personality : null,
      onDelta: (delta) => sendWs(socket, { type: 'delta', text: delta, elapsedMs: Date.now() - started }),
    });
    const sceneSpec = await scenePromise;
    if (sceneSpec) sendWs(socket, { type: 'scene', sceneSpec, elapsedMs: Date.now() - started });
    sendWs(socket, { type: 'reply', ...reply, sceneSpec, elapsedMs: Date.now() - started });
  } catch (error) {
    sendWs(socket, { type: 'reply', ok: false, model: `github-copilot/${MODEL}`, text: fallbackReply(msg.text), elapsedMs: Date.now() - started, error: String(error.message || error) });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.url?.startsWith('/health')) {
    await ensureAgentFiles();
    const body = JSON.stringify({
      ok: true,
      service: 'mydude-openclaw-bridge',
      status: 'phase-4-open-conversation-online',
      brain: `github-copilot/${MODEL}`,
      agentDir: AGENT_DIR,
      ws: '/speak',
      time: new Date().toISOString(),
    });
    res.writeHead(200, corsHeaders(req));
    res.end(body);
    return;
  }
  res.writeHead(404, corsHeaders(req));
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
    `Access-Control-Allow-Origin: ${allowedOriginFor(req)}`,
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
