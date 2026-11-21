import * as THREE from 'three';
import { makeWorld } from './world.js';
import { Ship } from './ship.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';
import { Voyages } from './voyages.js';
import { Player } from './player.js';
import { Crew } from './crew.js';
import { Grapples } from './grapple.js';
import { Damage } from './damage.js';
import { Hud } from './hud.js';
import { rand } from './util.js';
import { Events } from './events.js';
import { Ids } from './ids.js';
import { applyAction, stepPlayers, hurtPlayer } from './actions.js';
import { wirePresentation } from './presentation.js';
import { wireVoices } from './voicelines.js';
import { snapshot } from './state.js';
import { Weather, CONDITIONS } from './weather.js';
import { Net } from './net/net.js';
import { Island } from './island.js';
import { VERSION as VERSION_NOW } from './version.js';
import { PEOPLE } from './people.js';
import { loadModels } from './rigged.js';
import { Kraken } from './kraken.js';
import { RopeSwing } from './swing.js';

const params = new URLSearchParams(location.search);
// Crew setting picked on the title screen (remembered): 'kids' (default) or 'adult'. ?crew=adult works too.
const CREW_KEY = 'broadside.crew';
let crewPick = params.get('crew');
if (!crewPick) { try { crewPick = localStorage.getItem(CREW_KEY); } catch (e) { /* private mode */ } }
PEOPLE.adult = crewPick === 'adult';
const G = window.G = { t: 0, score: 0, mode: null, debug: params.has('debug'), state: 'play', stateT: 0 };
// Multiplayer (net/net.js): this headset runs the game rules unless it joins a friend's game,
// then G.isHost turns false and the host's snapshots drive everything. See docs/MULTIPLAYER.md.
G.isHost = true;
G.events = new Events();
G.ids = new Ids();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
G.renderer = renderer;

const scene = G.scene = new THREE.Scene();
const camera = G.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 4000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

G.world = makeWorld(scene);
G.ship = new Ship(scene, { id: G.ids.next('ship'), isPlayer: true, comfort: 0.45, health: 150, maxSpeed: 9.5, sail: 0.35, reloadTime: 5 });
G.ship.leverAngle = 0.6 - 1.2 * 0.35;
G.fx = new Effects(scene);
G.audio = new Sound();
G.combat = new Combat(G);
G.enemies = new Enemies(G);
G.voyages = new Voyages(G);       // waves of enemies, boss fights, victory (see voyages.js)
G.player = new Player(G);          // you, on this headset
G.players = [G.player];             // everyone on board; friends are added by net.js
G.items = G.player.items;           // muskets and cutlass on the rack (shared by the crew of players)
await loadModels();                // the high-detail pirates (rigged.js)
G.crew = new Crew(G);
G.grapples = new Grapples(G);
G.swing = new RopeSwing(G);        // swing across to a lashed ship on a rope (swing.js)
G.damage = new Damage(G);         // leaks, fires and snapped masts you fix by hand
G.hud = new Hud(G);
G.island = new Island(G);        // treasure hunts between voyages
G.kraken = new Kraken(G);        // the sea monster at the end of each voyage
G.player.setupVR(renderer);
G.net = new Net(G);

