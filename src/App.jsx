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
  const [brainStatus, setBrainStatus] = useState('speaker agent: standby');
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const speakingTimer = useRef(null);
  const mouthCloseTimer = useRef(null);
  const activatedRef = useRef(false);
  const statusRef = useRef('idle');
  const sessionIdRef = useRef(window.crypto?.randomUUID?.() || `mydude-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const avatarSeed = avatar?.prompt || 'voice-orb';
  const colors = useMemo(() => colorsFromName(avatarSeed), [avatarSeed]);

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
    setMessage("Hey dude! I'm your dude! What do you want me to look like?");
    setTranscript('Greeting… then I will listen.');
    setDebug('start clicked — greeting first, listener next');
    appendLog('Live mode activated. Greeting from the click before listener starts.');
    speak("Hey dude! I'm your dude! What do you want me to look like?", {
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
    window.speechSynthesis?.cancel?.();
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
      setMessage('Listening now. Say one avatar request out loud.');
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
      setDebug(`listener error: ${error}`);
      appendLog(`Speech listener error: ${error}`);
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        setMessage('Chrome is blocking microphone/speech. Click the lock icon in the address bar and allow Microphone, then press Listen.');
      }
      setStatus('idle');
    };
    recognition.onend = () => {
      setDebug('listener ended');
      if (activatedRef.current && !['building', 'speaking'].includes(statusRef.current)) {
        window.setTimeout(() => {
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
    try { recognitionRef.current?.abort?.(); } catch {}
    talkToSpeakerAgent(text);
  }

  function askSpeakerAgent(text) {
    return new Promise((resolve) => {
      let settled = false;
      const started = performance.now();
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setBrainStatus('speaker agent: timeout, using local fallback');
        resolve({ ok: false, text: fallbackBrainReply(text), elapsedMs: Math.round(performance.now() - started) });
      }, 9000);
      try {
        const socket = new WebSocket(BRIDGE_WS_URL);
        socket.onopen = () => setBrainStatus('speaker agent: connected');
        socket.onmessage = (event) => {
          let payload;
          try { payload = JSON.parse(event.data); } catch { return; }
          if (payload.type === 'ready') {
            setBrainStatus(`speaker agent: ready (${payload.model || 'haiku'})`);
            socket.send(JSON.stringify({ type: 'say', sessionId: sessionIdRef.current, text }));
          }
          if (payload.type === 'thinking') setBrainStatus(`speaker agent: thinking (${payload.model || 'haiku'})`);
          if (payload.type === 'reply' && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            setBrainStatus(`speaker agent: replied in ${payload.elapsedMs || Math.round(performance.now() - started)}ms`);
            try { socket.close(); } catch {}
            resolve(payload);
          }
        };
        socket.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          setBrainStatus('speaker agent: connection error, using local fallback');
          resolve({ ok: false, text: fallbackBrainReply(text), elapsedMs: Math.round(performance.now() - started) });
        };
      } catch {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          setBrainStatus('speaker agent: unavailable, using local fallback');
          resolve({ ok: false, text: fallbackBrainReply(text), elapsedMs: Math.round(performance.now() - started) });
        }
      }
    });
  }

  async function talkToSpeakerAgent(text) {
    statusRef.current = 'building';
    setStatus('building');
    setBuildProgress(18);
    setMessage('My Dude is thinking with the speaker agent…');
    setBrainStatus('speaker agent: sending voice request');
    const progressTimer = window.setInterval(() => {
      setBuildProgress(progress => Math.min(92, progress + 9));
    }, 240);
    const reply = await askSpeakerAgent(text);
    window.clearInterval(progressTimer);
    const built = makeAvatar(text);
    setAvatar(built);
    setBuildProgress(100);
    statusRef.current = 'speaking';
    setStatus('speaking');
    const spoken = reply.text || fallbackBrainReply(text);
    setMessage(spoken);
    appendLog(`Speaker agent: ${spoken}`);
    speak(spoken, { after: () => { statusRef.current = 'listening'; setStatus('listening'); startListening(); } });
  }

  function buildAvatar(prompt) {
    statusRef.current = 'building';
    setStatus('building');
    setMessage('I can build that in under one minute. Starting now.');
    setBuildProgress(4);
    speak('I can build that in under one minute. Working, working, keep a dude a-working. Building up a buddy while the pixels keep twerking.', { rate: 1.04 });
    const steps = [18, 34, 52, 71, 88, 100];
    steps.forEach((progress, index) => {
      setTimeout(() => setBuildProgress(progress), 320 + index * 420);
    });
    setTimeout(() => {
      const built = makeAvatar(prompt);
      setAvatar(built);
      statusRef.current = 'speaking';
      statusRef.current = 'speaking';
    setStatus('speaking');
      setMessage(`Built in ${built.buildTime}s: ${built.summary}`);
      appendLog(`Avatar built: ${built.summary}`);
      speak(`Done. I built ${built.summary}. You can reset me anytime and build a new look.`, { after: () => { statusRef.current = 'listening'; setStatus('listening'); startListening(); } });
    }, 3100);
  }

  function fallbackBrainReply(text) {
    if (/blue|robot|glass/i.test(text)) return 'Oh dude, a blue robot with glasses is absolutely the vibe.';
    if (/reset|start over/i.test(text)) return 'Fresh start, dude—tell me what you want me to become next.';
    return 'I hear you, dude—let me shape myself around that.';
  }

  function speak(text, options = {}) {
    if (!window.speechSynthesis) {
      options.after?.();
      return;
    }
    window.speechSynthesis.cancel();
    clearInterval(speakingTimer.current);
    clearTimeout(mouthCloseTimer.current);
    setStatus('speaking');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.08;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    const pulseMouth = () => {
      setMouthOpen(true);
      clearTimeout(mouthCloseTimer.current);
      mouthCloseTimer.current = setTimeout(() => setMouthOpen(false), 70 + Math.random() * 90);
    };
    utterance.onstart = () => {
      pulseMouth();
      clearInterval(speakingTimer.current);
      speakingTimer.current = setInterval(pulseMouth, 95 + Math.random() * 85);
    };
    utterance.onboundary = (event) => {
      if (event.name === 'word' || event.charIndex >= 0) pulseMouth();
    };
    utterance.onend = () => {
      clearInterval(speakingTimer.current);
      clearTimeout(mouthCloseTimer.current);
      setMouthOpen(false);
      options.after?.();
    };
    window.speechSynthesis.speak(utterance);
  }

  function resetDemo() {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel?.();
    clearInterval(speakingTimer.current);
    setAvatar(null);
    setTranscript('');
    setBuildProgress(0);
    statusRef.current = 'listening';
    setStatus('listening');
    setMessage('Reset complete. What do you want me to look like this time?');
    setDebug('reset — starting listener');
    appendLog('Demo reset. Avatar config cleared.');
    speak('Reset complete. What do you want me to look like this time?', { after: startListening });
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
      <CartoonAvatar avatar={avatar} mouthOpen={mouthOpen} status={status} />
      <div className="voice-panel controls-below compact-controls">
        <div className="control-copy">
          <p>{message}</p>
          <div className="transcript live-transcript"><strong>I heard:</strong> <span>{transcript || 'waiting for voice...'}</span></div>
          <div className="listener-debug"><strong>Mic:</strong> {debug}<br/><strong>Brain:</strong> {brainStatus}</div>
        </div>
        {status === 'building' && <div className="progress"><span style={{ width: `${buildProgress}%` }} /></div>}
        <div className="actions">
          {!activated ? <button className="primary" onClick={activate}><Mic size={16}/> Start</button> : <button className="primary" onClick={startListening}><Mic size={16}/> Listen</button>}
          <button className="secondary" onClick={resetDemo}><RotateCcw size={16}/> Reset</button>
        </div>
      </div>
    </section>

    <section className="log-panel">{log.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}</section>
  </main>;
}

function CartoonAvatar({ avatar, mouthOpen, status }) {
  const isBuilt = Boolean(avatar);
  const style = avatar ? { '--bot': avatar.color, '--eye': avatar.eyeColor } : {};
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
