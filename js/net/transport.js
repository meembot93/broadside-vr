// How headsets find each other and pass messages. Nothing here knows about the game.
//
// Normal play: WebRTC through PeerJS (lib/peerjs.min.js, loaded only when you host or join).
// The free public PeerJS server only introduces the headsets; after that the game data flows
// straight between them. PeerJS also brings free TURN relays for networks that block direct
// connections. The host's room is the PeerJS id 'broadside-vr-' + the room code.
//
// Testing: ?net=local uses a BroadcastChannel instead, so two tabs of the same browser can
// play together with no network at all. ?peerhost=localhost:9000 points PeerJS at your own
// PeerJS server (npx peer --port 9000) instead of the public one.
//
// A "link" is one connection between the host and one friend:
//   link.send(msg)  msg is plain JSON-able data
//   link.onMessage = (msg) => {}     link.onClose = () => {}     link.close()
const PREFIX = 'broadside-vr-';
const params = new URLSearchParams(location.search);
const LOCAL = params.get('net') === 'local';
const TIMEOUT = 15; // seconds without hearing anything before a link counts as lost

let peerLoad = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!peerLoad) peerLoad = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = './lib/peerjs.min.js'; s.onload = ok; s.onerror = () => { peerLoad = null; fail(new Error('Could not load the connection code')); };
    document.head.appendChild(s);
  });
  return peerLoad;
}

function peerOptions() {
  const ph = params.get('peerhost');
  if (!ph) return { debug: 1 };
  const [host, port] = ph.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost', debug: 1 };
}

// Wrap a message pipe in a link with a "still there?" watchdog.
function makeLink(sendRaw, closeRaw) {
  const link = { onMessage: null, onClose: null, closed: false, heard: performance.now() };
  link.send = (msg) => { if (!link.closed) { try { sendRaw(msg); } catch (e) { link.lost(); } } };
  link.receive = (msg) => { link.heard = performance.now(); if (!link.closed && link.onMessage) link.onMessage(msg); };
  link.lost = () => { if (link.closed) return; link.closed = true; clearInterval(link.watch); try { closeRaw(); } catch (e) { /* already gone */ } link.onClose?.(); };
  link.close = link.lost;
  link.watch = setInterval(() => { if (performance.now() - link.heard > TIMEOUT * 1000) link.lost(); }, 1000);
  return link;
}

// ---------- Host ----------
// Opens room `code`. onLink(link) is called for every friend who connects.
// Resolves once the room is open; rejects with Error('taken') if the code is already in use.
export async function openRoom(code, onLink) {
  if (LOCAL) return openLocalRoom(code, onLink);
  await loadPeer();
  return new Promise((ok, fail) => {
    const peer = new window.Peer(PREFIX + code, peerOptions());
    let open = false;
    peer.on('open', () => { open = true; ok({ close: () => peer.destroy() }); });
    peer.on('error', (e) => {
      if (!open) { peer.destroy(); fail(new Error(e.type === 'unavailable-id' ? 'taken' : e.type === 'network' || e.type === 'server-error' ? 'network' : (e.type || 'error'))); }
      else console.warn('PeerJS', e.type, e);
    });
    // Lost touch with the matchmaking server: rooms already joined keep working, new friends can't find us
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 2000); });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const link = makeLink((m) => conn.send(m), () => conn.close());
        conn.on('data', (m) => link.receive(m));
        conn.on('close', () => link.lost());
        conn.on('error', () => link.lost());
        onLink(link);
      });
    });
  });
}

// ---------- Friend ----------
// Connects to room `code`. Resolves with the link to the host; rejects with Error('noroom'),
// Error('network') or Error('timeout').
export async function joinRoom(code) {
  if (LOCAL) return joinLocalRoom(code);
  await loadPeer();
  return new Promise((ok, fail) => {
    const peer = new window.Peer(peerOptions());
    let done = false;
    const give = (err, link) => { if (done) return; done = true; clearTimeout(timer); if (err) { peer.destroy(); fail(err); } else ok(link); };
    const timer = setTimeout(() => give(new Error('timeout')), 20000);
    peer.on('error', (e) => give(new Error(e.type === 'peer-unavailable' ? 'noroom' : e.type === 'network' || e.type === 'server-error' ? 'network' : (e.type || 'error'))));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        const link = makeLink((m) => conn.send(m), () => { conn.close(); peer.destroy(); });
        conn.on('data', (m) => link.receive(m));
        conn.on('close', () => link.lost());
        conn.on('error', () => link.lost());
        give(null, link);
      });
    });
  });
}

// ---------- Two tabs on one computer (?net=local) ----------
function openLocalRoom(code, onLink) {
  const ch = new BroadcastChannel('broadside-' + code), links = new Map();
  ch.onmessage = ({ data: d }) => {
    if (d.to !== 'host') return;
    if (d.k === 'join') {
      if (links.has(d.from)) return;
      const link = makeLink((m) => ch.postMessage({ k: 'm', to: d.from, m }), () => ch.postMessage({ k: 'bye', to: d.from }));
      links.set(d.from, link);
      ch.postMessage({ k: 'ok', to: d.from });
      onLink(link);
      // onLink sets the real onClose: keep the cleanup in front of it
      const set = link.onClose; link.onClose = () => { links.delete(d.from); set?.(); };
    } else if (d.k === 'm') links.get(d.from)?.receive(d.m);
    else if (d.k === 'bye') links.get(d.from)?.lost();
  };
  return Promise.resolve({ close: () => { for (const l of links.values()) l.lost(); ch.close(); } });
}

function joinLocalRoom(code) {
  const ch = new BroadcastChannel('broadside-' + code), me = 'tab' + Math.random().toString(36).slice(2, 8);
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { ch.close(); fail(new Error('noroom')); }, 3000);
    let link = null;
    ch.onmessage = ({ data: d }) => {
      if (d.to !== me) return;
      if (d.k === 'ok' && !link) {
        clearTimeout(timer);
        link = makeLink((m) => ch.postMessage({ k: 'm', to: 'host', from: me, m }), () => { ch.postMessage({ k: 'bye', to: 'host', from: me }); ch.close(); });
        ok(link);
      } else if (d.k === 'm') link?.receive(d.m);
      else if (d.k === 'bye') link?.lost();
    };
    ch.postMessage({ k: 'join', to: 'host', from: me });
  });
}
