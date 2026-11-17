// The crowd: pedestrians who stroll the sidewalks, cross at corners, and
// scatter (or fall) when a car or a bullet comes too close. They give the
// city its life and the wanted system its first star.
import { CROWD } from './config.js';
import { collideBuildings, clampToCity, roadLines } from './city.js';

const SKINS = ['#c89878', '#8a5a3b', '#e8b890', '#6b4a2f', '#d8a878'];
const SHIRTS = ['#3a6fc8', '#c83a3a', '#3aa655', '#e8b820', '#7a4fc8', '#e87e20', '#20b8a8', '#c8c8c8', '#a8326e'];

export function spawnCrowd(city, rng) {
  const peds = [];
  for (let i = 0; i < CROWD.walkers; i += 1) {
    const bx = rng.int(0, 9);
    const bz = rng.int(0, 9);
    peds.push({
      x: -city.half + bx * city.pitch + rng.range(3, 41),
      z: -city.half + bz * city.pitch + rng.range(3, 41),
      yaw: rng.range(0, Math.PI * 2),
      speed: rng.range(CROWD.walkMin, CROWD.walkMax),
      skin: rng.pick(SKINS),
      shirt: rng.pick(SHIRTS),
      moving: true,
      phase: rng.range(0, 6.28),
      fallen: 0,
      panic: 0,
      targetX: 0,
      targetZ: 0,
      retarget: 0,
    });
  }
  return peds;
}

/** Pick a new stroll target: a sidewalk corner somewhere nearby. */
function pickTarget(ped, city, rng) {
  const bx = Math.max(0, Math.min(8, Math.floor((ped.x + city.half) / city.pitch)));
  const bz = Math.max(0, Math.min(8, Math.floor((ped.z + city.half) / city.pitch)));
  const nbx = Math.max(0, Math.min(8, bx + rng.int(-2, 3)));
  const nbz = Math.max(0, Math.min(8, bz + rng.int(-2, 3)));
  ped.targetX = -city.half + nbx * city.pitch + rng.range(3, 41);
  ped.targetZ = -city.half + nbz * city.pitch + rng.range(3, 41);
  ped.retarget = rng.range(4, 10);
}

export function stepPedestrian(ped, dt, city, rng, danger) {
  if (ped.fallen > 0) {
    ped.fallen -= dt;
    ped.moving = false;
    return;
  }
  ped.moving = true;
  ped.retarget -= dt;
  const dx = ped.targetX - ped.x;
  const dz = ped.targetZ - ped.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.5 || ped.retarget <= 0) pickTarget(ped, city, rng);
  let speed = ped.speed;
  let tx = ped.targetX;
  let tz = ped.targetZ;
  if (danger) {
    // Run away from the danger point.
    const ddx = ped.x - danger.x;
    const ddz = ped.z - danger.z;
    const dd = Math.hypot(ddx, ddz) || 1;
    if (dd < 14) {
      tx = ped.x + (ddx / dd) * 20;
      tz = ped.z + (ddz / dd) * 20;
      speed = ped.speed * 2.6;
      ped.panic = 1.5;
    }
  }
  if (ped.panic > 0) ped.panic -= dt;
  const tdx = tx - ped.x;
  const tdz = tz - ped.z;
  const td = Math.hypot(tdx, tdz) || 1;
  const wantYaw = Math.atan2(tdx, tdz);
  let dyaw = wantYaw - ped.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  ped.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
  const before = { x: ped.x, z: ped.z };
  ped.x += Math.sin(ped.yaw) * speed * dt;
  ped.z += Math.cos(ped.yaw) * speed * dt;
  const pos = { x: ped.x, z: ped.z };
  if (collideBuildings(city, pos, 0.9)) {
    ped.x = before.x;
    ped.z = before.z;
    pickTarget(ped, city, rng);
  }
  clampToCity(city, ped, 0.9);
}

/** A car or a punch knocks a pedestrian down; returns true on a fresh hit. */
export function knockPedestrian(ped) {
  if (ped.fallen > 0) return false;
  ped.fallen = 2.5;
  ped.moving = false;
  return true;
}

export { roadLines };
