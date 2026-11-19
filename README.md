# Broadside VR

A VR pirate ship game for Meta Quest, played in the Quest Browser (WebXR + three.js r170).

## Play

Open the GitHub Pages link in the Quest Browser and press **Enter VR**.
Add `?debug` to the address to make enemies spawn quickly and close by.

The game is played in **voyages** (`js/voyages.js`): a few fights against sloops and
brigantines, then a boss galleon under a named captain. Sink her, or board her and duel the
captain at the wheel (killing him makes his crew jump overboard). Win and the ship is refitted
and a harder voyage begins; lose the ship and the voyage starts over. For testing,
`?voyage=2` starts on voyage 2 and `?wave=3` jumps to the boss fight.

## Controls

**Quest:** left stick walk, right stick snap turn (45°), grip = grab, trigger = fire.
Grab the wheel to steer, push the sail lever forward for more sail, put an empty hand at a
cannon's back end and pull the trigger to fire it. Muskets and a cutlass hang on the rack
on the port (left) side of the helm. Anything you can use glows when your hand is near it.
Your crew only fires a cannon now and then, so the fighting is up to you.

**Desktop test mode:** WASD + mouse, Q/E wheel, R/F sails, 1/2/3 weapons, Space = broadside.

## Tech

- Plain ES modules, no build step. `index.html` loads `js/main.js`.
- three.js r170 is vendored in `lib/` (no CDN).
- Sound effects are synthesized with WebAudio and all models are built from basic shapes in code.
- Pirate voice lines are small Opus clips in `sounds/voice/`, made offline with the free Kokoro TTS
  by `tools/voices/make_voices.py` from `tools/voices/lines.json` (edit lines there, then re-run it).
  `js/voicelines.js` decides when they're said; `tools/voices.html` plays every line.
- Needs an https address to run in VR.

## Code layout (multiplayer-ready)

- Player input never changes the game directly: it calls `G.act({ type, ... })` (`js/actions.js`).
- Game rules emit events (`G.events`); `js/presentation.js` turns them into effects, sound,
  haptics and messages.
- Ships, cannons, items, boarders and cannonballs have stable ids; `G.snapshot()` returns the whole
  game state as plain data.
- See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for the plan to add friends.


## Version number (please keep it up to date)

`js/version.js` holds the version shown at the top of the title screen and on the
Captain's Board, plus a few words on the latest changes. **Every change merged to main must
bump `VERSION` by 1 and update `CHANGES`**, so Meem can tell whether the headset has the
newest build.