// Time of day and weather. Picked on the title screen (remembered), or ?weather=night|storm|stormNight|day|random.
// Voyages can change it any time with G.weather.set(name).
G.weather = new Weather(G);
const WX_KEY = 'broadside.weather';
let wxPick = params.get('weather');
if (!wxPick) { try { wxPick = localStorage.getItem(WX_KEY); } catch (e) { /* private mode */ } }
if (!CONDITIONS[wxPick] && wxPick !== 'random') wxPick = 'day';
const randomWeather = () => { const k = Object.keys(CONDITIONS).filter((n) => n !== G.weather.name); return k[Math.floor(Math.random() * k.length)]; };
const applyWeatherPick = () => G.weather.set(wxPick === 'random' ? randomWeather() : wxPick, { instant: true });
applyWeatherPick();
// "Surprise me": each new voyage sails into different weather, and a storm rolls in when the boss appears
G.events.on('voyageWon', () => { if (G.isHost && wxPick === 'random') G.weather.set(randomWeather()); });
G.events.on('bossArrived', () => { if (G.isHost && wxPick === 'random' && G.weather.target.storm < 1) G.weather.set(G.weather.target.night ? 'stormNight' : 'storm'); });
for (const b of document.querySelectorAll('#weather button')) {
  b.classList.toggle('on', b.dataset.wx === wxPick);
  b.addEventListener('click', () => {
    if (!G.isHost) return; // the host picks the weather
    wxPick = b.dataset.wx;
    try { localStorage.setItem(WX_KEY, wxPick); } catch (e) { /* private mode */ }
    for (const o of document.querySelectorAll('#weather button')) o.classList.toggle('on', o === b);
    applyWeatherPick();
  });
}

// Kids / Adult crew. Changing it redraws our crew; ships and pirates met later follow it too.
G.adult = PEOPLE.adult;
G.setAdult = (on) => {
  on = !!on; if (on === G.adult) return;
  G.adult = PEOPLE.adult = on;
  G.crew.refreshLooks();
  for (const b of document.querySelectorAll('#rating button')) b.classList.toggle('on', (b.dataset.crew === 'adult') === on);
};
for (const b of document.querySelectorAll('#rating button')) {
  b.classList.toggle('on', (b.dataset.crew === 'adult') === G.adult);
  b.addEventListener('click', () => {
    if (!G.isHost) return; // the host's setting applies to everyone
    try { localStorage.setItem(CREW_KEY, b.dataset.crew); } catch (e) { /* private mode */ }
    G.setAdult(b.dataset.crew === 'adult');
  });
}

// Turning with the right stick: snap (45° steps, the comfiest) or smooth. Remembered.
const TURN_KEY = 'broadside.turn';
try { G.player.smoothTurn = localStorage.getItem(TURN_KEY) === 'smooth'; } catch (e) { /* private mode */ }
for (const b of document.querySelectorAll('#turning button')) {
  b.classList.toggle('on', (b.dataset.turn === 'smooth') === !!G.player.smoothTurn);
  b.addEventListener('click', () => {
    G.player.smoothTurn = b.dataset.turn === 'smooth';
    try { localStorage.setItem(TURN_KEY, b.dataset.turn); } catch (e) { /* private mode */ }
    for (const o of document.querySelectorAll('#turning button')) o.classList.toggle('on', o === b);
  });
}

// ---------- Ids and actions ----------
// Find anything by its id: ships, cannons, items, players.
G.byId = (id) => {
  for (const s of [G.ship, ...G.enemies.ships]) {
    if (s.id === id) return s;
    for (const c of s.cannons) if (c.id === id) return c;
  }
  if (id.startsWith('crew:')) return G.crew.members.find((m) => m.id === id) || null;
  const crew = /^(ship:\d+)\/(crew|keg)/.exec(id);
  if (crew) { const s = [G.ship, ...G.enemies.ships].find((x) => x.id === crew[1]); return s ? (crew[2] === 'keg' ? s.keg : s.crew.find((m) => m.id === id)) || null : null; }
  return G.items.find((x) => x.id === id) || G.playerById(id) || G.enemies.boarders.find((b) => b.id === id) || G.damage.byId(id) || G.island.byId(id) || null;
};
// The deck (or beach) someone stands on, by id: our ship, an enemy ship, or 'shore' (island.js)
G.frameById = (id) => (id === 'shore' ? G.island.shore : id === 'boat' ? G.island.boat.frame : [G.ship, ...G.enemies.ships].find((s) => s.id === id) || null);
G.playerById = (id) => G.players.find((p) => p.id === id) || null;
// Everything a player does goes through here (see actions.js).
G.act = (a) => applyAction(G, { player: G.player.id, ...a });
G.hurtPlayer = (pl, n) => hurtPlayer(G, pl, n);
G.snapshot = () => snapshot(G);

