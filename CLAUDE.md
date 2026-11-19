# Notes for Claude

- Broadside VR: WebXR pirate game, three.js in `lib/`, plain ES modules, no build step. See README.md.
- **Every PR merged to main must bump `VERSION` in `js/version.js` by 1 and replace `CHANGES`
  with 2-4 short words-only items on what changed (newest first).** The title screen and the
  Captain's Board show it, and Meem uses it to check the headset has the newest build.
  If two PRs race, the later one takes the next number after main's.
- Pirates and weapons are built with `js/kit.js` (merged, flat-shaded meshes); `tools/lineup.html` previews all pirate types.
