// A tiny event bus that separates "what happened in the game" from "how it looks and sounds".
// Game rules emit events (a cannon fired, a ship was hit). presentation.js listens and plays
// effects, sounds, haptics and messages. In multiplayer the host will also send these events
// to the other players, so every headset sees and hears the same things.
export class Events {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  // Runs listeners right away (not later), so effects happen in the same order as before.
  emit(type, data = {}) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(data);
  }
}
