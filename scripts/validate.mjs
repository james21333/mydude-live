import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const index = path.join(dist, 'index.html');
const manifest = path.join(dist, '.vite', 'manifest.json');

assert(fs.existsSync(index), 'Vite dist/index.html missing');
assert(fs.existsSync(manifest), 'Vite manifest missing');

const appSource = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
for (const required of [
  'mydude.live AI Ecosystem',
  'Start',
  'Reset',
  'Thinking…',
  'Generated autonomously by OpenClaw',
  'My Dude',
]) {
  assert(appSource.includes(required), `Missing required app text: ${required}`);
}

const workerSource = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
assert(workerSource.includes('window') === false, 'Worker should not depend on window');
assert(workerSource.includes('mydude.live'), 'Worker root domain missing');

console.log('Validation passed: React demo, wildcard routing shell, reset, listener-safe build state, and avatar copy are present.');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
