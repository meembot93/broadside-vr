// Voyages: the game comes in short runs of fights instead of endless spawning.
// A voyage is a few waves of enemy ships; the last wave brings a boss, a galleon under a
// named captain you can duel at the wheel. Beat the boss and the voyage is won: the ship is
// refitted and the next, harder voyage begins. Lose the ship and the voyage starts over.
//
// Rules only (the host runs this). Everything it does is announced as an event, so sounds,
// messages, voice lines or weather can hook in from presentation.js or anywhere else:
//   voyageStarted { voyage, name, waves, boss }   a new voyage (or a restart after sinking)
//   waveStarted   { voyage, wave, waves, kinds, boss }   a wave's first sail is about to appear
//   bossArrived   { voyage, ship, name }           the boss galleon is in sight
//   waveCleared   { voyage, wave, waves, next }    every ship of the wave sunk, taken or abandoned
//   bossDefeated  { voyage, ship, name, how }      how: 'duel' (cut down) | 'shot' | 'taken' | 'sunk' | 'crew'
//   voyageWon     { voyage, name, next }           the victory moment; next voyage follows
//   shipRefitted  { }                              hull and crew patched up between voyages
import { rand } from './util.js';

const NAMES = ['The Smugglers’ Run', 'The Red Sails', 'The Iron Fleet', 'The Kraken’s Wake', 'The Devil’s Reach'];
const CAPTAINS = ['Captain Silas Grimm', 'Red Anne Calloway', 'Black Tom Harrow', 'Ezekiel “Iron” Voss', 'Mad Mary Crane', 'Captain Bartholomew Rook'];

// The waves of voyage n (1, 2, 3...). Each wave is a list of ship kinds; the boss ship is the
// first of the last wave. Ships in a wave sail in one after another.
function plan(n) {
  if (n === 1) return [['sloop', 'sloop'], ['brigantine'], ['galleon']];
  if (n === 2) return [['sloop', 'brigantine'], ['brigantine', 'sloop', 'sloop'], ['galleon', 'sloop']];
  return [['brigantine', 'brigantine'], ['galleon', 'sloop', 'sloop'], ['galleon', 'brigantine']];
}

export class Voyages {
  constructor(G) {
    this.G = G;
    this.n = 0;          // voyage number, from 1
    this.wave = 0;       // wave number within the voyage, from 1
    this.waves = [];
    this.phase = 'idle'; // idle -> calm (before a wave) -> fight -> calm ... -> won -> calm (next voyage)
    this.t = 0;          // countdown for the current calm
    this.queue = [];     // kinds still to sail in this wave
    this.ships = [];     // this wave's ships
    this.nextT = 0;      // countdown to the next ship of the wave
    this.bossShip = null; this.bossName = null;
    // ?voyage=3 starts on voyage 3, ?wave=3 jumps straight to the boss wave (testing)
    const q = new URLSearchParams(location.search);
    this.startN = Math.max(1, parseInt(q.get('voyage')) || 1);
    this.firstWave = Math.max(1, parseInt(q.get('wave')) || 1);
    this.startTreasure = q.has('treasure');
    G.events.on('bossCaptainKilled', ({ ship, cause }) => { if (ship === this.bossShip) this.bossKillCause = cause; });
  }

  get name() { return NAMES[(this.n - 1) % NAMES.length] + (this.n > NAMES.length ? ` ${Math.ceil(this.n / NAMES.length)}` : ''); }
  get bossWave() { return this.wave === this.waves.length; }

  // Called once the game starts, and again after the ship is lost (same voyage, from wave 1).
  begin(n = this.n || this.startN, fromWave = 1) {
    this.n = n; this.waves = plan(n);
    this.bossName = CAPTAINS[(n - 1) % CAPTAINS.length];
    this.wave = Math.min(fromWave, this.waves.length) - 1;
    this.ships = []; this.queue = []; this.bossShip = null; this.bossKillCause = null;
    this.G.events.emit('voyageStarted', { voyage: n, name: this.name, waves: this.waves.length, boss: this.bossName });
    this.calm(this.G.debug ? 3 : 12);
  }

  // (a treasure hunt in progress carries on: there's nothing to restart)
  restart() { if (this.phase !== 'treasure') this.begin(this.n || this.startN, 1); }

