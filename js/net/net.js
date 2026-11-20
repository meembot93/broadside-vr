// Multiplayer: up to 4 players on one ship. One headset is the HOST: it runs the whole game
// exactly as in single player. Friends (CLIENTS) run no rules; their headsets
//   * send their head/hand pose ~20 times a second, and every G.act() action they take
//   * receive the host's snapshot (state.js) ~20 times a second, plus every game event as it
//     happens, so presentation.js plays the same smoke, sounds and messages everywhere.
// See docs/MULTIPLAYER.md. Transport (how messages travel) is in transport.js.
//
// Messages (all plain JSON):
//   friend -> host: hello {name, ver}   a {list: [actions]}   p {pose}
//   host -> friend: welcome {id, ver}   s {snap, poses}   e {ev: [[type, data]]}   cmd {c}   bye {why}
import * as THREE from 'three';
import { VERSION } from '../version.js';
import { applyAction } from '../actions.js';
import { ORDERS } from '../crew.js';
import { WHEEL_MAX, LEVER_MAX } from '../ship.js';
import { clamp } from '../util.js';
import { openRoom, joinRoom } from './transport.js';
import { RemotePlayer, localPose } from './avatar.js';
import { Mirror } from './mirror.js';

export const MAX_PLAYERS = 4;
const SEND_EVERY = 0.05; // seconds between snapshots / poses (20 a second)
// Room codes: 4 letters, no look-alikes (no I, O, L, 0, 1)
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const makeCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
// Events every headset makes for itself (not sent by the host)
const LOCAL_ONLY = new Set(['gameStarted']);
// Positions in actions that are in world space. A friend sends them in the local space of
// the ship they stand on, because their view of the world is a few frames behind the host's.
const POINTS = ['origin', 'from', 'to', 'pos'], DIRS = ['dir'];

const _q = new THREE.Quaternion();

// ---------- Turning game data into plain JSON and back ----------
// Game objects with an id (ships, cannons, players, items, boarders, leaks...) travel as
// {$id}; vectors as {$v: [x, y, z]}.
function pack(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (v.isVector3) return { $v: [v.x, v.y, v.z] };
  if (typeof v.id === 'string' && depth > 0) return { $id: v.id };
  if (Array.isArray(v)) return depth > 2 ? undefined : v.map((x) => pack(x, depth + 1));
  if (depth > 2 || (Object.getPrototypeOf(v) !== Object.prototype)) return undefined;
  const o = {};
  for (const k in v) { const x = pack(v[k], depth + 1); if (x !== undefined) o[k] = x; }
  return o;
}
// missing: set to true if an id can't be found (yet)
function unpack(G, v, state) {
  if (v === null || typeof v !== 'object') return v;
  if (v.$v) return new THREE.Vector3(...v.$v);
  if (v.$id) { const o = G.byId(v.$id); if (!o) state.missing = true; return o; }
  if (Array.isArray(v)) return v.map((x) => unpack(G, x, state));
  const o = {};
  for (const k in v) o[k] = unpack(G, v[k], state);
  return o;
}

export class Net {
  constructor(G) {
    this.G = G;
    this.role = null;      // null (single player) | 'host' | 'client'
    this.code = null;
    this.links = new Map(); // host: player id -> link
    this.avatars = new Map(); // player id -> RemotePlayer (friends, or on a client: the host and other friends)
    this.outbox = []; this.actQ = []; this.inbox = [];
    this.sendT = 0;
    this.status = '';
  }

  get active() { return !!this.role; }
  get playerCount() { return 1 + this.avatars.size; }

  // ================= HOST =================
  async host(name) {
    const G = this.G;
    if (this.role) return this.code;
    G.player.name = name || 'Captain';
    for (let tries = 0; tries < 4; tries++) {
      const code = makeCode();
      try {
        this.room = await openRoom(code, (link) => this.onLink(link));
        this.code = code; this.role = 'host';
        this.captureEvents();
        return code;
      } catch (e) { if (e.message !== 'taken') throw e; }
    }
    throw new Error('taken');
  }