// ---------- Game events ----------
// Effects, sounds and messages for every event are in presentation.js.
wirePresentation(G);
wireVoices(G);
// Rules that react to events:
// Everyone down: the crew drags you all back (single player: you). With friends aboard, one
// player down just waits a few seconds and gets back up (see simulate).
G.events.on('playerDied', ({ player }) => {
  if (!G.isHost) return;
  player.deadT = 0;
  if (G.players.every((pl) => pl.dead)) { G.state = 'dead'; G.stateT = 3; }
});
G.events.on('shipRefitted', () => G.damage.reset()); // fresh planks and masts between voyages

function resetGame() {
  const S = G.ship;
  G.grapples.clearAll();
  G.enemies.clearAll();
  G.damage.reset();
  S.health = S.maxHealth; S.alive = true; S.sinkT = 0; S.speed = 0;
  S.wheelAngle = 0; S.leverAngle = 0.6 - 1.2 * 0.35;
  S.helmBy = G.player.id; S.holdHeading = S.heading;
  for (const pl of G.players) pl.respawn();
  G.score = 0; G.state = 'play';
  G.events.emit('gameReset');
  G.voyages.restart(); // same voyage, from its first wave
}

// ---------- Start screen ----------
const overlay = document.getElementById('overlay');
const vrBtn = document.getElementById('vrBtn'), deskBtn = document.getElementById('deskBtn'), note = document.getElementById('note');
let xrSession = null;

if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    vrBtn.disabled = !ok;
    note.textContent = ok ? 'VR headset ready.' : (window.isSecureContext ? 'No VR headset found. You can still play on desktop.' : 'VR needs an https:// address. Desktop mode works anywhere.');
  }).catch(() => { note.textContent = 'Could not check for VR.'; });
} else {
  note.textContent = window.isSecureContext ? 'This browser has no WebXR. Desktop mode works.' : 'VR needs an https:// address. Desktop mode works anywhere.';
}

function begin(vr) {
  overlay.style.display = 'none';
  if (G.started) return;
  G.started = true;
  G.events.emit('gameStarted');
  if (vr) {
    G.hud.msg('Welcome aboard, Captain!', 3);
    G.hud.msg('Squeeze GRIP (the side button) to grab', 4.5);
    G.hud.msg('Your weapons hang on the rack to your left', 4.5);
    G.hud.msg('Reach a hand near something: it glows if you can use it', 5);
    G.hud.msg('Cannons: hand on the back end, pull TRIGGER', 5);
    G.hud.msg('Walk away from the wheel and Hawkins will steer', 4.5);
    G.hud.msg('His orders are on your left wrist: A or X changes them', 4.5);
    G.hud.msg('Grapple gun on the bow: hook a ship and board her', 4.5);
  } else { G.hud.msg('Take the wheel, Captain!', 4); G.hud.msg('Grip the lever to set the sails', 3.5); }
}

vrBtn.addEventListener('click', async () => {
  G.audio.init();
  try {
    xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await renderer.xr.setSession(xrSession);
    G.player.onSession(xrSession);
    G.mode = 'vr'; camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    G.player.equip(null);
    begin(true);
    xrSession.addEventListener('end', () => { xrSession = null; G.mode = null; overlay.style.display = 'flex'; });
  } catch (e) { note.textContent = 'Could not start VR: ' + e.message; }
});

