// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between title, play, paused
// and over screens, with Mara's phone calls between missions.
//
// ?seed=N fixes the city. ?shot=cover|street|night|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { makeRng } from './random.js';
import { createGame, MISSIONS } from './world.js';
import { createRenderer3D } from './engine3d.js';
import { createFrameComposer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import {
  ACTION_CAMERA, ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE,
  ACTION_PHONE, ACTION_PUNCH, ACTION_RADIO, ACTION_SHOOT, createInput,
} from './input.js';
import { missionObjectiveText } from './missions.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261117;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = createGame(seed);
// Exposed for debugging and for the finalist review to inspect state.
window.__game = game;
const renderer = createRenderer3D(canvas);
const composer = createFrameComposer(renderer);
const hud = createHud(game.city);
const audio = createAudio();
const input = createInput(canvas);
input.bindTouch();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best haul lasts this visit only.
  }
}

/** Drain the step's events into sounds, toasts and screen changes. */
function handleEvents(screen, setScreen) {
  for (const event of game.events.splice(0)) {
    switch (event.type) {
      case 'shoot': audio.shoot(); break;
      case 'punch': audio.punch(); break;
      case 'crash': audio.crash(); break;
      case 'hit': audio.crash(); break;
      case 'pickup': audio.pickup(); hud.toast(event.text); break;
      case 'steal': audio.phone(); hud.toast(event.text); break;
      case 'ped-down': hud.toast(event.text); break;
      case 'cop-down': hud.toast(event.text); audio.crash(); break;
      case 'cop-car-down': hud.toast(event.text); audio.crash(); break;
      case 'car-wrecked': hud.toast(event.text, 4); audio.crash(); break;
      case 'click-empty': hud.toast(event.text); break;
      case 'wanted-up': hud.toast(`Wanted level ${event.wanted} — lose the cops!`); break;
      case 'wanted-down': hud.toast(`Heat dying down — wanted level ${event.wanted}`); break;
      case 'mission-start':
        hud.toast(`${event.title}: ${event.objective}`, 5);
        break;
      case 'mission-done':
        audio.missionDone();
        hud.toast(`${event.title} complete! +$${event.reward}`, 5);
        if (game.totalEarned > readBest()) saveBest(game.totalEarned);
        break;
      case 'mission-fail':
        audio.missionFail();
        hud.toast(`${event.title} failed — ${event.reason}`, 5);
        break;
      case 'story-done':
        hud.toast(event.text, 6);
        break;
      case 'phone':
        audio.phone();
        hud.showPhone(event.caller, MISSIONS[game.missions.index].call);
        break;
      case 'wasted':
        audio.busted();
        setScreen('over', { title: 'WASTED', text: 'Dario woke up at the safehouse, lighter in the pocket of his pride.' });
        break;
      case 'busted':
        audio.busted();
        setScreen('over', { title: 'BUSTED', text: 'The Verde PD took Dario in. Mara bailed him out — again.' });
        break;
      default: break;
    }
  }
  return screen;
}

function hudState() {
  return {
    money: game.money,
    health: game.player.health,
    armor: game.player.armor,
    ammo: game.player.ammo,
    wanted: game.wanted,
    speed: game.playerCar ? game.playerCar.speed : 0,
    driving: !!game.playerCar,
    timeOfDay: game.timeOfDay,
    objective: game.mission ? missionObjectiveText(game.mission) : 'Free roam — press Q when Mara calls',
    missionTitle: game.mission ? game.mission.def.title : '',
    player: game.player,
    cars: game.cars,
    cops: [...game.cops.cars, ...game.cops.foot],
    marker: game.marker,
  };
}

function runShot(name) {
  const scene = stageShot(name, game);
  hud.hideScreens();
  hud.update(hudState(), 0);
  // Let the chase camera settle fully behind the player before painting:
  // two frames of smoothing would leave it stranded near the spawn point.
  for (let i = 0; i < 60; i += 1) composer.updateCamera(game, 1 / 60);
  let painted = 0;
  function paint() {
    composer.updateCamera(game, 1 / 60);
    composer.drawFrame(game, game.elapsed);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
  void scene;
}

function runGame() {
  let screen = 'title';
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  const progress = game.missions.index > 0
    ? `${game.missions.index} of ${MISSIONS.length} jobs done — Mara has more work`
    : 'A new face in Palma Verde. Mara Solis is hiring.';
  hud.showScreen('title', { best, progress });
  input.bindTouch();

  function announce(message) {
    status.textContent = message;
  }

  function setScreen(next, data) {
    screen = next;
    if (next === 'title') hud.showScreen('title', { best, progress });
    else if (next === 'over') hud.showScreen('over', data);
    else if (next === 'pause') hud.showScreen('pause');
    else hud.hideScreens();
  }

  function startGame() {
    accumulator = 0;
    audio.unlock();
    setScreen('play');
    announce('Playing. Steal a car, watch the wanted stars.');
    if (game.missions.callPending) hud.showPhone(game.missions.callPending.caller, game.missions.callPending.call);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && (screen === 'title' || screen === 'over')) {
      audio.click();
      startGame();
      return; // do not also punch on the very frame the game starts
    }
    if (actions & ACTION_PAUSE && screen === 'play') {
      setScreen('pause');
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === 'pause') {
      setScreen('play');
      announce('Playing.');
    }
    if (screen !== 'play') return;
    if (actions & ACTION_ENTER) {
      if (game.playerCar) game.exitCar();
      else if (!game.tryEnterCar()) hud.toast('No car close enough — walk up to one and press E');
      audio.click();
    }
    if (actions & ACTION_PUNCH) game.punch();
    if (actions & ACTION_SHOOT) game.shoot();
    if (actions & ACTION_CAMERA) {
      game.cameraMode = (game.cameraMode + 1) % 3;
      audio.click();
    }
    if (actions & ACTION_RADIO) {
      const on = audio.toggleMusic();
      hud.toast(on ? 'Radio on' : 'Radio off');
    }
    if (actions & ACTION_PHONE && game.missions.callPending) {
      const call = game.missions.callPending;
      game.missions.callPending = null;
      hud.hidePhone();
      game.startMissionAt(game.missions.index);
      announce(`Mission: ${call.call}`);
    }
  }

  function step() {
    const axis = input.axis();
    game.step(STEP, axis);
    screen = handleEvents(screen, setScreen);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // One real frame delta, measured before `last` moves: the camera
    // smoothing below and the step accumulator share it, so a slow frame
    // moves the camera the same distance the world advanced.
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += frameDt;
    last = now;
    handleActions();
    if (screen === 'play') {
      while (accumulator >= STEP && screen === 'play') {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
      // The title screen idles the city behind the panel.
      if (screen === 'title') {
        const idle = { forward: 0, steer: 0, run: false };
        game.step(STEP, idle);
        game.events.length = 0;
      }
    }
    audio.setEngine(game.playerCar ? game.playerCar.speed : 0, !!game.playerCar);
    audio.setSiren(game.wanted, game.elapsed);
    composer.updateCamera(game, frameDt);
    composer.drawFrame(game, game.elapsed);
    hud.update(hudState(), STEP);
  }

  // Leaving the tab pauses a running game rather than letting the cops close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      setScreen('pause');
      announce('Paused.');
    }
  });

  announce('Palma Verde. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
