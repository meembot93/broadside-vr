// Pirate voice lines. The crew (and the enemy) now and then shout about what's happening,
// heard from the pirate who says it. Clips are made by tools/voices/make_voices.py and listed
// in voicelist.js. Like presentation.js this only listens to game events; it never changes the game.
//
// Not every event gets a line: chatty lines have a chance and a cooldown, only one pirate talks
// at a time, and important lines wait their turn for a few seconds instead of talking over others.
import * as THREE from 'three';
import { VOICE_LINES } from './voicelist.js';

const VOL = 1.25;          // voice loudness next to the other sounds
const WAIT = 5;            // how long an important line may wait for its turn (s)
const GAP = 0.35;          // pause between two lines (s)
const CHATTER_GAP = 2.5;   // quiet time needed before an unimportant line (s)

export class Voices {
  constructor(G) {
    this.G = G;
    this.bufs = new Map(); this.loading = new Map();
    this.busyUntil = 0; this.queue = [];
    this.coolUntil = {}; this.lastClip = {};
    this.started = false;
  }

  // Load every clip once the audio is running (small files, ~10 KB each). Welcome line first.
  load() {
    const ctx = this.G.audio.ctx; if (!ctx || this.started) return; this.started = true;
    const ids = Object.values(VOICE_LINES).flat().map((c) => c.id).sort((a, b) => (b.startsWith('welcome') ? 1 : 0) - (a.startsWith('welcome') ? 1 : 0));
    let i = 0;
    const next = () => { if (i < ids.length) this.fetch(ids[i++]).finally(next); };
    for (let k = 0; k < 4; k++) next();
  }
  fetch(id) {
    if (!this.loading.has(id)) {
      const ctx = this.G.audio.ctx;
      this.loading.set(id, fetch(`sounds/voice/${id}.ogg`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
        .then((buf) => { this.bufs.set(id, buf); return buf; }).catch(() => null));
    }
    return this.loading.get(id);
  }

  // Where a pirate's voice comes from: our crew by name, otherwise `at` (a person, a position or null).
  where(who, at) {
    // (Finn's lines are said by Bones now that the crew is smaller)
    const name = who === 'Finn' ? 'Bones' : who;
    const m = this.G.crew.members.find((x) => x.name === name);
    const p = m ? m.p : at && at.g ? at : null;
    if (p) return p.g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0));
    return at && at.isVector3 ? at.clone() : null;
  }

  // say('hooked', { prio: 2 }) — prio 2 important (waits its turn), 1 normal, 0 chatter.
  // chance: how often it's said at all; cool: seconds before this group may be said again;
  // who: only clips in this pirate's voice; at: where an enemy line comes from; delay: s.
  say(group, { prio = 1, chance = 1, cool = 0, who = null, at = null, delay = 0 } = {}) {
    const ctx = this.G.audio.ctx; if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (Math.random() > chance || (this.coolUntil[group] || 0) > now) return;
    let clips = VOICE_LINES[group] || [];
    if (who) clips = clips.filter((c) => c.who === who);
    if (clips.length > 1) clips = clips.filter((c) => c.id !== this.lastClip[group]);
    if (!clips.length) return;
    const clip = clips[Math.floor(Math.random() * clips.length)];
    this.coolUntil[group] = now + cool + delay;
    this.lastClip[group] = clip.id;
    const go = () => {
      const t = ctx.currentTime;
      if (prio < 2 && this.busyUntil > t - (prio === 0 ? CHATTER_GAP : 0)) return;
      if (prio === 2 && this.busyUntil - t > WAIT) return;
      const buf = this.bufs.get(clip.id);
      if (!buf) { if (prio === 2) this.fetch(clip.id).then((b) => b && ctx.currentTime - t < 2.5 && this.play(b, clip, at, 0)); return; }
      this.play(buf, clip, at, prio === 2 ? Math.max(0, this.busyUntil - t) : 0);
    };
    if (delay > 0) setTimeout(go, delay * 1000); else go();
  }

  play(buf, clip, at, wait) {
    const ctx = this.G.audio.ctx, t = ctx.currentTime + wait;
    const pos = this.where(clip.who, at);
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.connect(this.G.audio.out(pos, VOL, 5, 0.6));
    src.start(t);
    this.busyUntil = Math.max(this.busyUntil, t + buf.duration + GAP);
  }
}

// A live pirate on an enemy ship (to shout from), or the ship itself.
const enemyVoice = (e) => (e && e.crew && e.crew.find((m) => !m.p.dead)?.p) || (e && e.root.position);