  // Forward every game event to the friends (the host's own presentation still plays it)
  captureEvents() {
    const ev = this.G.events, emit = ev.emit.bind(ev);
    ev.emit = (type, data = {}) => {
      emit(type, data);
      if (this.links.size && !LOCAL_ONLY.has(type)) this.outbox.push([type, pack(data)]);
    };
  }

  onLink(link) {
    const G = this.G;
    let pl = null;
    link.onMessage = (m) => {
      if (m.t === 'hello') {
        if (pl) return;
        if (m.ver !== VERSION) { link.send({ t: 'bye', why: 'version', ver: VERSION }); setTimeout(() => link.close(), 500); return; }
        if (this.playerCount >= MAX_PLAYERS) { link.send({ t: 'bye', why: 'full' }); setTimeout(() => link.close(), 500); return; }
        let n = 1; while (this.avatars.has(`player:${n}`)) n++;
        const id = `player:${n}`;
        pl = new RemotePlayer(G, id, String(m.name || '').slice(0, 14) || `Mate ${n + 1}`);
        this.avatars.set(id, pl); this.links.set(id, link);
        G.players.push(pl);
        link.send({ t: 'welcome', id, ver: VERSION, code: this.code });
        this.sendSnapshot(); // they see the world straight away
        G.events.emit('friendJoined', { player: pl, name: pl.name, count: this.playerCount });
        return;
      }
      if (!pl) return;
      if (m.t === 'p') pl.setPose(m.pose);
      else if (m.t === 'a') for (const a of m.list) this.applyRemote(pl, a);
    };
    link.onClose = () => { if (pl) this.dropPlayer(pl); };
  }

  // A friend's action: back into world space, then the same rules as our own hands
  applyRemote(pl, a) {
    const G = this.G, st = {};
    const x = unpack(G, a, st);
    const ref = (x.ref && (x.ref === G.ship.id ? G.ship : G.enemies.ships.find((e) => e.id === x.ref))) || pl.ship;
    ref.root.updateMatrixWorld();
    for (const k of POINTS) if (x[k]?.isVector3) ref.root.localToWorld(x[k]);
    for (const k of DIRS) if (x[k]?.isVector3) x[k].applyQuaternion(ref.root.getWorldQuaternion(_q));
    delete x.ref;
    try { applyAction(G, { ...x, player: pl.id }); } catch (e) { console.warn('Action from', pl.id, 'failed', a, e); }
  }

  // A friend left (or lost their connection): let go of everything they had hold of
  dropPlayer(pl) {
    const G = this.G;
    if (!this.avatars.has(pl.id)) return;
    this.avatars.delete(pl.id); this.links.delete(pl.id);
    const i = G.players.indexOf(pl); if (i >= 0) G.players.splice(i, 1);
    for (const it of G.items) if (it.heldBy === pl.id) it.heldBy = null;
    for (const c of G.ship.cannons) if (c.manual === pl.id) c.manual = null;
    if (G.grapples.heldBy === pl.id) G.grapples.heldBy = null;
    if (G.ship.helmBy === pl.id) G.ship.helmBy = null;
    pl.dispose();
    G.events.emit('friendLeft', { name: pl.name, count: this.playerCount });
  }

  // Tell one friend's headset to do something to their own player (respawn, returnHome)
  command(id, c) { this.links.get(id)?.send({ t: 'cmd', c }); }

  sendSnapshot() {
    const G = this.G;
    const poses = [{ id: G.player.id, pose: localPose(G) }];
    for (const pl of this.avatars.values()) if (pl.pose) poses.push({ id: pl.id, pose: pl.pose });
    const msg = { t: 's', snap: G.snapshot(), poses };
    for (const link of this.links.values()) link.send(msg);
  }

