# Broadside VR

A VR pirate ship game for Meta Quest, played in the Quest Browser (WebXR + three.js r170).

## Play

Open the GitHub Pages link in the Quest Browser and press **Enter VR**.
Add `?debug` to the address to make enemies spawn quickly and close by.

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
- All sounds are synthesized with WebAudio and all models are built from basic shapes in code,
  so there are no asset files.
- Needs an https address to run in VR.

## Code layout (multiplayer-ready)

- Player input never changes the game directly: it calls `G.act({ type, ... })` (`js/actions.js`).
- Game rules emit events (`G.events`); `js/presentation.js` turns them into effects, sound,
  haptics and messages.
- Ships, cannons, items, boarders and cannonballs have stable ids; `G.snapshot()` returns the whole
  game state as plain data.
- See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for the plan to add friends.

