// Voice chat between the players (multiplayer). Each pair of headsets gets its own WebRTC
// audio call through the same PeerJS connection the game uses (transport.js), so it's free
// and peer-to-peer, with PeerJS's TURN relays as the fallback on strict networks.
// Who calls whom: the friend with the higher seat number calls each lower one (the host is
// seat 0 and never has to call anyone), so every pair connects exactly once.
//
// Each voice comes out of that friend's pirate head (WebAudio HRTF panner), so you hear them
// from where they stand. You can mute your own mic (B/Y in VR, M on desktop), mute a friend
// (B/Y with a hand on their head), and set each friend's volume on the title screen.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const PREFS_KEY = 'broadside.voice';

export class Voice {
  constructor(G, net) {
    this.G = G; this.net = net;
    this.stream = null;   // our microphone
    this.denied = false;  // the browser (or the player) said no to the mic
    this.muted = false;   // our own mic switched off
    this.calls = new Map(); // player id -> { call, el, nodes, level }
    this.prefs = {};       // name -> { vol: 0..2, muted }   (by name, so it's remembered next time)
    try { this.prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { /* private mode */ }
    this.syncT = 0;
    this.onChange = null; // the title-screen panel redraws itself
  }

  get on() { return !!this.peer; }

  // Ask for the microphone. Call from a click (Host / Join) so the permission prompt shows
  // before VR starts. Without a mic you still hear everyone.
  async mic() {
    if (this.stream || this.denied) return !!this.stream;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.setMuted(this.muted);
      // Calls already up were started with silence: give them the real mic
      for (const c of this.calls.values()) this.sendMic(c);
    } catch (e) { this.denied = true; console.warn('No microphone', e); }
    this.onChange?.();
    return !!this.stream;
  }

  // What we send: the mic, or silence if there's no mic (a call needs something to send)
  outStream() {
    if (this.stream) return this.stream;
    if (!this.silence) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.silenceCtx = new AC(); this.silence = this.silenceCtx.createMediaStreamDestination().stream;
    }
    return this.silence;
  }
  sendMic(c) {
    const track = this.stream?.getAudioTracks()[0];
    const sender = c.call.peerConnection?.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (track && sender) sender.replaceTrack(track).catch(() => {});
  }

  // The PeerJS peer this headset uses for the game. Answers friends' calls from now on.
  attach(peer) {
    if (!peer || this.peer) return;
    this.peer = peer;
    peer.on('call', (call) => {
      const id = call.metadata?.player;
      if (!id || this.calls.has(id)) { call.close(); return; }
      call.answer(this.outStream());
      this.track(id, call);
    });
  }

  // Every so often: call any friend we should be talking to and aren't, hang up on leavers
  sync() {
    const G = this.G, me = G.player, mySeat = seat(me.id);
    const here = new Set();
    for (const pl of G.players) {
      if (pl === me) continue;
      here.add(pl.id);
      if (this.calls.has(pl.id) || !pl.peer || seat(pl.id) >= mySeat) continue;
      const call = this.peer.call(pl.peer, this.outStream(), { metadata: { player: me.id } });
      if (call) this.track(pl.id, call);
    }
    for (const id of [...this.calls.keys()]) if (!here.has(id)) this.drop(id);
  }

  track(id, call) {
    const c = { call, el: null, nodes: null, stream: null, level: 0 };
    this.calls.set(id, c);
    call.on('stream', (s) => {
      if (c.stream) return;
      c.stream = s;
      // Chrome only feeds a WebRTC voice into WebAudio while it is also attached to a media element
      const el = c.el = new Audio(); el.srcObject = s; el.muted = true; el.play().catch(() => {});
    });
    const gone = () => { if (this.calls.get(id) === c) this.drop(id); };
    call.on('close', gone); call.on('error', gone);
    this.onChange?.();
  }

  drop(id) {
    const c = this.calls.get(id); if (!c) return;
    this.calls.delete(id);
    try { c.call.close(); } catch (e) { /* gone */ }
    if (c.nodes) for (const n of Object.values(c.nodes)) try { n.disconnect(); } catch (e) { /* gone */ }
    if (c.el) { c.el.srcObject = null; }
    this.onChange?.();
  }

  // WebAudio for one friend's voice: source -> level meter -> volume -> 3D panner -> speakers
  hookUp(c) {
    const ctx = this.G.audio.ctx;
    const src = ctx.createMediaStreamSource(c.stream);
    const meter = ctx.createAnalyser(); meter.fftSize = 512;
    const gain = ctx.createGain();
    const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = 2; pan.rolloffFactor = 0.7; pan.maxDistance = 200;
    src.connect(meter); meter.connect(gain); gain.connect(pan); pan.connect(ctx.destination);
    c.nodes = { src, meter, gain, pan }; c.buf = new Float32Array(meter.fftSize);
  }

  // ---- Settings ----
  setMuted(m) {
    this.muted = m;
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !m;
    this.onChange?.();
  }
  pref(name) { return this.prefs[name] || { vol: 1, muted: false }; }
  setPref(name, p) {
    this.prefs[name] = { ...this.pref(name), ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch (e) { /* private mode */ }
    this.onChange?.();
  }

  // ---- Every frame ----
  update(dt) {
    if (!this.peer) return;
    const G = this.G;
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 1; this.sync(); }
    const ctx = G.audio.ctx; if (!ctx) return; // sound starts when you press Enter VR / Play
    for (const [id, c] of this.calls) {
      if (c.stream && !c.nodes) this.hookUp(c);
      if (!c.nodes) continue;
      const pl = this.net.avatars.get(id);
      const pr = this.pref(pl?.name);
      c.nodes.gain.gain.setTargetAtTime(pl && !pr.muted ? pr.vol * 1.6 : 0, ctx.currentTime, 0.05);
      if (pl) {
        pl.p.head.getWorldPosition(_v);
        const P = c.nodes.pan, now = ctx.currentTime;
        if (P.positionX) { P.positionX.setTargetAtTime(_v.x, now, 0.03); P.positionY.setTargetAtTime(_v.y, now, 0.03); P.positionZ.setTargetAtTime(_v.z, now, 0.03); }
        else P.setPosition(_v.x, _v.y, _v.z);
        // Talking? (their name tag lights up)
        c.nodes.meter.getFloatTimeDomainData(c.buf);
        let e = 0; for (let i = 0; i < c.buf.length; i += 4) e += c.buf[i] * c.buf[i];
        c.level = Math.max(Math.sqrt(e / (c.buf.length / 4)), c.level * Math.exp(-dt * 6));
        pl.talking = c.level > 0.02 && !pr.muted;
        pl.voiceMuted = pr.muted;
      }
    }
  }

  stop() {
    for (const id of [...this.calls.keys()]) this.drop(id);
    for (const t of this.stream?.getTracks() || []) t.stop();
  }
}

const seat = (id) => parseInt(String(id).split(':')[1]) || 0;
