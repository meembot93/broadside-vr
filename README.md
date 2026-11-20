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

After each voyage won there's a **treasure hunt** (`js/island.js`): a gold light marks treasure
on Treasure Island, a big jungle island (terrain and trail in `js/land.js`, jungle and ruins in
`js/isle.js`, skeletons in `js/foes.js`). Sail close (or walk away from the wheel and Hawkins sails there) and the ship drops
anchor. A rope ladder goes over the side facing the island with the longboat tied below it
(`js/rowboat.js`). Climb down (VR: GRIP the rungs and pull, or TRIGGER on the ladder; desktop:
click it; if your hands are empty a cutlass goes on your belt, and once you're sitting in the
boat you reach up above your head to grab the ladder again), then sit tight: the boatman casts off and rows you and Mags and Rosa to the beach and back, or take over and row yourself (VR: GRIP the oars and pull them toward you,
or push the left stick; desktop: W, A, D) and walk off the bow. With nobody in her, a boatman
brings the boat to whoever is waiting at the ladder or on the beach. Your map is on your left
wrist (top right on desktop), and weapons you let go of hang on your belt. From the beach a
winding trail climbs through the jungle past a pirate camp, an ambush with musket snipers, a
graveyard where skeletons rise, and a rolling-boulder trap, to the temple ruins on the summit.
Fight past the guards to the X, the crew digs up a chest, open it and take one prize: bronze cannons
(+35% damage), drilled gun crews (25% faster reload) or an iron-banded hull (+50 hull). Prizes
stack and last the whole run. Row back, climb the ladder, and the next voyage begins.
Works with friends: anyone can go ashore, whoever grabs a card first picks for the crew.
`?treasure` starts straight on a treasure hunt.

## Play with friends

Up to 4 players on one ship. One presses **Host a game** on the title screen and reads out the
4-letter room code; friends type it next to **Join**. Then everyone presses Enter VR. Voice chat is
built in (B/Y or M: mic on/off). Free and
peer-to-peer (WebRTC via PeerJS). Details and troubleshooting: [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md).

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
- Pirate voice lines are Meem's own recordings in `sounds/voice/` (swap one in with
  `tools/voices/import_recording.py`). Generated lines are switched off (`useGenerated` in lines.json); they were made offline with the free Kokoro TTS
  by `tools/voices/make_voices.py` from `tools/voices/lines.json` (edit lines there, then re-run it).
  `js/voicelines.js` decides when they're said; `tools/voices.html` plays every line.
- Needs an https address to run in VR.

## Code layout (multiplayer-ready)

- Player input never changes the game directly: it calls `G.act({ type, ... })` (`js/actions.js`).
- Game rules emit events (`G.events`); `js/presentation.js` turns them into effects, sound,
  haptics and messages.
- Ships, cannons, items, boarders and cannonballs have stable ids; `G.snapshot()` returns the whole
  game state as plain data.
- Multiplayer lives in `js/net/` (see [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md)): the host runs these rules, friends mirror its snapshots.


## Version number (please keep it up to date)

`js/version.js` holds the version shown at the top of the title screen and on the
Captain's Board, plus a few words on the latest changes. **Every change merged to main must
bump `VERSION` by 1 and update `CHANGES`**, so Meem can tell whether the headset has the
newest build.
