// The screenshot scenes behind ?shot=cover|street|night|mission. Each one
// sets the world to a real, playable moment — a chase, a street walk, a
// night drive, a mission in progress — then plays the rules forward with a
// simple autopilot (drive at the beacon, keep the car on the road) so the
// frame is what a short game really looks like, and the same seed always
// gives the same frame.
import { STEP } from './config.js';
import { snapToRoad } from './city.js';
import { spawnPoliceCar } from './vehicles.js';

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Drive toward the marker: forward, steering at the beacon. */
function autopilotDrive(game) {
  const car = game.playerCar;
  if (!car) return { forward: 0, steer: 0, run: false };
  const m = game.marker || { x: car.x + Math.sin(car.yaw) * 40, z: car.z + Math.cos(car.yaw) * 40 };
  const want = Math.atan2(m.x - car.x, m.z - car.z);
  const steer = Math.max(-1, Math.min(1, angleDiff(car.yaw, want) * 1.6));
  return { forward: 1, steer, run: false };
}

function autopilotWalk(game) {
  const p = game.player;
  const m = game.marker || { x: p.x + 20, z: p.z + 20 };
  const want = Math.atan2(m.x - p.x, m.z - p.z);
  const dyaw = angleDiff(p.yaw, want);
  return { forward: 1, steer: Math.max(-1, Math.min(1, dyaw * 2)), run: false };
}

function runFor(game, seconds, pilot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) game.step(STEP, pilot(game));
}

/**
 * Set the game to the named scene and return the screen to draw over it.
 * Any other name stages the cover chase.
 */
export function stageShot(name, game) {
  const city = game.city;
  if (name === 'street') {
    game.timeOfDay = 0.35; // bright morning, 08:24 on the HUD clock
    game.wanted = 0;
    // On the north-south road at x=22, facing down it toward the beacon.
    // The player walks the right-hand lane (x=25.5), off the centre-line
    // dashes, so the figure reads against dark asphalt, not on a white dash.
    game.player.x = 25.5;
    game.player.z = -100;
    game.player.yaw = 0;
    game.playerCar = null;
    game.mission = null;
    game.marker = { x: 25.5, z: 20, label: 'Plaza Verde', color: '#ffd21f' };
    runFor(game, 2.5, autopilotWalk);
    return { screen: 'play' };
  }
  if (name === 'night') {
    game.timeOfDay = 0.8;
    game.wanted = 2;
    // Down the same road at night. Clear the whole stretch the player
    // will drive, so the chase does not rear-end slow traffic mid-shot
    // (the autopilot cannot steer around it), and bring the interceptor
    // in from far behind so it chases without ramming into the frame.
    game.cars = game.cars.filter((c) => !(Math.abs(c.x - 22) < 12 && c.z > -130 && c.z < 70));
    game.playerCar = game.giveCar(22, -120, 0);
    game.player.x = game.playerCar.x;
    game.player.z = game.playerCar.z;
    game.cops.cars = [spawnPoliceCar(city, game.rng, 22, -175)];
    game.marker = { x: 22, z: 60, label: 'Marina Docks', color: '#ffd21f' };
    runFor(game, 3, autopilotDrive);
    return { screen: 'play' };
  }
  if (name === 'mission') {
    game.timeOfDay = 0.72; // dusk, 17:17 on the HUD clock
    game.wanted = 1;
    game.playerCar = null;
    game.startMissionAt(1);
    // Stand on the package's road, 18 units down it and facing the
    // beacon — close enough that it fills the frame, far enough not to
    // grab the package during the staging walk.
    const first = game.mission.targets[0];
    const spot = snapToRoad(first.x, first.z, 3.2);
    game.player.x = spot.x + (spot.alongX ? 18 : 0);
    game.player.z = spot.z + (spot.alongX ? 0 : 18);
    game.player.yaw = Math.atan2(first.x - game.player.x, first.z - game.player.z);
    runFor(game, 1.5, autopilotWalk);
    return { screen: 'play' };
  }
  // cover: a daytime chase with three stars, two interceptors behind.
  // The car starts in the middle of the east-west road (z=-94), not on
  // its edge, so the chase camera is not pressed against a building.
  game.timeOfDay = 0.38;
  game.wanted = 3;
  game.cars = game.cars.filter((c) => Math.hypot(c.x + 40, c.z + 94) > 25);
  game.playerCar = game.giveCar(-40, -94, Math.PI / 2);
  game.player.x = game.playerCar.x;
  game.player.z = game.playerCar.z;
  game.cops.cars = [
    spawnPoliceCar(city, game.rng, -70, -130),
    spawnPoliceCar(city, game.rng, -20, -140),
  ];
  game.marker = { x: 140, z: -94, label: 'Safehouse', color: '#ffd21f' };
  runFor(game, 5, autopilotDrive);
  return { screen: 'play' };
}
