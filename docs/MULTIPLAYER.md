# Multiplayer plan: up to 4 friends on one ship

The game is still single player. This doc covers what is already in place so friends can be
added later as an extra step, not a rewrite, and the plan for that step.

## What is already in place

| Piece | Where | What it is for later |
|---|---|---|
| **Action layer** | `js/actions.js`, `G.act()` | Everything a player does with their hands (steer, set sail, light a cannon, broadside, take or drop a weapon, fire a musket, swing a sword) is a small plain object passed to `G.act()`. A friend's headset will send these same objects to the host, and the host applies them with the same function. |
| **Event bus** | `js/events.js`, `js/presentation.js` | Game rules never play sounds or effects directly. They emit events (`cannonFired`, `shipHit`, `boarderSpawned`, `playerHurt`, and so on) and `presentation.js` turns them into smoke, sound, rumble and messages. The host will forward these events so every headset sees and hears the same things. |
| **Stable ids** | `js/ids.js` | Everything that needs talking about over the network has an id handed out in order by the host: `ship:0` (ours), `ship:1/cannon:2`, `item:0`, `boarder:7`, `ball:42`, `crew:1`, `player:0`. `G.byId(id)` finds anything by id. |
| **Players list** | `G.players`, `G.player` | The local player is `player:0`. Boarders chase the nearest living player, sword knockback uses whoever swung it, and health regen and musket reloads tick for everyone (`stepPlayers`). A remote friend just needs to be an object with `id`, `headLocal`, `health`, `dead`, `lastHurt`, `respawn()`. |
| **Rules vs. view split** | `Ship.step/float/animate`, `simulate()` in `main.js` | Ship physics (`step`) is separate from bobbing on the waves (`float`, computed from shared wave math, so every headset gets the same result) and from sails, flag and cannon visuals (`animate`). Cannonballs keep their own `pos`/`vel` state separate from the mesh. |
| **Snapshot** | `js/state.js`, `G.snapshot()` | A plain-data picture of everything that affects the outcome (ships, cannons, players, items, crew, boarders, cannonballs, score). About 1.6 KB as JSON in a typical fight. This is what the host will send to friends. |
| **Host flag** | `G.isHost` | Always `true` today. Clients will skip the rules part of `simulate()`. |

A deterministic replay test (seeded randomness, fixed frame time, scripted inputs, 5 minutes of
fighting with 4 sinkings, boarders and a player death) produced identical results before and
after this restructure.

## Recommended model: one headset is the host

* **Host** (whoever creates the game): runs the full game exactly as it does today. Every
  random roll, hit and enemy decision happens only here, so there is never any disagreement.
* **Friends** (clients): send two things to the host:
  1. their head and hand positions, about 20-30 times a second (in ship-local space, so the
     rocking ship doesn't matter), and
  2. actions from `G.act()` when they do something.
* **Host sends back** about 15-20 times a second: a snapshot (or just what changed since the
  last one) plus the events since the last message. Friends draw the world from the snapshot,
  smoothing (interpolating) ship and enemy positions between updates, and play the events
  through `presentation.js`.
* **Feels instant:** each player's own hands, head, held weapon, and the wheel/lever they are
  holding move locally right away; the host's answer only corrects them if needed.

Why not a game server running the simulation? It costs money to run 24/7 and adds a second
codebase. Because the rules are now separate from the drawing, moving the host into a server
later (Node.js running the same `js/` rules without rendering) stays possible if it is ever
needed.

## How the headsets find each other (and what it costs)

| Option | How | Cost | Notes |
|---|---|---|---|
| **A. Peer-to-peer (recommended first)** | WebRTC data channels between headsets. A free "matchmaking" broker (e.g. PeerJS's public server) only introduces them; the game data then flows directly. Join with a short room code. | Free | Nothing to set up or host; works from GitHub Pages. Some home or work networks block direct connections; those need a TURN relay (several providers have free tiers for small use). |
| **B. Small relay server** | A WebSocket "room" on Cloudflare Durable Objects / PartyKit, or a tiny server on Fly.io. The host still runs the game; the server only forwards messages. | Roughly $0-5/month at friends-and-family scale | More reliable through firewalls. Needs an account Meem creates once; Claude writes and deploys the code. |

Prices are rough figures from early 2026 and should be re-checked when we get
there. Plan: build on A, and switch the transport to B only if someone can't connect. The game
code doesn't care which one carries the messages.

## Voice chat

1. **Day one, zero work:** use a Meta Quest party or a Discord call alongside the game.
2. **Later, in game:** WebRTC audio between the headsets (the Quest Browser allows mic access
   after a permission prompt). Each voice gets attached to that friend's avatar head through a
   WebAudio panner, so you hear them from where they stand on deck. With 4 players that's 3
   incoming audio streams per headset, which is fine for the Quest.

## Steps to add friends

1. **Lobby:** "Host a game" / "Join with code" buttons on the start screen; connect via option A.
2. **See each other:** send head and hand poses, draw friends as simple pirates (reusing
   `people.js`) with hands. No shared game yet: proves the connection and comfort.
3. **Shared game:** friends' `G.act()` sends to the host; host broadcasts snapshots + events;
   clients set `G.isHost = false`, skip the rules in `simulate()`, and apply snapshots.
   This is the biggest step.
4. **Sharing things:** two hands on the wheel from different players, who holds which musket
   (`heldBy` already exists), one cannon lit by two people at once.
5. **Per-player death and respawn:** today a death is a game-wide state (`G.state = 'dead'`);
   it needs to become per player (one friend down doesn't pause the others).
6. **Balance:** more enemy ships and boarders with more players; more weapons on the rack.
7. **Voice chat** in game (see above).
8. **Host leaves:** for a first version the game just ends for everyone; host migration can
   come later if it matters.

## Single-player assumptions still left (to change in the steps above)

* `G.state` death/respawn flow is for the whole game (step 5).
* Positions inside actions (musket ray, sword blade) are in world space; convert to ship-local
  before sending.
* Boarders, crew and enemy deck crew keep their position on their 3D model
  (`p.g.position`); fine for the host, clients will set it from snapshots.
* The fuse sparks and a few visual timers still run inside the rules loop; they only depend on
  state that is in the snapshot.
* HUD messages, the Captain's Board and haptics are for the local player only (on purpose).

## Testing multiplayer later

Open two desktop browser tabs (`?debug`), host in one and join from the other. The replay test
approach used for this restructure (seeded `Math.random`, fixed `dt`, call `G.simulate()`
directly) also works for checking that a client fed only snapshots ends up matching the host.