deskBtn.addEventListener('click', () => {
  G.audio.init();
  G.mode = 'desktop';
  G.player.initDesktop(renderer.domElement);
  document.getElementById('crosshair').style.display = 'block';
  document.getElementById('dhud').style.display = 'block';
  renderer.domElement.requestPointerLock?.();
  begin();
});
// ---------- Play with friends (net/net.js) ----------
const nameIn = document.getElementById('nameIn'), codeIn = document.getElementById('codeIn');
const hostBtn = document.getElementById('hostBtn'), joinBtn = document.getElementById('joinBtn');
const mpNote = document.getElementById('mpNote'), roomEl = document.getElementById('room');
const NAME_KEY = 'broadside.name';
try { nameIn.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* private mode */ }
const myName = () => {
  const n = nameIn.value.trim().slice(0, 14);
  try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* private mode */ }
  return n;
};
const WHY = {
  network: 'Couldn’t reach the matchmaking server. Check the headset is online and try again.',
  noroom: 'No game found with that code. Check the code, and that the host has pressed “Host a game”.',
  full: 'That ship is full (4 players).',
  timeout: 'The host didn’t answer. Try again; if it keeps failing, your network may block direct connections (see the help page).',
  closed: 'The host closed the connection.',
};
const mpBusy = (on) => { hostBtn.disabled = joinBtn.disabled = on; };
async function hostGame() {
  G.net.voice.mic(); // asks for the microphone now, while you're still on this screen
  mpBusy(true); mpNote.textContent = 'Opening a room…';
  try {
    const code = await G.net.host(myName());
    roomEl.textContent = `Room code: ${code}`; roomEl.style.display = 'block';
    mpNote.textContent = 'Friends: open the game, type this code and press Join. Then everyone presses Enter VR. Friends can join any time.';
    for (const el of [hostBtn, joinBtn, codeIn, nameIn]) el.style.display = 'none';
  } catch (e) { mpNote.textContent = WHY[e.message] || `Couldn’t open a room (${e.message}).`; mpBusy(false); }
}
async function joinGame() {
  const code = codeIn.value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { mpNote.textContent = 'Type the 4-letter room code from the host’s screen first.'; codeIn.focus(); return; }
  if (G.started) { mpNote.textContent = 'Reload the page to join a friend’s game.'; return; }
  G.net.voice.mic();
  mpBusy(true); mpNote.textContent = `Looking for ship ${code}…`;
  try {
    await G.net.join(code, myName());
    roomEl.textContent = `Aboard ship ${code}`; roomEl.style.display = 'block';
    mpNote.textContent = 'You’re aboard! Press Enter VR (or Play on desktop). The host picks the weather and steers the voyage.';
    for (const el of [hostBtn, joinBtn, codeIn, nameIn]) el.style.display = 'none';
    document.getElementById('weather').style.display = 'none';
    document.getElementById('rating').style.display = 'none';
  } catch (e) {
    const v = /^version:(\d+)/.exec(e.message);
    mpNote.textContent = v ? `The host has version ${v[1]} of the game and you have version ${VERSION_NOW}. Both of you: reload the page so you’re on the same one.` : (WHY[e.message] || `Couldn’t join (${e.message}).`);
    mpBusy(false);
  }
}
// Voice chat panel (net/voice.js): your mic, and each friend's volume and mute.
// Shown on this screen once you host or join (in VR: take the headset out of VR to see it).
const voicePanel = document.getElementById('voicePanel');
let voiceKey = '';
function drawVoicePanel(force) {
  const V = G.net.voice;
  if (!V.on) { voicePanel.style.display = 'none'; return; }
  const friends = [...G.net.avatars.values()];
  const key = [V.muted, !!V.stream, V.denied, ...friends.map((p) => `${p.id}:${p.name}:${V.calls.has(p.id)}:${V.pref(p.name).muted}`)].join('|');
  if (key === voiceKey && !force) return;
  voiceKey = key;
  voicePanel.style.display = 'flex';
  voicePanel.textContent = '';
  const row = () => { const d = document.createElement('div'); d.className = 'row'; voicePanel.appendChild(d); return d; };
  const r0 = row(), lab = document.createElement('span');
  lab.textContent = V.stream ? (V.muted ? 'Voice chat: your mic is OFF' : 'Voice chat: your mic is on') : V.denied ? 'Voice chat: no microphone allowed (you can still hear friends)' : 'Voice chat: waiting for the microphone…';
  r0.appendChild(lab);
  if (V.stream) { const b = document.createElement('button'); b.textContent = V.muted ? 'Turn mic on' : 'Mute my mic'; b.onclick = () => V.setMuted(!V.muted); r0.appendChild(b); }
  for (const pl of friends) {
    const pr = V.pref(pl.name), r = row(), n = document.createElement('span');
    n.textContent = `${pl.name}${V.calls.has(pl.id) ? '' : ' (connecting)'}`; n.style.minWidth = '110px';
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 200; sl.value = Math.round(pr.vol * 100);
    sl.oninput = () => V.setPref(pl.name, { vol: sl.value / 100 });
    const m = document.createElement('button'); m.textContent = pr.muted ? 'Unmute' : 'Mute';
    m.onclick = () => V.setPref(pl.name, { muted: !V.pref(pl.name).muted });
    r.append(n, sl, m);
  }
}
G.net.voice.onChange = () => drawVoicePanel();
setInterval(() => drawVoicePanel(), 1000); // friends coming and going

