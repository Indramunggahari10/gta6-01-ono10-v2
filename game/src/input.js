// Keyboard, mouse and touch input. Held keys are read every frame; one-shot
// presses (enter car, punch, shoot, pause, camera, radio) are queued as
// bit flags and taken once, so a press between frames is never lost.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_SHOOT = 16;
export const ACTION_CAMERA = 32;
export const ACTION_RADIO = 64;
export const ACTION_PHONE = 128;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const ENTER = new Set(['KeyE']);
const PUNCH = new Set(['Space']);
const SHOOT = new Set(['KeyF']);
const CAMERA = new Set(['KeyC']);
const RADIO = new Set(['KeyR']);
const PHONE = new Set(['KeyQ', 'Tab']);
const CONFIRM = new Set(['Enter', 'Space']);
const PAUSE = new Set(['KeyP', 'Escape']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  const touch = { forward: false, back: false, left: false, right: false, run: false };

  function down(event) {
    // Space is both Confirm (start on the title screen) and Punch (in
    // play), so it sets both flags: the loop uses Confirm only off-play
    // and Punch only in play, and never both on the same frame.
    if (event.code === 'Space') {
      if (!event.repeat) actions |= ACTION_CONFIRM | ACTION_PUNCH;
      event.preventDefault();
      return;
    }
    if (FORWARD.has(event.code)) held.add('forward');
    else if (BACK.has(event.code)) held.add('back');
    else if (LEFT.has(event.code)) held.add('left');
    else if (RIGHT.has(event.code)) held.add('right');
    else if (RUN.has(event.code)) held.add('run');
    else if (ENTER.has(event.code)) { if (!event.repeat) actions |= ACTION_ENTER; }
    else if (PUNCH.has(event.code)) { if (!event.repeat) actions |= ACTION_PUNCH; }
    else if (SHOOT.has(event.code)) { if (!event.repeat) actions |= ACTION_SHOOT; }
    else if (CAMERA.has(event.code)) { if (!event.repeat) actions |= ACTION_CAMERA; }
    else if (RADIO.has(event.code)) { if (!event.repeat) actions |= ACTION_RADIO; }
    else if (PHONE.has(event.code)) { if (!event.repeat) actions |= ACTION_PHONE; }
    else if (CONFIRM.has(event.code)) { if (!event.repeat) actions |= ACTION_CONFIRM; }
    else if (PAUSE.has(event.code)) { if (!event.repeat) actions |= ACTION_PAUSE; }
    else return;
    event.preventDefault();
  }
  function up(event) {
    if (FORWARD.has(event.code)) held.delete('forward');
    else if (BACK.has(event.code)) held.delete('back');
    else if (LEFT.has(event.code)) held.delete('left');
    else if (RIGHT.has(event.code)) held.delete('right');
    else if (RUN.has(event.code)) held.delete('run');
  }
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => held.clear());
  // A click anywhere starts the game: the title and pause panels cover the
  // canvas, so a canvas-only listener would never see the click.
  window.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

  // Touch buttons are plain DOM elements the HUD builds; this wires them.
  function bindTouchButton(id, name) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); touch[name] = true; };
    const off = (e) => { e.preventDefault(); touch[name] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  function bindTouchAction(id, flag) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      actions |= flag;
    });
  }

  return {
    bindTouch() {
      bindTouchButton('touch-up', 'forward');
      bindTouchButton('touch-down', 'back');
      bindTouchButton('touch-left', 'left');
      bindTouchButton('touch-right', 'right');
      bindTouchButton('touch-run', 'run');
      bindTouchAction('touch-enter', ACTION_ENTER);
      bindTouchAction('touch-punch', ACTION_PUNCH);
      bindTouchAction('touch-shoot', ACTION_SHOOT);
    },
    axis() {
      const f = (held.has('forward') || touch.forward ? 1 : 0) - (held.has('back') || touch.back ? 1 : 0);
      const s = (held.has('right') || touch.right ? 1 : 0) - (held.has('left') || touch.left ? 1 : 0);
      return { forward: f, steer: s, run: held.has('run') || touch.run };
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
