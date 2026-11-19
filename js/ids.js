// Stable ids for everything that will need to be talked about over the network.
// Ids are handed out in order by whoever runs the game (the host), so the same entity
// has the same id on every player's headset: 'ship:0' is always our own ship,
// 'ship:3' the third enemy, 'boarder:7', 'ball:42', and so on.
export class Ids {
  constructor() { this.counters = {}; }
  next(kind) {
    const n = this.counters[kind] ?? 0;
    this.counters[kind] = n + 1;
    return `${kind}:${n}`;
  }
}
