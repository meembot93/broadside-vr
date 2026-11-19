// The action layer: the ONE place where a player's hands change the game.
//
// Input code (VR controllers or desktop keys, in player.js) never edits ships, cannons or
// enemies directly. It describes what the player did as a small plain object, for example
//   { type: 'lightCannon', cannon: 'ship:0/cannon:2', delay: 0.35 }
// and passes it to G.act(). Today G.act() applies it straight away. In multiplayer, a
// friend's headset will send the same objects to the host instead, and the host applies them
// with exactly this function, so there is one set of rules for everybody.
//
// Every action carries `player` (who did it). Positions inside actions are in world space for
// now; the network version will convert them to ship-local space before sending.
import * as THREE from 'three';
import { clamp } from './util.js';
import { WHEEL_MAX, LEVER_MAX } from './ship.js';

const _p = new THREE.Vector3();

export function applyAction(G, a) {
  const player = G.playerById(a.player) || G.player;
  const S = G.ship;
  switch (a.type) {
    // Turn the wheel by `delta` radians. Returns how far it actually turned.
    case 'steer': {
      const before = S.wheelAngle;
      S.wheelAngle = clamp(S.wheelAngle + a.delta, -WHEEL_MAX, WHEEL_MAX);
      return S.wheelAngle - before;
    }
    // Move the sail lever to `angle`.
    case 'setSail':
      S.leverAngle = clamp(a.angle, -LEVER_MAX, LEVER_MAX);
      return true;
    // Light the fuse on one cannon. Returns 'lit', 'reloading' or 'busy'.
    case 'lightCannon': {
      const c = G.byId(a.cannon);
      if (!c) return 'busy';
      if (S.lightCannon(c, a.delay)) {
        G.events.emit('fuseLit', { ship: S, cannon: c, pos: c.breech.getWorldPosition(_p) });
        G.crew.playerFired();
        return 'lit';
      }
      return c.reload > 0 ? 'reloading' : 'busy';
    }
    // Light every cannon that has a target. Returns how many were lit.
    case 'broadside': {
      const n = G.combat.broadside(S);
      if (n) G.crew.playerFired();
      return n;
    }
    // Pick up / put down a musket or the cutlass.
    case 'takeItem': {
      const it = G.byId(a.item);
      if (!it || (it.heldBy && it.heldBy !== player.id)) return false;
      it.heldBy = player.id;
      return true;
    }
    case 'dropItem': {
      const it = G.byId(a.item);
      if (it && it.heldBy === player.id) it.heldBy = null;
      return true;
    }
    // Pull a musket's trigger. origin/dir: the shot's ray; from: the muzzle (for the flash).
    case 'fireMusket': {
      const it = G.byId(a.item);
      if (!it) return false;
      if (!it.loaded) { G.events.emit('musketEmpty', { item: it, pos: a.from }); return false; }
      it.loaded = false; it.reloadT = 1.8; it.kick = 1;
      G.combat.musketShot(a.origin, a.dir, a.from);
      return true;
    }
    // A VR sword moved this frame: hilt/tip in ship-local space, speed of the tip in m/s.
    // Returns true if it hit anyone.
    case 'swordSweep':
      return G.combat.swordCheck(player, a.hilt, a.tip, a.speed);
    // Desktop sword swing. facing: look direction in ship-local space, flat and normalized.
    case 'deskSlash':
      G.combat.deskSwordHit(player, a.facing);
      return true;
  }
  console.warn('Unknown action', a);
  return false;
}

// Rules that tick for every player each frame (the host will run these for everyone).
export function stepPlayers(G, dt) {
  for (const pl of G.players) {
    if (!pl.dead && G.t - pl.lastHurt > 4 && pl.health < 100) pl.health = Math.min(100, pl.health + 10 * dt);
  }
  for (const it of G.items) {
    if (it.kind !== 'musket' || it.loaded) continue;
    it.reloadT -= dt;
    if (it.reloadT <= 0) { it.loaded = true; G.events.emit('musketReloaded', { item: it }); }
  }
}

// Someone got hurt. Same rules for every player; effects only show on that player's headset.
export function hurtPlayer(G, pl, n) {
  if (pl.dead) return;
  pl.health -= n; pl.lastHurt = G.t;
  G.events.emit('playerHurt', { player: pl, amount: n });
  if (pl.health <= 0) { pl.health = 0; pl.dead = true; G.events.emit('playerDied', { player: pl }); }
}
