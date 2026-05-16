import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ROOT_DOMAIN = 'mydude.live';
const ACTIVE_PROJECTS = [
  { name: 'demo', url: 'https://demo.mydude.live', description: 'Live voice-box and avatar-builder demo.' },
  { name: 'clawtest', url: 'https://clawtest.mydude.live', description: 'Wildcard routing smoke test for autonomous OpenClaw projects.' },
  { name: 'testproject', url: 'https://testproject.mydude.live', description: 'Example generated project namespace.' },
];

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

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
  const [message, setMessage] = useState('Tap Start Cody Live. I will listen, talk, and build my cartoon avatar in under one minute.');
  const [avatar, setAvatar] = useState(null);
  const [volume, setVolume] = useState(0.18);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [log, setLog] = useState(['Ready for one-click live mode.']);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const speakingTimer = useRef(null);
  const activatedRef = useRef(false);
  const statusRef = useRef('idle');

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
    audioRef.current?.getTracks?.().forEach(track => track.stop());
  }, []);

  async function activate() {
    activatedRef.current = true;
    statusRef.current = 'listening';
    setActivated(true);
    setStatus('listening');
    appendLog('Live mode activated. Browser permissions may ask for microphone access.');
    speak('Cody Live is on. Tell me what you want my avatar to look like.', { after: startListening });
    await startAudioMeter();
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
    activatedRef.current = true;
    if (!SpeechRecognition) {
      setMessage('This browser does not expose SpeechRecognition. You can still type a description below.');
      setStatus('idle');
      return;
    }
    recognitionRef.current?.stop?.();
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => {
      statusRef.current = 'listening';
      setStatus('listening');
      appendLog('Listening is active.');
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      setTranscript((finalText || interim).trim());
      if (finalText.trim()) handleUserUtterance(finalText.trim());
    };
    recognition.onerror = (event) => {
      appendLog(`Speech listener error: ${event.error || 'unknown'}`);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        statusRef.current = 'idle';
        setStatus('idle');
      }
    };
    recognition.onend = () => {
      const shouldRestart = activatedRef.current && !['building', 'speaking'].includes(statusRef.current);
      if (shouldRestart) {
        window.setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 180);
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch (error) { appendLog(`Could not start listener: ${error.message || 'unknown'}`); }
  }

  function handleUserUtterance(text) {
    appendLog(`Heard: ${text}`);
    recognitionRef.current?.stop?.();
    buildAvatar(text);
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
      setStatus('speaking');
      setMessage(`Built in ${built.buildTime}s: ${built.summary}`);
      appendLog(`Avatar built: ${built.summary}`);
      speak(`Done. I built ${built.summary}. You can reset me anytime and build a new look.`, { after: () => { setStatus('listening'); startListening(); } });
    }, 3100);
  }

  function speak(text, options = {}) {
    if (!window.speechSynthesis) {
      options.after?.();
      return;
    }
    window.speechSynthesis.cancel();
    statusRef.current = 'speaking';
    setStatus('speaking');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.08;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    utterance.onstart = () => {
      setMouthOpen(true);
      clearInterval(speakingTimer.current);
      speakingTimer.current = setInterval(() => setMouthOpen(open => !open), 115);
    };
    utterance.onend = () => {
      clearInterval(speakingTimer.current);
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
    appendLog('Demo reset. Avatar config cleared.');
    speak('Reset complete. What do you want me to look like this time?', { after: startListening });
  }

  function appendLog(item) {
    setLog(items => [item, ...items].slice(0, 5));
  }

  return <main className="demo-page" style={{ '--start': colors.start, '--mid': colors.mid, '--end': colors.end, '--accent': colors.accent }}>
    <section className="demo-hero compact">
      <p className="eyebrow"><Sparkles size={16}/> demo.mydude.live</p>
      <div className={`status-pill ${status}`}>{status}</div>
    </section>

    <section className="stage">
      <CartoonAvatar avatar={avatar} volume={volume} mouthOpen={mouthOpen || status === 'speaking'} status={status} />
      <div className="voice-panel controls-below">
        <p>{message}</p>
        {status === 'building' && <div className="progress"><span style={{ width: `${buildProgress}%` }} /></div>}
        <div className="transcript"><strong>Latest heard:</strong> {transcript || 'waiting for voice...'}</div>
        <div className="actions">
          {!activated ? <button className="primary" onClick={activate}><Mic size={18}/> Start Cody Live</button> : <button className="primary" onClick={startListening}><Mic size={18}/> Listen again</button>}
          <button className="secondary" onClick={resetDemo}><RotateCcw size={18}/> Reset avatar</button>
          <button className="secondary" onClick={() => speak('Working, working, keep a dude a-working. Cody is cooking and the pixels are perking.')}><Volume2 size={18}/> Test voice</button>
        </div>
      </div>
    </section>

    <section className="manual-builder">
      <p>Fallback: type an avatar request if mic permission is unavailable.</p>
      <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('prompt'); if (value) buildAvatar(String(value)); }}>
        <input name="prompt" placeholder="Example: a blue robot with square glasses and friendly eyes" />
        <button>Build under 1 minute</button>
      </form>
    </section>

    <section className="log-panel">{log.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}</section>
  </main>;
}

function CartoonAvatar({ avatar, volume, mouthOpen, status }) {
  const isBuilt = Boolean(avatar);
  const style = avatar ? { '--bot': avatar.color, '--eye': avatar.eyeColor } : {};
  return <div className={`avatar-card ${status}`} style={style}>
    <div className="antenna" />
    <div className="head">
      <div className="shine" />
      <div className={`eyes ${avatar?.eyes || 'friendly'}`}><span/><span/></div>
      {avatar?.accessory === 'glasses' && <div className="glasses"><i/><i/></div>}
      <div className={`mouth ${mouthOpen ? 'open' : ''}`} />
      {!isBuilt && <div className="voice-placeholder" style={{ opacity: 0.5 + volume * 0.5 }} />}
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
  </div>;
}

function makeAvatar(prompt) {
  const lower = prompt.toLowerCase();
  const color = lower.includes('blue') ? '#38bdf8' : lower.includes('green') ? '#34d399' : lower.includes('red') ? '#fb7185' : lower.includes('purple') ? '#a78bfa' : lower.includes('gold') || lower.includes('yellow') ? '#facc15' : '#60a5fa';
  const accessory = lower.includes('glass') ? 'glasses' : lower.includes('hat') ? 'hat' : 'none';
  const eyes = lower.includes('sleep') ? 'sleepy' : lower.includes('angry') ? 'focused' : 'friendly';
  const name = lower.includes('robot') ? 'Pocket Robot' : lower.includes('cat') ? 'Cartoon Cat' : lower.includes('alien') ? 'Tiny Alien' : 'Cartoon Dude';
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
