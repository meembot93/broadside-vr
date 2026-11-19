// How game events look, sound and feel on THIS headset.
// The game rules (combat.js, enemies.js, actions.js, main.js) emit events; this file is the
// only place that turns them into effects, sounds, controller rumble and on-screen messages.
// In multiplayer every headset runs this file, fed by the events the host sends out.
import * as THREE from 'three';

const _a = new THREE.Vector3();

export function wirePresentation(G) {
  const on = (type, fn) => G.events.on(type, fn);
  const fx = G.fx, audio = G.audio, hud = G.hud;
  const me = G.player;
  const isMe = (pl) => pl === G.player;

  // ---- Cannons ----
  on('fuseLit', ({ pos }) => audio.fuse(pos));
  on('cannonFired', ({ ship, pos, dir }) => {
    fx.flash(pos, 2.6); fx.smoke(pos, dir, 14, 1.1);
    audio.cannon(pos);
    if (ship === G.ship) for (const h of me.hands) if (h.gp) { h.grip.getWorldPosition(_a); if (_a.distanceTo(pos) < 4) me.haptic(h, 0.8, 120); }
  });
  on('shipHit', ({ ship, pos }) => {
    fx.debris(pos, 14); fx.flash(pos, 1.2); audio.woodHit(pos);
    if (ship === G.ship) {
      for (const h of me.hands) me.haptic(h, 0.5, 80);
      if (Math.random() < 0.3) hud.msg('We’re taking hits!', 2);
    }
  });
  on('ballSplash', ({ pos }) => { fx.splash(pos, 1); if (pos.distanceTo(G.ship.pos) < 250) audio.splash(pos, 0.8); });

  // ---- Muskets ----
  on('musketEmpty', ({ pos }) => audio.click(pos));
  on('musketReloaded', ({ item }) => {
    if (item.holder || me.deskItem === item) { item.obj.getWorldPosition(_a); audio.click(_a); }
  });
  on('musketHit', ({ kind, pos }) => {
    if (kind === 'boarder') { audio.thud(pos); hud.msg('Got him!', 1.2); }
    else if (kind === 'enemyCrew') { audio.thud(pos); hud.msg('Sharpshooter! One of theirs is down', 1.8); }
    else if (kind === 'hull') { fx.debris(pos, 8); audio.woodHit(pos); }
    else if (kind === 'water') fx.splash(pos, 0.3);
  });
  on('musketShot', ({ from, dir, to, hit }) => {
    if (hit) fx.hit(to);
    fx.flash(from, 0.6); fx.smoke(from, dir, 5, 0.35);
    fx.shot(from, to);
    audio.musket(from);
  });

  // ---- Swords ----
  on('bladeContact', ({ pos }) => fx.hit(pos));
  on('parried', ({ pos }) => audio.clang(pos));
  on('boarderStruck', ({ pos }) => audio.thud(pos));

  // ---- Enemies ----
  on('enemySpawned', ({ count }) => { hud.msg(count > 1 ? 'Another sail on the horizon!' : 'Enemy ship sighted!', 3.5); audio.bell(); });
  on('enemySunk', ({ score }) => {
    hud.msg(score === 1 ? 'Enemy ship sunk! Huzzah!' : `Another one down! ${score} sunk`, 3.5);
    G.crew.cheer(); audio.cheer();
  });
  on('boarderSpawned', ({ ship, first }) => {
    audio.swoosh(ship.root.position);
    if (first) hud.msg('Boarders! Grab the sword or a musket!', 4);
    else hud.msg('More boarders!', 2);
  });
  on('boarderSwing', ({ pos }) => audio.swoosh(pos));
  on('enemyCrewKilled', ({ role, left }) => {
    if (left === 0) return;
    if (role === 'helm') hud.msg('Their helmsman is down! She’s steering wild', 3);
    else if (left <= 2) hud.msg(`Only ${left} of their crew left standing`, 2.5);
  });
  on('enemyHelmTaken', () => hud.msg('Another of theirs is running for the wheel', 2.5));
  on('enemyAbandoned', () => { hud.msg('Their whole crew is down! She’s drifting', 4); G.crew.cheer(); audio.cheer(); });

  // ---- Grapples and boarding ----
  on('grappleFired', ({ pos }) => { fx.flash(pos, 0.8); fx.smoke(pos, G.grapples.gunDir(_a), 4, 0.3); audio.musket(pos); audio.swoosh(pos); });
  on('grappleMissed', ({ pos, far }) => { if (pos.y < 0.5) fx.splash(pos, 0.4); hud.msg(far ? 'Out of reach! Get within 40 m' : 'Missed! Reloading the hook', 2); });
  on('grappleHooked', ({ pos }) => { audio.woodHit(pos); audio.thud(pos); hud.msg('Hooked her! Hauling her alongside', 3); });
  on('enemyGrappled', ({ ship }) => { audio.swoosh(ship.root.position); hud.msg('They’ve thrown grapples! Stand by to repel boarders', 3.5); });
  on('shipsLashed', ({ by }) => {
    audio.woodHit(G.ship.root.position);
    hud.msg(by === 'us' ? 'Lashed alongside! Climb over the rail to board' : 'They’re alongside! You can board them too', 3.5);
  });
  on('grappleReleased', ({ why }) => {
    if (why === 'cut') hud.msg('Lines cut', 2);
    else if (why === 'theyCut') hud.msg('They’ve cut their lines and are pulling away', 3);
  });
  on('playerCrossed', ({ player, home }) => { if (isMe(player)) hud.msg(home ? 'Back aboard our ship' : 'You’re on their deck! Cut them down', 2.5); });
  on('strandedAboard', ({ player }) => { if (isMe(player)) hud.msg('She’s going down! You scramble back aboard', 3); });
  on('prizeTaken', ({ score }) => {
    hud.msg('She’s ours! Prize taken', 3.5); hud.msg('Plundered timber patches our hull', 3);
    hud.msg('Light the powder keg by her mast to blow her up', 4.5);
    G.crew.cheer(); audio.cheer(); audio.bell();
  });
  on('kegLit', ({ pos }) => { audio.fuse(pos); hud.msg('Fuse lit! Get back to our ship!', 4); });
  on('kegExploded', ({ pos }) => {
    fx.flash(pos, 7); fx.debris(pos, 40); fx.smoke(pos, _a.set(0, 1, 0), 30, 2.5); fx.splash(pos, 3);
    audio.cannon(pos); setTimeout(() => audio.cannon(pos), 120); audio.woodHit(pos);
    for (const h of me.hands) me.haptic(h, 1, 300);
    hud.msg('KABOOM! She’s going to the bottom', 3.5);
    G.crew.cheer(); setTimeout(() => audio.cheer(), 700);
  });
  on('crewBoards', ({ name }) => hud.msg(`${name} is boarding with you!`, 1.5));
  on('prizeScuttled', () => hud.msg('The prize is cut loose and scuttled', 3));

  // ---- Our helm and crew ----
  const ORDER_SAY = { hold: 'Holding this course', chase: 'Engaging the enemy', alongside: 'Bringing us alongside', heave: 'Heaving to, sails furled' };
  on('helmTaken', ({ name, order }) => hud.msg(`${name} has the wheel: ${ORDER_SAY[order]}`, 3.5));
  on('helmHandedBack', ({ name }) => hud.msg(`${name}: She’s yours, Captain`, 2.5));
  on('helmOrder', ({ order, helmsmanSteering, name }) => {
    hud.msg(`Order: ${ORDER_SAY[order]}!`, 2.5);
    if (!helmsmanSteering) hud.msg(`${name} will do it when you leave the wheel`, 3);
  });
  on('deckCleared', () => hud.msg('Deck cleared!', 2));

  // ---- Players ----
  on('playerHurt', ({ player }) => {
    if (!isMe(player)) return;
    player.hurtFlash = 1;
    audio.hurt();
    for (const h of player.hands) player.haptic(h, 0.9, 140);
  });
  on('playerDied', ({ player }) => { if (isMe(player)) hud.msg('You were cut down!', 3); });
  on('playerRevived', ({ player }) => { if (isMe(player)) hud.msg('The crew dragged you back to the helm', 3); });

  // ---- Our ship ----
  on('ranAground', () => hud.msg('Ran aground! Steer back to open water', 2.5));
  on('shipSinking', () => hud.msg('We’re going down! Abandon ship!', 5));
  on('gameReset', () => hud.msg('A fresh ship and a fresh crew. Good luck, Captain.', 4));
}
