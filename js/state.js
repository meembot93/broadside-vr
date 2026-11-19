// A plain-data picture of everything that matters in the game right now.
// In multiplayer the host will send this (or the parts that changed) to every friend's
// headset about 15-20 times a second, and they will draw the world from it. Today it is only
// used by tests and the ?debug console (type G.snapshot() to see it).
// Rule of thumb: if it changes the outcome of the game, it belongs in here; if it is only
// how something looks (smoke, sail ripples, sounds), it does not.
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];

function shipState(s) {
  return {
    id: s.id, alive: s.alive, health: r2(s.health),
    pos: [r2(s.pos.x), r2(s.pos.z)], heading: r3(s.heading), speed: r2(s.speed),
    sail: r3(s.sail), rudder: r3(s.rudder), wheel: r3(s.wheelAngle), lever: r3(s.leverAngle ?? 0), sinkT: r2(s.sinkT),
    cannons: s.cannons.map((c) => ({ id: c.id, reload: r2(c.reload), fuse: r2(c.fuse), elev: r3(c.tElev), yaw: r3(c.tYaw) })),
    crew: s.crew.map((m) => ({ id: m.id, role: m.role, dead: m.p.dead, pos: v3(m.p.g.position), pose: m.p.pose })),
    ai: s.ai ? { mode: s.ai.mode } : undefined,
    abandoned: !!s.abandoned, captured: !!s.captured, keg: s.keg ? r2(s.keg.fuse) : null, helmBy: s.helmBy,
  };
}

export function snapshot(G) {
  return {
    t: r3(G.t), state: G.state, score: G.score,
    ships: [G.ship, ...G.enemies.ships].map(shipState),
    players: G.players.map((p) => ({ id: p.id, ship: p.ship.id, head: v3(p.headLocal), health: r2(p.health), dead: p.dead })),
    grapple: {
      aim: [r3(G.grapples.aimYaw), r3(G.grapples.aimPitch)], heldBy: G.grapples.heldBy,
      hook: G.grapples.hook ? { pos: v3(G.grapples.hook.pos), vel: v3(G.grapples.hook.vel) } : null,
      locks: G.grapples.locks.map((l) => ({ ship: l.e.id, by: l.by, phase: l.phase, side: l.side, zOff: r2(l.zOff), hook: v3(l.hookLocal) })),
    },
    items: G.items.map((it) => ({ id: it.id, kind: it.kind, heldBy: it.heldBy, loaded: it.loaded })),
    order: G.crew.order,
    crew: G.crew.members.map((m) => ({ id: m.id, role: m.role, on: m.away ? m.away.ship.id : G.ship.id, away: m.away?.state ?? null, pos: v3(m.p.g.position), attack: r2(m.p.attack), pose: m.p.pose, sword: m.p.sword.visible })),
    boarders: G.enemies.boarders.map((b) => ({ id: b.id, state: b.state, hp: b.hp, pos: v3(b.p.g.position), attack: r2(b.p.attack) })),
    balls: G.combat.active.map((b) => ({ id: b.id, owner: b.owner.id, pos: v3(b.pos), vel: v3(b.vel) })),
  };
}
