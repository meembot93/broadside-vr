import * as THREE from 'three';
import { canvasTex, damp } from './util.js';

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
