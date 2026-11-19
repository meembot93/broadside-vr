import * as THREE from 'three';
import { canvasTex, damp } from './util.js';
import { VERSION } from './version.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Hud {
  constructor(G) {
    this.G = G;
    // Captain's board next to the wheel
    this.boardTex = canvasTex(512, 340, () => {});
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.61), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.set(-1.25, 1.5, 5.45); board.rotation.y = 0.45;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.69, 0.04), new THREE.MeshLambertMaterial({ color: 0x3a2616 }));
    frame.position.z = -0.025; board.add(frame);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), new THREE.MeshLambertMaterial({ color: 0x3a2616 }));
    post.position.set(0, -0.9, -0.05); board.add(post);
    G.ship.root.add(board);
    this.boardT = 0;

    // Floating message that drifts in front of your view
    this.msgTex = canvasTex(1024, 192, () => {});
    this.msgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28),
      new THREE.MeshBasicMaterial({ map: this.msgTex, transparent: true, depthTest: false, depthWrite: false }));
    this.msgMesh.renderOrder = 998; this.msgMesh.visible = false;
    G.ship.root.add(this.msgMesh);
    this.queue = []; this.cur = null; this.curT = 0; this.placed = false;
    this.dom = document.getElementById('dhud');

    // Health bars locked to your view, top left: one row per player on board (yours first)
    this.vitalsTex = canvasTex(512, 256, () => {});
    this.vitals = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16),
      new THREE.MeshBasicMaterial({ map: this.vitalsTex, transparent: true, depthTest: false, depthWrite: false }));
    this.vitals.renderOrder = 997; G.camera.add(this.vitals);
    this.vitalsKey = '';

    // A hull bar floating over each enemy ship
    this.enemyBars = new Map(); // ship -> { sprite, tex, shown }
  }

  // Your health (and, in co-op, your friends') pinned to the top left of your view
  drawVitals() {
    const G = this.G, list = [G.player, ...G.players.filter((p) => p !== G.player)].slice(0, 4);
    const key = list.map((p) => `${p.id}:${Math.ceil(p.health)}:${p.dead}`).join('|');
    if (key === this.vitalsKey) return;
    this.vitalsKey = key;
    const g = this.vitalsTex.userData.ctx;
    g.clearRect(0, 0, 512, 256);
    list.forEach((p, i) => {
      const y = i * 62 + 4, v = Math.max(0, Math.min(1, p.health / 100));
      g.fillStyle = 'rgba(20,12,6,0.6)'; g.beginPath(); g.roundRect(0, y, 512, 56, 14); g.fill();
      g.fillStyle = '#f6e7c1'; g.font = 'bold 30px Georgia, serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(p === G.player ? 'You' : `Mate ${i}`, 14, y + 29);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(120, y + 12, 300, 32);
      g.fillStyle = p.dead ? '#555' : v > 0.35 ? '#c0392b' : '#ff5a2a'; g.fillRect(120, y + 12, 300 * v, 32);
      g.strokeStyle = '#c9a75b'; g.lineWidth = 3; g.strokeRect(120, y + 12, 300, 32);
      g.fillStyle = '#f6e7c1'; g.font = 'bold 28px Georgia, serif'; g.textAlign = 'right';
      g.fillText(p.dead ? 'down' : String(Math.ceil(p.health)), 500, y + 29);
    });
    this.vitalsTex.needsUpdate = true;
  }

  placeVitals() {
    const G = this.G, m = this.vitals, d = 0.8;
    if (G.mode !== 'vr') {
      // Flat screen: tuck it into the actual top-left corner of the window
      const hh = d * Math.tan((G.camera.fov * Math.PI) / 360), hw = hh * G.camera.aspect;
      m.position.set(-hw + 0.17, hh - 0.08, -d);
    } else m.position.set(-0.3, 0.2, -d); // VR: up and left of centre, easy to glance at
  }

  enemyBar(e) {
    let b = this.enemyBars.get(e);
    if (!b) {
      const tex = canvasTex(256, 40, () => {});
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.position.set(0, 17.2, -1); sprite.renderOrder = 5;
      e.root.add(sprite);
      b = { sprite, tex, shown: -1 };
      this.enemyBars.set(e, b);
    }
    return b;
  }

  updateEnemyBars() {
    const G = this.G;
    for (const [e, b] of this.enemyBars) if (!G.enemies.ships.includes(e)) { b.sprite.removeFromParent(); b.tex.dispose(); b.sprite.material.dispose(); this.enemyBars.delete(e); }
    G.camera.getWorldPosition(_a);
    for (const e of G.enemies.ships) {
      const b = this.enemyBar(e);
      b.sprite.visible = e.alive;
      if (!e.alive) continue;
      const v = Math.max(0, Math.min(1, e.health / e.maxHealth));
      if (Math.abs(v - b.shown) > 0.004) {
        b.shown = v;
        const g = b.tex.userData.ctx;
        g.clearRect(0, 0, 256, 40);
        g.fillStyle = 'rgba(20,12,6,0.75)'; g.fillRect(0, 0, 256, 40);
        g.fillStyle = v > 0.35 ? '#c0392b' : '#ff7a2a'; g.fillRect(6, 6, 244 * v, 28);
        g.strokeStyle = '#e8c77a'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 36);
        b.tex.needsUpdate = true;
      }
      // Grow with distance so it stays readable far away
      const w = Math.max(6, e.root.position.distanceTo(_a) * 0.075);
      b.sprite.scale.set(w, w * 40 / 256, 1);
    }
  }

  msg(text, dur = 3.5) {
    if (this.cur && this.cur.text === text) { this.curT = Math.max(this.curT, dur * 0.6); return; }
    if (this.queue.some((q) => q.text === text)) return;
    this.queue.push({ text, dur });
  }

  drawMsg(text) {
    const g = this.msgTex.userData.ctx, w = 1024, h = 192;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,12,6,0.72)';
    g.beginPath(); g.roundRect(30, 30, w - 60, h - 60, 30); g.fill();
    g.strokeStyle = '#c9a75b'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#f6e7c1'; g.font = 'bold 62px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3, w - 100);
    this.msgTex.needsUpdate = true;
  }

  drawBoard() {
    const G = this.G, S = G.ship, g = this.boardTex.userData.ctx, w = 512, h = 340;
    g.fillStyle = '#e8d6a8'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,80,30,0.15)'; for (let i = 0; i < 30; i++) g.fillRect(0, i * 12, w, 1);
    g.fillStyle = '#3a2210'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = 'bold 34px Georgia, serif'; g.fillText("Captain's Board", 20, 44);
    g.font = '18px Georgia, serif'; g.textAlign = 'right'; g.fillText(`v${VERSION}`, w - 16, 40); g.textAlign = 'left';
    g.font = '24px Georgia, serif';
    const bar = (y, label, v, col) => {
      g.fillStyle = '#3a2210'; g.fillText(label, 20, y + 20);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(170, y, 300, 24);
      g.fillStyle = col; g.fillRect(170, y, 300 * Math.max(0, Math.min(1, v)), 24);
      g.strokeStyle = '#3a2210'; g.lineWidth = 2; g.strokeRect(170, y, 300, 24);
    };
    bar(70, 'Hull', S.health / S.maxHealth, S.health / S.maxHealth > 0.35 ? '#4d7a2a' : '#a02a1a');
    bar(108, 'You', G.player.health / 100, '#a33a2a');
    bar(146, 'Sails', S.sail, '#d8c690');
    // Rudder indicator
    g.fillStyle = '#3a2210'; g.fillText('Rudder', 20, 204);
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(170, 186, 300, 24); g.strokeRect(170, 186, 300, 24);
    g.fillStyle = '#3a2210'; g.fillRect(318, 182, 4, 32);
    g.fillStyle = '#8a3a10'; g.fillRect(316 + S.rudder * 146, 184, 8, 28);
    g.fillStyle = '#3a2210';
    g.fillText(`Ships sunk: ${G.score}`, 20, 250);
    g.fillText(`Speed: ${(S.speed * 1.94).toFixed(1)} kn`, 270, 250);
    // Nearest enemy
    let best = null, bd = 1e9;
    for (const e of G.enemies.ships) if (e.alive) { const d = e.pos.distanceTo(S.pos); if (d < bd) { bd = d; best = e; } }
    if (best) {
      _a.copy(best.pos).sub(S.pos);
      const rel = Math.atan2(_a.x, _a.z) - Math.atan2(-Math.sin(S.heading), -Math.cos(S.heading));
      const r = ((rel % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI; // -pi..pi, positive = to port
      const deg = (r * 180) / Math.PI;
      const where = Math.abs(deg) < 25 ? 'dead ahead' : Math.abs(deg) > 155 ? 'astern' : deg > 0 ? 'to port' : 'to starboard';
      g.fillStyle = '#7a1a10'; g.fillText(`Enemy ${Math.round(bd)} m ${where}`, 20, 296);
      g.font = '20px Georgia, serif'; g.fillStyle = '#3a2210';
      g.fillText(`(their hull ${Math.round((best.health / best.maxHealth) * 100)}%)`, 20, 322);
    } else { g.fillText('Horizon is clear', 20, 296); }
    this.boardTex.needsUpdate = true;
  }

  update(dt) {
    const G = this.G;
    this.boardT -= dt;
    if (this.boardT <= 0) { this.boardT = 0.25; this.drawBoard(); this.updateDom(); }
    this.drawVitals(); this.placeVitals(); this.vitals.visible = !!G.mode;
    this.updateEnemyBars();

    if (!this.cur && this.queue.length) { this.cur = this.queue.shift(); this.curT = this.cur.dur; this.drawMsg(this.cur.text); this.placed = false; }
    if (this.cur) {
      this.curT -= dt;
      if (this.curT <= 0) { this.cur = null; this.msgMesh.visible = false; return; }
      // Target spot: 1.6 m ahead of the eyes, a bit low, in ship space
      const cam = G.camera;
      cam.getWorldPosition(_a); cam.getWorldDirection(_b);
      const tgt = _a.clone().addScaledVector(_b, 1.6);
      tgt.y -= 0.25;
      G.ship.root.worldToLocal(tgt);
      const eye = G.ship.root.worldToLocal(_a.clone());
      const m = this.msgMesh;
      if (!this.placed) { m.position.copy(tgt); this.placed = true; }
      else { m.position.x = damp(m.position.x, tgt.x, 3, dt); m.position.y = damp(m.position.y, tgt.y, 3, dt); m.position.z = damp(m.position.z, tgt.z, 3, dt); }
      m.lookAt(G.ship.root.localToWorld(eye.clone()));
      m.visible = true;
      m.material.opacity = Math.min(1, this.curT * 3);
    }
  }

  updateDom() {
    const G = this.G;
    if (G.mode !== 'desktop') return;
    const held = G.player.deskItem ? G.player.deskItem.kind : 'empty hands';
    this.dom.innerHTML = `Health ${Math.round(G.player.health)} &nbsp;|&nbsp; Hull ${Math.round(G.ship.health)} &nbsp;|&nbsp; Sunk ${G.score} &nbsp;|&nbsp; Holding: ${held}`;
  }
}
