// Frame composition: where the camera sits and what the renderer is shown.
// The chase camera trails the player (or their car) from behind; C cycles
// near, far and high cinematic views. The scene object is the renderer's
// whole input, assembled fresh each frame from the game state.
import { chaseCamera } from './engine3d.js';

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function createFrameComposer(renderer) {
  let smoothYaw = 0;
  let first = true;

  /** Move the camera behind the player or their car. */
  function updateCamera(game, dt) {
    const cam = renderer.cam;
    const p = game.player;
    const car = game.playerCar;
    const targetYaw = car ? car.yaw : p.yaw;
    if (first) {
      smoothYaw = targetYaw;
      first = false;
    }
    smoothYaw = angleLerp(smoothYaw, targetYaw, 1 - Math.exp(-4 * dt));
    const mode = game.cameraMode;
    const dist = car ? (mode === 0 ? 13 : mode === 1 ? 19 : 26) : (mode === 0 ? 9 : mode === 1 ? 14 : 20);
    const height = car ? (mode === 0 ? 5 : mode === 1 ? 7.5 : 13) : (mode === 0 ? 4.5 : mode === 1 ? 6.5 : 11);
    const pitch = mode === 2 ? 0.62 : 0.3;
    const tx = car ? car.x : p.x;
    const tz = car ? car.z : p.z;
    chaseCamera(cam, tx, 0, tz, smoothYaw, dist, height, pitch, dt);
  }

  /** Assemble the scene the 3D renderer draws. Police interceptors drive
   * with the traffic, and foot officers walk with the crowd, so both are
   * folded into the lists the renderer already knows how to draw. */
  function buildScene(game) {
    const footCops = game.cops.foot.map((cop) => ({
      x: cop.x, z: cop.z, yaw: cop.yaw,
      skin: '#c89878', shirt: '#1c2733',
      moving: cop.moving, phase: cop.phase, fallen: 0,
    }));
    return {
      city: game.city,
      player: game.player,
      playerCar: game.playerCar,
      cars: [...game.cars, ...game.cops.cars],
      peds: [...game.peds, ...footCops],
      particles: game.particles,
      marker: game.marker,
      timeOfDay: game.timeOfDay,
    };
  }

  function drawFrame(game, time) {
    renderer.draw(buildScene(game), time);
  }

  return { updateCamera, buildScene, drawFrame };
}