  // ================= FRIEND =================
  async join(code, name) {
    const G = this.G;
    code = String(code || '').trim().toUpperCase();
    const link = await joinRoom(code);
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { link.close(); fail(new Error('timeout')); }, 10000);
      link.onMessage = (m) => {
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.becomeClient(link, code, m.id, name);
          ok(m.id);
        } else if (m.t === 'bye') { clearTimeout(timer); link.close(); fail(new Error(m.why === 'version' ? `version:${m.ver}` : m.why)); }
      };
      link.onClose = () => { clearTimeout(timer); fail(new Error('closed')); };
      link.send({ t: 'hello', name, ver: VERSION });
    });
  }

  becomeClient(link, code, id, name) {
    const G = this.G;
    this.role = 'client'; this.code = code; this.link = link;
    G.isHost = false;
    G.player.id = id; G.player.name = name;
    G.player.respawn(); // to our own spot on deck
    this.mirror = new Mirror(G);
    G.act = (a) => this.clientAct(a);
    link.onMessage = (m) => this.onHostMessage(m);
    link.onClose = () => this.hostLost();
  }

  onHostMessage(m) {
    const G = this.G;
    if (m.t === 's') {
      this.mirror.apply(m.snap);
      for (const { id, pose } of m.poses) if (id !== G.player.id) this.avatarFor(id).setPose(pose);
      this.flushInbox(true);
    } else if (m.t === 'e') { for (const e of m.ev) this.inbox.push({ e }); this.flushInbox(false); }
    else if (m.t === 'cmd') {
      if (m.c === 'respawn') G.player.respawn();
      else if (m.c === 'returnHome') G.player.returnHome();
    } else if (m.t === 'bye') this.hostLost(m.why);
  }

  // Play the host's events here. One that mentions something we haven't been told about yet
  // (a ship that just appeared) waits for the next snapshot.
  flushInbox(afterSnapshot) {
    const G = this.G, keep = [];
    for (const item of this.inbox) {
      if (!afterSnapshot && keep.length) { keep.push(item); continue; } // keep them in order
      const st = {}, data = unpack(G, item.e[1], st);
      if (st.missing && !afterSnapshot) { keep.push(item); continue; }
      try { G.events.emit(item.e[0], data); } catch (e) { console.warn('Event', item.e[0], e); }
    }
    this.inbox = keep;
  }

  avatarFor(id, name) {
    let pl = this.avatars.get(id);
    if (!pl) { pl = new RemotePlayer(this.G, id, name); this.avatars.set(id, pl); this.G.players.push(pl); }
    return pl;
  }
  removeAvatar(id) {
    const pl = this.avatars.get(id); if (!pl) return;
    this.avatars.delete(id);
    const i = this.G.players.indexOf(pl); if (i >= 0) this.G.players.splice(i, 1);
    for (const it of this.G.items) if (it.heldBy === id) it.heldBy = null;
    pl.dispose();
  }

  hostLost(why) {
    if (this.lost) return;
    this.lost = true;
    const G = this.G;
    G.hud.msg(why === 'closed' || !why ? 'Lost touch with the host’s ship' : 'The host ended the game', 4);
    G.hud.msg('Back to the harbour in a moment...', 4);
    G.events.emit('hostLost', {});
    setTimeout(() => {
      try { G.renderer.xr.getSession()?.end(); } catch (e) { /* not in VR */ }
      const u = new URL(location.href); u.searchParams.delete('join'); location.href = u.toString();
    }, 5000);
  }

  // A friend's G.act(): send it to the host, and guess the answer so hands and haptics
  // respond straight away. The host's snapshot corrects anything we guessed wrong.
  clientAct(a) {
    const G = this.G, P = G.player, S = G.ship, me = P.id;
    const hold = (o, s = 0.6) => { o._hold = G.t + s; };
    let r = true, send = true;
    switch (a.type) {
      case 'steer': { this.mirror.helmT = G.t; const b = S.wheelAngle; S.wheelAngle = clamp(b + a.delta, -WHEEL_MAX, WHEEL_MAX); r = S.wheelAngle - b; break; }
      case 'setSail': this.mirror.helmT = G.t; S.leverAngle = clamp(a.angle, -LEVER_MAX, LEVER_MAX); break;
      case 'lightCannon': {
        const c = G.byId(a.cannon);
        if (!c) r = 'busy'; else if (S.cannonReady(c)) { c.fuse = a.delay; hold(c); r = 'lit'; } else r = c.reload > 0 ? 'reloading' : 'busy';
        break;
      }
      case 'aimCannon': { const c = G.byId(a.cannon); if (c) { c.manual = me; hold(c, 0.4); c.tYaw = c.yaw = clamp(a.yaw, -0.45, 0.45); c.tElev = c.elevation = clamp(a.elev, -0.12, 0.42); } break; }
      case 'releaseCannon': { const c = G.byId(a.cannon); if (c && c.manual === me) { c.manual = null; hold(c, 0.4); } break; }
      case 'broadside': r = S.cannons.filter((c) => c.inArc && S.cannonReady(c)).length; break;
      case 'takeItem': { const it = G.byId(a.item); if (!it || (it.heldBy && it.heldBy !== me)) { r = false; send = false; } else { it.heldBy = me; hold(it, 1); } break; }
      case 'dropItem': { const it = G.byId(a.item); if (it && it.heldBy === me) { it.heldBy = null; hold(it, 0.6); } break; }
      case 'fireMusket': { const it = G.byId(a.item); if (!it || !it.loaded) r = false; else { it.loaded = false; it.kick = 1; hold(it, 1); } break; }
      case 'swordSweep': if (a.speed < 2.2) { r = false; send = false; } else r = false; break;
      case 'holdGrapple': G.grapples.heldBy = a.hold ? me : (G.grapples.heldBy === me ? null : G.grapples.heldBy); hold(G.grapples); break;
      case 'aimGrapple': if (a.dir) G.grapples.aimAlong(a.dir); else G.grapples.setAim(a.yaw, a.pitch); break;
      case 'fireGrapple': r = G.grapples.anyLineOut() ? 'cut' : G.grapples.hook ? 'busy' : 'fired'; break;
      case 'lightKeg': { const e = G.byId(a.ship); r = !!(e && e.keg && e.keg.fuse === -1 && P.ship === e); break; }
      case 'hammer': r = 'hit'; break;
      case 'fillBucket': { const it = G.byId(a.item); if (!it || it.full) { r = false; send = false; } else { it.full = true; hold(it); } break; }
      case 'pourBucket': { const it = G.byId(a.item); if (!it || !it.full) { r = false; send = false; } else { it.full = false; hold(it); } break; }
      case 'order': r = a.order || ORDERS[(ORDERS.indexOf(G.crew.order) + 1) % ORDERS.length]; break;
    }
    if (send) this.actQ.push(this.toShipSpace(a));
    return r;
  }

  // World-space positions in an action -> local to the ship we stand on (see POINTS)
  toShipSpace(a) {
    const G = this.G, ref = G.player.ship, out = { ...a, ref: ref.id };
    ref.root.updateMatrixWorld();
    for (const k of POINTS) if (a[k]?.isVector3) out[k] = ref.root.worldToLocal(a[k].clone());
    ref.root.getWorldQuaternion(_q).invert();
    for (const k of DIRS) if (a[k]?.isVector3) out[k] = a[k].clone().applyQuaternion(_q);
    delete out.player;
    return pack(out);
  }

  // ================= Every frame =================
  update(dt) {
    if (!this.role) return;
    const G = this.G;
    for (const pl of this.avatars.values()) pl.update(dt);
    // A friend let go of an item: it floats back to the rack
    for (const it of G.items) {
      if (it.lastHeldBy && it.lastHeldBy !== G.player.id && it.heldBy !== it.lastHeldBy && !it.holder && G.player.deskItem !== it) {
        G.ship.root.attach(it.obj); it.returning = true;
      }
      it.lastHeldBy = it.heldBy;
    }
    this.sendT -= dt;
    const tick = this.sendT <= 0;
    if (tick) this.sendT = SEND_EVERY;
    if (this.role === 'host') {
      if (this.outbox.length) { const msg = { t: 'e', ev: this.outbox }; this.outbox = []; for (const l of this.links.values()) l.send(msg); }
      if (tick && this.links.size) this.sendSnapshot();
    } else {
      if (this.lost) return;
      this.mirror.step(dt);
      if (this.actQ.length) { this.link.send({ t: 'a', list: this.actQ }); this.actQ = []; }
      if (tick) this.link.send({ t: 'p', pose: localPose(G) });
    }
  }

  leave() {
    if (this.role === 'host') { for (const l of this.links.values()) { l.send({ t: 'bye', why: 'ended' }); } this.room?.close(); }
    else if (this.link) this.link.close();
  }
}
