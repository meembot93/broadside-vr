import * as THREE from 'three';
import { makeWorld } from './world.js';
import { Ship } from './ship.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Crew } from './crew.js';
import { Grapples } from './grapple.js';
import { Hud } from './hud.js';
import { rand } from './util.js';
import { Events } from './events.js';
import { Ids } from './ids.js';
import { applyAction, stepPlayers, hurtPlayer } from './actions.js';
import { wirePresentation } from './presentation.js';
import { snapshot } from './state.js';

const params = new URLSearchParams(location.search);
const G = window.G = { t: 0, score: 0, mode: null, debug: params.has('debug'), state: 'play', stateT: 0 };
// Multiplayer groundwork. For now this headset is always the host (it runs the game rules)
// and the only player. See docs/MULTIPLAYER.md for how friends will join later.
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
G.player = new Player(G);          // you, on this headset
G.players = [G.player];             // everyone on board; friends get added here later
G.items = G.player.items;           // muskets and cutlass on the rack (shared by the crew of players)
G.crew = new Crew(G);
G.grapples = new Grapples(G);
G.hud = new Hud(G);
G.player.setupVR(renderer);

// ---------- Ids and actions ----------
// Find anything by its id: ships, cannons, items, players.
G.byId = (id) => {
  for (const s of [G.ship, ...G.enemies.ships]) {
    if (s.id === id) return s;
    for (const c of s.cannons) if (c.id === id) return c;
  }
  return G.items.find((x) => x.id === id) || G.playerById(id) || G.enemies.boarders.find((b) => b.id === id) || null;
};
G.playerById = (id) => G.players.find((p) => p.id === id) || null;
// Everything a player does goes through here (see actions.js).
G.act = (a) => applyAction(G, { player: G.player.id, ...a });
G.hurtPlayer = (pl, n) => hurtPlayer(G, pl, n);
G.snapshot = () => snapshot(G);

// ---------- Game events ----------
// Effects, sounds and messages for every event are in presentation.js.
wirePresentation(G);
// Rules that react to events:
G.events.on('playerDied', () => { G.state = 'dead'; G.stateT = 3; });

function resetGame() {
  const S = G.ship;
  G.grapples.clearAll();
  G.enemies.clearAll();
  S.health = S.maxHealth; S.alive = true; S.sinkT = 0; S.speed = 0;
  S.wheelAngle = 0; S.leverAngle = 0.6 - 1.2 * 0.35;
  S.helmBy = G.player.id; S.holdHeading = S.heading;
  for (const pl of G.players) pl.respawn();
  G.score = 0; G.state = 'play';
  G.events.emit('gameReset');
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
  const enemies = G.enemies.ships.filter((e) => e.alive).sort((a, b) => rank(a) - rank(b));
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

  if (playing) {
    G.player.update(dt);
    S.applyHelm();
    stepPlayers(G, dt);
    G.player.updateView(dt);
  } else { S.rudder = 0; S.sail = (0.6 - S.leverAngle) / 1.2; G.player.clampToDeck(); }
  S.update(dt, t);

  if (playing && G.started) {
    G.grapples.update(dt);
    G.enemies.update(dt, t);
    G.grapples.checkPrize();
    aimPlayerCannons();
    G.crew.update(dt, t);
    G.combat.update(dt, t);
    landCollisions(dt);

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
    if (S.alive && !G.enemies.ships.some((e) => e.alive && e.pos.distanceTo(S.pos) < 200)) S.health = Math.min(S.maxHealth, S.health + dt * 0.8);
  } else {
    G.crew.update(dt, t);
  }

  // Bow spray on every moving ship
  for (const s of allShips()) {
    if (!s.alive) continue;
    if (Math.random() < s.speed * dt * 1.4) { _a.set(rand(-1, 1), -1.1, -9.2); s.root.localToWorld(_a); G.fx.foam(_a); }
  }
  creakT -= dt;
  if (creakT <= 0) { creakT = rand(4, 9); _a.set(rand(-2, 2), 1, rand(-6, 6)); S.root.localToWorld(_a); G.audio.creak(_a); }

  G.grapples.view(dt);
  camera.getWorldPosition(_a);
  G.world.update(t, S.pos, _a);
  G.fx.update(dt);
  G.hud.update(dt);
  camera.getWorldDirection(_b); _c.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  G.audio.setListener(_a, _b, _c, t, S.speed);
}
G.simulate = simulate;
renderer.setAnimationLoop(tick);

if (G.debug) {
  // Testing shortcuts
  G.enemies.spawnT = 1;
}