  calm(secs) { this.phase = 'calm'; this.t = secs; }

  startWave() {
    const G = this.G;
    this.wave++;
    this.queue = [...this.waves[this.wave - 1]];
    this.ships = []; this.nextT = 0;
    G.events.emit('waveStarted', { voyage: this.n, wave: this.wave, waves: this.waves.length, kinds: [...this.queue], boss: this.bossWave ? this.bossName : null });
    this.phase = 'fight';
  }

  spawnNext() {
    const G = this.G, kind = this.queue.shift();
    const boss = this.bossWave && !this.bossShip ? { name: this.bossName } : null;
    const s = G.enemies.spawn(kind, { level: this.n - 1, boss });
    this.ships.push(s);
    if (boss) { this.bossShip = s; G.events.emit('bossArrived', { voyage: this.n, ship: s, name: this.bossName }); }
    this.nextT = G.debug ? 8 : rand(22, 30);
  }

  update(dt) {
    const G = this.G;
    if (!G.ship.alive) return;
    if (this.phase === 'idle') {
      // ?treasure: skip straight to a treasure hunt (testing)
      if (this.startTreasure) { this.n = this.startN; this.waves = plan(this.n); this.bossName = CAPTAINS[(this.n - 1) % CAPTAINS.length]; this.phase = 'treasure'; G.island.start(this.n); return; }
      this.begin(this.startN, this.firstWave); return;
    }
    if (this.phase === 'calm') {
      this.t -= dt;
      if (this.t <= 0) this.startWave();
      return;
    }
    if (this.phase === 'won') { this.updateWon(dt); return; }
    if (this.phase !== 'fight') return;

    // Boss beaten? (sunk, taken as a prize, or her crew dead or gone over the side)
    const B = this.bossShip;
    if (B && !B.bossDone && !B.hostile) {
      B.bossDone = true;
      const k = this.bossKillCause;
      const how = k === 'sword' ? 'duel' : B.captured ? 'taken' : !B.alive ? 'sunk' : k ? 'shot' : 'crew';
      G.events.emit('bossDefeated', { voyage: this.n, ship: B, name: this.bossName, how });
    }

    const live = this.ships.filter((s) => s.hostile).length;
    // The next sail of this wave: on a timer, or straight away once the sea is clear
    if (this.queue.length) {
      this.nextT -= dt;
      if (this.nextT <= 0 || live === 0) this.spawnNext();
      return;
    }
    if (live > 0) return;

    if (!this.bossWave) {
      const next = this.waves[this.wave];
      G.events.emit('waveCleared', { voyage: this.n, wave: this.wave, waves: this.waves.length, next, nextIsBoss: this.wave + 1 === this.waves.length });
      this.calm(G.debug ? 4 : 14);
      return;
    }
    // Voyage won!
    this.phase = 'won';
    G.events.emit('waveCleared', { voyage: this.n, wave: this.wave, waves: this.waves.length, next: null, nextIsBoss: false });
    G.events.emit('voyageWon', { voyage: this.n, name: this.name, next: this.n + 1 });
    this.wonT = G.debug ? 6 : 16;
  }

  // Between voyages: wait out the celebration, refit, then set sail on the next one.
  updateWon(dt) {
    this.wonT -= dt;
    if (this.wonT > 0) return;
    this.refit();
    // Treasure hunt on the islet (island.js); it starts the next voyage when everyone's back aboard
    this.phase = 'treasure';
    this.G.island.start(this.n);
  }

  // Patch the hull, heal everyone, and send the leftover hulks to the bottom.
  refit() {
    const G = this.G, S = G.ship;
    S.health = S.maxHealth;
    for (const pl of G.players) if (!pl.dead) pl.health = 100;
    for (const e of G.enemies.ships) {
      if (!e.alive || e.hostile || e.lock || G.players.some((pl) => pl.ship === e)) continue;
      e.scuttle(); e.sinkT = 3;
    }
    G.events.emit('shipRefitted', {});
  }

  // For the Captain's Board and G.snapshot()
  state() {
    return { voyage: this.n, wave: this.wave, waves: this.waves.length, phase: this.phase, boss: this.bossName,
      bossAlive: !!(this.bossShip && this.bossShip.hostile), bossShip: this.bossShip ? this.bossShip.id : null };
  }
}