// Closing the tab: tell the others straight away instead of letting them wait for a timeout
window.addEventListener('pagehide', () => G.net.leave());
hostBtn.addEventListener('click', hostGame);
joinBtn.addEventListener('click', joinGame);
codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
// ?host opens a room straight away; ?join=ABCD joins one (handy for links and testing)
if (params.has('host')) hostGame();
else if (params.get('join')) { codeIn.value = params.get('join'); joinGame(); }

document.addEventListener('pointerlockchange', () => {
  if (G.mode === 'desktop' && !document.pointerLockElement) G.hud.msg('Click to keep playing', 2);
});

// ---------- Main loop ----------
let last = performance.now(), creakT = 3;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const allShips = () => [G.ship, ...G.enemies.ships];

// Keep ships off the coast: sample bow, middle and stern against the land and push back toward deep water.
const _grad = { x: 0, z: 0 }, _pt = { x: 0, z: 0 };
let agroundMsgT = 0;
function landCollisions(dt) {
  const W = G.world;
  agroundMsgT -= dt;
  for (const s of allShips()) {
    for (const lz of [-9, 0, 7]) {
      s.localToWorldXZ(0, lz, _pt);
      const h = W.landHeight(_pt.x, _pt.z);
      if (h <= -2.2) continue;
      W.landGradient(_pt.x, _pt.z, _grad);
      const g = Math.hypot(_grad.x, _grad.z) || 1;
      const push = Math.min(1.2, (h + 2.2) * 0.4 + 0.1);
      s.pos.x -= (_grad.x / g) * push; s.pos.z -= (_grad.z / g) * push;
      s.speed *= 0.92;
      if (s === G.ship && s.speed > 0.8 && agroundMsgT <= 0) { agroundMsgT = 4; G.events.emit('ranAground'); }
    }
  }
}

function aimPlayerCannons() {
  const S = G.ship;
  // Real enemies first; a drifting or captured hull only if nothing else is in the arc
  const rank = (e) => e.pos.distanceTo(S.pos) + (e.hostile ? 0 : 1e4);
  const enemies = G.enemies.ships.filter((e) => e.alive);
  if (G.kraken.targetable) enemies.push(G.kraken.target); // the Kraken's head (kraken.js)
  enemies.sort((a, b) => rank(a) - rank(b));
  for (const c of S.cannons) {
    if (c.manual) { c.inArc = false; c.targetHostile = false; continue; } // a player is laying this one by hand
    c.inArc = false; c.targetHostile = false;
    for (const e of enemies) if (S.aimCannon(c, e, 0)) { c.inArc = true; c.targetHostile = e.hostile; break; }
    if (!c.inArc) { c.tElev = 0.06; c.tYaw = 0; }
  }
}

