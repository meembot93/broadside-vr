// How game events look, sound and feel on THIS headset.
// The game rules (combat.js, enemies.js, actions.js, main.js) emit events; this file is the
// only place that turns them into effects, sounds, controller rumble and on-screen messages.
// In multiplayer every headset runs this file, fed by the events the host sends out.
import * as THREE from 'three';

const _a = new THREE.Vector3();
const A_KIND = { sloop: 'A sloop', brigantine: 'A brigantine', galleon: 'A galleon' };
// ['sloop', 'sloop', 'brigantine'] -> 'two sloops and a brigantine'
function listKinds(kinds) {
  const n = {}; for (const k of kinds) n[k] = (n[k] || 0) + 1;
  const words = ['', 'a', 'two', 'three', 'four'];
  const parts = Object.entries(n).map(([k, c]) => `${words[c] || c} ${k}${c > 1 ? 's' : ''}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}

export function wirePresentation(G) {
  const on = (type, fn) => G.events.on(type, fn);
  const fx = G.fx, audio = G.audio, hud = G.hud;
  const me = G.player;
  const isMe = (pl) => pl === G.player;
  // How-to tips: only the first time each session
  const tipped = new Set();
  const tip = (k, fn) => { if (!tipped.has(k)) { tipped.add(k); fn(); } };

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
    if (kind === 'boarder' || kind === 'foe') audio.thud(pos);
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
  on('enemySpawned', ({ kind, boss, count }) => {
    if (boss) return; // bossArrived says it
    hud.msg(count > 1 ? `Another sail! ${A_KIND[kind] || 'A ship'} joins the fight` : `${A_KIND[kind] || 'An enemy ship'} on the horizon!`, 3.5); audio.bell();
  });
  on('enemySunk', ({ score }) => {
    hud.msg(score === 1 ? 'Enemy ship sunk! Huzzah!' : `Another one down! ${score} sunk`, 3.5);
    G.crew.cheer(); audio.cheer();
  });
  on('boarderSpawned', ({ ship, first }) => {
    audio.swoosh(ship.root.position);
    if (first) hud.msg('Boarders! Grab the sword or a musket!', 4);
    
  });
  on('boarderSwing', ({ pos }) => audio.swoosh(pos));
  on('enemyCrewKilled', ({ role, left, cause, boss }) => {
    if (left === 0 || cause === 'surrender' || boss) return;
    if (role === 'helm') hud.msg('Their helmsman is down! She’s steering wild', 3);
    else if (left <= 2) hud.msg(`Only ${left} of their crew left standing`, 2.5);
  });
  on('enemyHelmTaken', () => hud.msg('Another of theirs is running for the wheel', 2.5));
  on('enemyAbandoned', ({ ship }) => {
    if (ship.boss) return; // bossDefeated says it
    hud.msg('Their whole crew is down! She’s drifting', 4); G.crew.cheer(); audio.cheer(); });

  // ---- Voyages and bosses (voyages.js) ----
  on('voyageStarted', ({ voyage, name, waves, boss }) => {
    hud.msg(`Voyage ${voyage}: ${name}`, 4.5);
    hud.msg(`${waves} fights, and then ${boss}`, 4);
  });
  on('waveStarted', ({ wave, waves, boss }) => { if (!boss) hud.msg(`Fight ${wave} of ${waves}`, 2.5); });
  on('bossArrived', ({ name }) => {
    audio.bell(); setTimeout(() => audio.bell(), 600);
    hud.msg(`${name}’s galleon is coming for you!`, 4.5);
    hud.msg(`Sink her, or board her and duel ${name} at the wheel`, 5);
  });
  on('bossWounded', ({ name, hp, cause }) => {
    if (cause !== 'sword') hud.msg(hp <= 2 ? `${name} is badly hurt!` : `${name} shrugs off the shot!`, 2);
  });
  on('bossCaptainKilled', ({ name, cause }) => {
    hud.msg(cause === 'sword' ? `You cut down ${name}!` : `${name} falls!`, 4);
    hud.msg('Their crew throws down their arms and leaps overboard', 4);
  });
  on('crewOverboard', ({ pos }) => { fx.splash(pos, 0.7); audio.splash(pos, 0.6); });
  on('bossDefeated', ({ name, how }) => {
    if (how === 'sunk') hud.msg(`${name}’s galleon goes to the bottom!`, 4);
    else if (how === 'crew') hud.msg(`${name}’s crew is finished!`, 4);
    G.crew.cheer(); audio.cheer();
  });
  on('waveCleared', ({ next, nextIsBoss }) => {
    if (!next) return;
    hud.msg('The sea is ours, for now', 3);
    if (nextIsBoss) hud.msg(`Make ready: ${G.voyages.bossName} is near`, 4);
    else hud.msg(`More sails coming: ${listKinds(next)}`, 4);
  });
  on('voyageWon', ({ voyage, name }) => {
    hud.msg('VOYAGE WON!', 5);
    hud.msg(`${name} is done. Huzzah!`, 4);
    hud.msg('Look for a gold light: there’s treasure on the island!', 4.5);
    G.crew.cheer(); audio.cheer(); audio.bell(); setTimeout(() => audio.bell(), 500); setTimeout(() => audio.bell(), 1000);
    // Rockets over our ship, and the crew keeps cheering
    const colours = [0xffd060, 0xff5040, 0x60c0ff, 0xffffff, 0x80ff80];
    for (let i = 0; i < 9; i++) setTimeout(() => {
      const p = new THREE.Vector3((Math.random() - 0.5) * 40, 28 + Math.random() * 14, (Math.random() - 0.5) * 40).add(G.ship.pos);
      fx.firework(p, colours[i % colours.length]); audio.cannon(p);
      if (i % 3 === 2) { G.crew.cheer(); audio.cheer(); }
    }, 600 + i * 650);
  });
  on('shipRefitted', () => hud.msg('Ship refitted: hull patched, crew rested', 3.5));

  // ---- Treasure hunts (island.js) ----
  on('treasureMarked', () => {
    hud.msg('Treasure! Sail for the gold light', 4.5);
    hud.msg('Walk away from the wheel and Hawkins takes us there', 4.5);
  });
  on('anchorDropped', ({ pos }) => {
    audio.splash(pos, 0.8); audio.bell();
    hud.msg('Anchored! Climb down the rope ladder to the boat', 4);
    tip('weaponFirst', () => hud.msg('Take a weapon from the rack first', 3));
  });
  on('wentAshore', ({ player, first, pos }) => {
    if (isMe(player)) {
      audio.splash(pos, 0.4);
      tip('map', () => hud.msg(desk() ? 'Your map is top right: find the X' : 'Your map is on your left wrist: find the X', 4));
      if (!desk()) tip('belt', () => hud.msg('Let go of a weapon and it hangs on your belt', 3.5));
    }
  });
  on('boardedBoat', ({ player, from }) => {
    if (!isMe(player)) return;
    if (from === 'ship') tip('row', () => hud.msg(desk() ? 'W to row, A and D to steer' : 'GRIP the oars and pull them toward you, or push the left stick', 4.5));
  });
  on('boatBeached', ({ pos }) => {
    audio.thud(pos);
    if (G.player.ship === G.island?.boat.frame) hud.msg('Ashore! Walk off the front of the boat', 3);
  });
  on('boatMoored', () => {
    if (G.player.ship === G.island?.boat.frame) hud.msg(desk() ? 'Alongside! Click the ladder to climb up' : 'Alongside! GRIP the ladder and pull yourself up', 3.5);
  });
  const meAshore = () => G.island?.ashore(me);
  on('guardsAlerted', ({ pos, first, big }) => {
    audio.cheer(); audio.swoosh(pos);
    if (first && meAshore()) hud.msg(big ? 'The treasure’s guards! Cut them down!' : 'Guards! Fight your way through!', 3);
  });
  on('guardKilled', ({ left }) => { if (meAshore() && !left) hud.msg('That’s the last of them!', 2.5); });
  on('treasureGuarded', () => meAshore() && hud.msg('Guards still watch the X. Clear them first!', 3));
  on('digStarted', ({ pos }) => { if (meAshore()) hud.msg('Dig, lads, dig!', 2.5); audio.thud(pos); });
  on('chestUnearthed', ({ pos }) => {
    fx.debris(pos, 14); audio.woodHit(pos); G.crew.cheer(); audio.cheer();
    if (meAshore()) hud.msg(desk() ? 'A chest! Look at it and click to open it' : 'A chest! GRIP the lid to open it', 3.5);
  });
  on('chestOpened', ({ pos }) => {
    for (let i = 0; i < 4; i++) setTimeout(() => fx.firework(pos.clone().add(new THREE.Vector3(0, 1.2 + i * 0.3, 0)), 0xffd060, 18), i * 250);
    audio.bell(); audio.cheer();
    if (meAshore()) hud.msg(desk() ? 'Pick ONE prize: look at a card and click' : 'Pick ONE prize: GRIP a card', 3.5);
  });
  on('upgradeChosen', ({ name, level, player }) => {
    G.crew.cheer(); audio.cheer(); audio.bell();
    hud.msg(`Prize: ${name}${level > 1 ? ` (x${level})` : ''}!`, 3.5);
    if (meAshore()) hud.msg('Back to the boat and row out to the ship', 4);
  });
  on('treasureDone', () => { hud.msg('Weigh anchor! On to the next voyage', 3.5); audio.bell(); });

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
    if (why === 'theyCut') hud.msg('They’ve cut their lines and are pulling away', 3);
  });
  on('playerCrossed', ({ player, home }) => { if (isMe(player) && !home) tip('theirDeck', () => hud.msg('You’re on their deck! Cut them down', 2.5)); });
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

  on('prizeScuttled', () => hud.msg('The prize is cut loose and scuttled', 3));

  // ---- Our helm and crew ----
  const ORDER_SAY = { hold: 'Holding this course', chase: 'Engaging the enemy', alongside: 'Bringing us alongside', heave: 'Heaving to, sails furled' };
  // (at most every 30 s each: with friends walking about, the wheel changes hands a lot)
  const every = {}, now = () => performance.now() / 1000;
  const sometimes = (k, secs, fn) => { if (!(every[k] > now())) { every[k] = now() + secs; fn(); } };
  on('helmTaken', ({ name, order }) => sometimes('helmTaken', 30, () => hud.msg(`${name} has the wheel: ${ORDER_SAY[order]}`, 3)));
  on('helmHandedBack', ({ name }) => sometimes('helmBack', 30, () => hud.msg(`${name}: She’s yours, Captain`, 2)));
  on('helmOrder', ({ order, helmsmanSteering, name }) => {
    hud.msg(`Order: ${ORDER_SAY[order]}!`, 2.5);
    if (!helmsmanSteering) hud.msg(`${name} will do it when you leave the wheel`, 3);
  });
  on('deckCleared', () => hud.msg('Deck cleared!', 1.5));

  // ---- Damage and repairs (damage.js) ----
  const desk = () => G.mode === 'desktop';
  const told = {};
  const once = (k, fn) => { if (!told[k]) { told[k] = true; fn(); } };
  on('leakSprung', ({ pos, count }) => {
    fx.splash(pos, 0.25);
    once('leak', () => {
      hud.msg('We’re holed! Water’s pouring in', 3);
      hud.msg(desk() ? 'Press 4 for the hammer, look at the leak and click' : 'Grab the hammer by the water tub and bang the leak shut', 4.5);
    });
    if (count >= 3 && told.leak) once('leaks3', () => hud.msg('Three leaks! She’s getting sluggish', 3));
  });
  on('leakHammered', ({ pos }) => { audio.knock(pos); fx.hit(pos); });
  on('leakPatched', ({ pos, left, player }) => {
    audio.knock(pos); fx.debris(pos, 5);
    if (player && !left) hud.msg('Leak patched!', 1.5);
  });
  on('fireStarted', ({ pos }) => {
    fx.flash(pos, 1.2); audio.fuse(pos);
    once('fire', () => {
      hud.msg('FIRE on deck!', 2.5);
      hud.msg(desk() ? 'Press 5 for the bucket, fill it at the tub, click at the fire' : 'Fill the bucket at the water tub and tip it over the flames', 4.5);
    });
  });
  on('fireSpread', () => hud.msg('The fire’s spreading!', 2.5));
  on('fireShrunk', ({ pos }) => { audio.hiss(pos); fx.smoke(pos, _a.set(0, 1, 0), 6, 0.5); });
  on('fireDoused', ({ pos, left }) => { audio.hiss(pos); fx.smoke(pos, _a.set(0, 1, 0), 10, 0.6); if (!left) hud.msg('Fire’s out!', 1.5); });
  on('bucketFilled', ({ pos }) => { if (pos) { audio.splash(pos, 0.3); fx.splash(pos, 0.12); } });
  on('bucketPoured', ({ from, to, fires }) => {
    if (from) {
      audio.splash(from, 0.6);
      for (let i = 0; i < 16; i++) {
        _a.copy(to).sub(from); const k = 0.6 + Math.random() * 0.6;
        fx.emit(from, { vel: _a.set(_a.x * 1.6 * k + (Math.random() - 0.5), 2 + Math.random() * 1.5, _a.z * 1.6 * k + (Math.random() - 0.5)), life: 0.7, s0: 0.12, s1: 0.3, color: 0xdcefff, grav: 9, alpha: 0.85 });
      }
    }
    if (to) setTimeout(() => fx.splash(to, 0.3), 350);
    if (!fires && G.damage.fires.length) hud.msg('Missed! Get closer to the flames', 1.8);
  });
  on('mastSnapped', ({ pos, name }) => {
    audio.crack(pos); fx.debris(pos, 20);
    for (const h of me.hands) me.haptic(h, 0.8, 200);
    hud.msg(`The ${name} is snapped! We’ve lost speed`, 3.5);
    once('mast', () => hud.msg(desk() ? 'Press 4 for the hammer and click at the foot of the mast' : 'Take the hammer and bang a splint onto the break, 6 blows', 4.5));
  });
  on('mastHammered', ({ pos }) => { audio.knock(pos); fx.hit(pos); });
  on('mastRepaired', ({ pos, name, player }) => {
    audio.knock(pos); audio.creak(pos);
    hud.msg(player ? `The ${name} is splinted and standing!` : `The crew splinted the ${name}`, 3);
    if (player) { G.crew.cheer(); audio.cheer(); }
  });


  // ---- Players ----
  on('playerHurt', ({ player }) => {
    if (!isMe(player)) return;
    player.hurtFlash = 1;
    audio.hurt();
    for (const h of player.hands) player.haptic(h, 0.9, 140);
  });
  on('playerDied', ({ player }) => {
    if (isMe(player)) hud.msg(G.players.length > 1 ? 'You were cut down! Back up in a few seconds' : 'You were cut down!', 3);
    else if (player) hud.msg(`${player.name || 'A mate'} is down!`, 2.5);
  });
  on('playerRevived', ({ player }) => {
    if (isMe(player)) hud.msg('The crew dragged you back to the helm', 3);

  });

  // ---- Friends (net/net.js) ----
  on('friendJoined', ({ player, name }) => {
    if (isMe(player)) { hud.msg('Welcome aboard!', 3); return; }
    hud.msg(`${name} came aboard!`, 3.5); audio.bell();
  });
  on('friendLeft', ({ name }) => hud.msg(`${name} left the ship`, 3));

  // ---- Our ship ----
  on('ranAground', () => hud.msg('Ran aground! Steer back to open water', 2.5));
  on('shipSinking', () => hud.msg('We’re going down! Abandon ship!', 5));
  on('gameReset', () => hud.msg('A fresh ship and a fresh crew. Good luck, Captain.', 4));
}
