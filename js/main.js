import * as THREE from 'three';
import { makeWorld } from './world.js';
import { Ship } from './ship.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Crew } from './crew.js';
import { Hud } from './hud.js';
import { rand } from './util.js';

const params = new URLSearchParams(location.search);
const G = window.G = { t: 0, score: 0, mode: null, debug: params.has('debug'), state: 'play', stateT: 0 };

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
G.ship = new Ship(scene, { isPlayer: true, comfort: 0.45, health: 150, maxSpeed: 9.5, sail: 0.35, reloadTime: 5 });
G.ship.leverAngle = 0.6 - 1.2 * 0.35;
G.fx = new Effects(scene);
G.audio = new Sound();
G.combat = new Combat(G);
G.enemies = new Enemies(G);
G.player = new Player(G);
G.crew = new Crew(G);
G.hud = new Hud(G);
G.player.setupVR(renderer);

// ---------- Game events ----------
G.onEnemySunk = (s) => {
  G.score++;
  G.hud.msg(G.score === 1 ? 'Enemy ship sunk! Huzzah!' : `Another one down! ${G.score} sunk`, 3.5);
  G.crew.cheer(); G.audio.cheer();
  for (const m of s.crew) if (!m.p.dead && Math.random() < 0.5) m.p.dead = true;
};
G.onPlayerDeath = () => {
  G.hud.msg('You were cut down!', 3);
  G.state = 'dead'; G.stateT = 3;
};

function resetGame() {
  const S = G.ship;
  G.enemies.clearAll();
  S.health = S.maxHealth; S.alive = true; S.sinkT = 0; S.speed = 0;
  S.wheelAngle = 0; S.leverAngle = 0.6 - 1.2 * 0.35;
  G.player.respawn();
  G.score = 0; G.state = 'play';
  G.hud.msg('A fresh ship and a fresh crew. Good luck, Captain.', 4);
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
    G.hud.msg('Your crew is busy. The fighting is up to you!', 4);
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

function islandCollisions() {
  for (const s of allShips()) {
    for (const isl of G.world.islands) {
      const dx = s.pos.x - isl.x, dz = s.pos.z - isl.z, d = Math.hypot(dx, dz), r = isl.r + 9;
      if (d < r) {
        s.pos.x = isl.x + (dx / d) * r; s.pos.z = isl.z + (dz / d) * r; s.speed *= 0.9;
        if (s === G.ship && s.speed > 1) G.hud.msg('Ran aground! Steer clear of the island', 2.5);
      }
    }
  }
}

function aimPlayerCannons() {
  const S = G.ship;
  const enemies = G.enemies.ships.filter((e) => e.alive).sort((a, b) => a.pos.distanceTo(S.pos) - b.pos.distanceTo(S.pos));
  for (const c of S.cannons) {
    c.inArc = false;
    for (const e of enemies) if (S.aimCannon(c, e, 0)) { c.inArc = true; break; }
    if (!c.inArc) { c.tElev = 0.06; c.tYaw = 0; }
  }
}

function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt);
  renderer.render(scene, camera);
}

function simulate(dt) {
  G.t += dt;
  const t = G.t, S = G.ship, playing = !!G.mode;

  if (playing) G.player.update(dt);
  else { S.rudder = 0; S.sail = (0.6 - S.leverAngle) / 1.2; G.player.clampToDeck(); }
  S.update(dt, t);

  if (playing && G.started) {
    G.enemies.update(dt, t);
    aimPlayerCannons();
    G.crew.update(dt, t);
    G.combat.update(dt, t);
    islandCollisions();

    if (G.state === 'play' && !S.alive) {
      G.state = 'sinking'; G.stateT = 7;
      G.hud.msg('We’re going down! Abandon ship!', 5);
    }
    if (G.state !== 'play') {
      G.stateT -= dt;
      if (G.state === 'dead' && G.stateT <= 0) {
        for (const b of G.enemies.boarders) G.enemies.killBoarder(b);
        G.player.respawn(); G.state = S.alive ? 'play' : 'sinking'; G.stateT = 3;
        G.hud.msg('The crew dragged you back to the helm', 3);
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