function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt);
  renderer.render(scene, camera);
}

// One frame of the whole game. Roughly in three parts:
//   1. input: the local player's hands/keys become actions (G.act)
//   2. rules: ships, enemies, crew, combat, health (in multiplayer only the host does this)
//   3. view:  effects, messages, sound, the ocean (every headset does this)
function simulate(dt) {
  G.t += dt;
  const t = G.t, S = G.ship, playing = !!G.mode;

  if (!G.isHost) { clientFrame(dt, playing); view(dt); return; }

  if (playing) {
    G.player.update(dt);
    S.applyHelm();
    stepPlayers(G, dt);
    G.player.updateView(dt);
  } else { S.rudder = 0; S.sail = (0.6 - S.leverAngle) / 1.2; G.player.clampToDeck(); }
  S.update(dt, t);

  if (playing && G.started) {
    G.grapples.update(dt);
    G.voyages.update(dt);
    G.island.update(dt, t);
    G.enemies.update(dt, t);
    G.kraken.update(dt, t);
    G.grapples.checkPrize();
    aimPlayerCannons();
    G.crew.update(dt, t);
    G.combat.update(dt, t);
    G.damage.step(dt);
    landCollisions(dt);

    // A friend (or you) down while others still stand: back on your feet after a few seconds
    if (G.state === 'play') for (const pl of G.players) if (pl.dead && (pl.deadT = (pl.deadT || 0) + dt) > 6) {
      pl.deadT = 0; pl.respawn(); G.events.emit('playerRevived', { player: pl });
    }
    if (G.state === 'play' && !S.alive) {
      G.state = 'sinking'; G.stateT = 7;
      G.events.emit('shipSinking');
    }
    if (G.state !== 'play') {
      G.stateT -= dt;
      if (G.state === 'dead' && G.stateT <= 0) {
        for (const b of G.enemies.boarders) G.enemies.killBoarder(b);
        for (const pl of G.players) if (pl.dead) { pl.respawn(); G.events.emit('playerRevived', { player: pl }); }
        G.state = S.alive ? 'play' : 'sinking'; G.stateT = 3;
      }
      if (G.state === 'sinking' && G.stateT <= 0) resetGame();
    }
  } else {
    G.crew.update(dt, t);
  }
  G.net.update(dt);
  view(dt);
}

// A friend's headset: our hands and keys still make actions (sent to the host by net.js),
// and the world follows the host's snapshots (net/mirror.js).
function clientFrame(dt, playing) {
  if (playing) { G.player.update(dt); G.player.updateView(dt); }
  else G.player.clampToDeck();
  G.net.update(dt);
}

// Looks and sound, every headset
function view(dt) {
  const t = G.t, S = G.ship;
  // Bow spray on every moving ship
  for (const s of allShips()) {
    if (!s.alive) continue;
    if (Math.random() < s.speed * dt * 1.4) { _a.set(rand(-1, 1), -1.1, -9.2); s.root.localToWorld(_a); G.fx.foam(_a); }
  }
  creakT -= dt;
  if (creakT <= 0) { creakT = rand(4, 9); _a.set(rand(-2, 2), 1, rand(-6, 6)); S.root.localToWorld(_a); G.audio.creak(_a); }

  G.grapples.view(dt);
  G.swing.view(dt);
  G.damage.view(dt);
  G.island.view(dt);
  G.kraken.view(dt);
  camera.getWorldPosition(_a);
  G.weather.update(dt, t, _a);
  G.world.update(t, S.pos, _a);
  G.fx.update(dt);
  G.hud.update(dt);
  camera.getWorldDirection(_b); _c.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  G.audio.setListener(_a, _b, _c, t, S.speed);
}
G.simulate = simulate;
renderer.setAnimationLoop(tick);