export function wireVoices(G) {
  const V = G.voices = new Voices(G);
  const on = (type, fn) => G.events.on(type, fn);
  const isMe = (pl) => pl === G.player;

  on('gameStarted', () => { V.load(); V.say('welcome', { prio: 2, delay: 1.2 }); });

  // Lookout and battle
  on('enemySpawned', ({ count, boss }) => !boss && V.say(count > 1 ? 'sightedMore' : 'sighted', { prio: 2, delay: 0.8 }));
  on('enemySunk', ({ ship }) => { if (!ship.boss) V.say('sunk', { prio: 2, delay: 0.9 }); });
  on('shipHit', ({ ship }) => { if (ship === G.ship) V.say('takingHits', { chance: 0.4, cool: 18 }); });
  on('enemyCrewKilled', ({ role, left, boss }) => { if (role === 'helm' && left > 0 && !boss) V.say('helmDown', { cool: 10 }); });
  on('enemyAbandoned', ({ ship }) => { if (!ship.boss) V.say('abandoned', { prio: 2, delay: 0.5 }); });

  // Voyages and boss captains (voyages.js)
  const bossOf = (e) => e && e.crew && e.crew.find((m) => m.boss && !m.p.dead)?.p;
  on('bossArrived', () => V.say('bossArrived', { prio: 2, delay: 1.2 }));
  on('bossWounded', ({ cause }) => { const e = G.voyages && G.voyages.bossShip, b = bossOf(e); if (b) V.say('bossTaunt', { prio: cause === 'sword' ? 1 : 0, chance: 0.5, cool: 8, at: b }); });
  on('bossCaptainKilled', () => V.say('bossFalls', { prio: 2, delay: 1 }));
  on('waveCleared', ({ next, nextIsBoss }) => { if (next) V.say(nextIsBoss ? 'bossNear' : 'waveCleared', { prio: 2, delay: 1.5 }); });
  on('voyageWon', () => V.say('voyageWon', { prio: 2, delay: 1.5 }));
  on('musketHit', ({ kind }) => { if (kind === 'enemyCrew' || kind === 'boarder') V.say('niceShot', { prio: 0, chance: 0.3, cool: 15, delay: 0.5 }); });

  // Boarders
  on('boarderSpawned', ({ first }) => {
    const b = G.enemies.boarders[G.enemies.boarders.length - 1];
    V.say('enemyBoard', { prio: 0, chance: 0.6, cool: 5, at: b && b.p });
    if (first) V.say('boarders', { prio: 2, delay: 0.3 });
  });
  on('boarderSwing', ({ pos }) => V.say('enemyTaunt', { prio: 0, chance: 0.12, cool: 9, at: pos }));
  on('deckCleared', () => V.say('deckClear', { chance: 0.7, cool: 20, delay: 0.4 }));

  // Grapples and boarding
  on('grappleHooked', () => V.say('hooked', { prio: 2 }));
  on('grappleMissed', ({ far }) => V.say(far ? 'tooFar' : 'missed', { cool: 6 }));
  on('enemyGrappled', ({ ship }) => { V.say('enemyGrapple', { prio: 0, chance: 0.6, at: enemyVoice(ship) }); V.say('theyGrapple', { prio: 2, delay: 0.2 }); });
  on('shipsLashed', ({ by }) => V.say(by === 'us' ? 'lashed' : 'theyLashed', { prio: 2 }));
  on('crewBoards', ({ name }) => V.say('crewBoards', { who: name, chance: 0.5, cool: 8 }));
  on('playerCrossed', ({ player, ship, home }) => { if (isMe(player) && !home) { const b = bossOf(ship); if (b) V.say('bossTaunt', { at: b, cool: 8 }); else V.say('enemyRepel', { chance: 0.8, cool: 10, at: enemyVoice(ship) }); } });
  on('prizeTaken', () => V.say('prize', { prio: 2, delay: 0.6 }));
  on('kegLit', () => V.say('kegLit', { prio: 2, delay: 0.3 }));
  on('kegExploded', () => V.say('boom', { prio: 2, delay: 1.3 }));

  // Hawkins at the helm
  on('helmTaken', ({ order }) => V.say(`order_${order}`, { prio: 2 }));
  let orderT = null; // flicking through orders: Hawkins answers the one you settle on
  on('helmOrder', ({ order }) => { clearTimeout(orderT); orderT = setTimeout(() => { if (G.crew.order === order) V.say(`order_${order}`, { prio: 2 }); }, 700); });
  on('helmHandedBack', () => V.say('helmBack', { cool: 20 }));
  on('ranAground', () => V.say('aground', { cool: 15 }));

  // The captain
  on('playerDied', ({ player }) => { if (isMe(player)) V.say('capDown', { prio: 2 }); });
  on('playerRevived', ({ player }) => { if (isMe(player)) V.say('capUp', { prio: 2, delay: 0.8 }); });
  on('shipSinking', () => V.say('sinking', { prio: 2 }));
  on('gameReset', () => V.say('welcome', { prio: 2, delay: 1 }));
}
