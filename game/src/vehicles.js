// Cars: traffic that cruises the road grid, parked cars to steal, and the
// police interceptors that chase the player. All driving is the same
// bicycle-ish model: throttle, steering, drag and building collisions.
import { CAR, TRAFFIC } from './config.js';
import { collideBuildings, clampToCity, onRoad, roadLines, snapToRoad } from './city.js';

const CAR_COLORS = [
  '#c83232', '#2e6fc8', '#e8b820', '#3aa655', '#c8c8c8', '#e87e20',
  '#7a4fc8', '#20b8a8', '#282c34', '#d8d8d8', '#a8326e', '#5a7a3a',
];
const POLICE_COLOR = '#1c2733';

export function makeCar(rng, x, z, yaw, opts = {}) {
  return {
    x, z, yaw,
    speed: 0,
    color: opts.color || rng.pick(CAR_COLORS),
    police: !!opts.police,
    parked: !!opts.parked,
    health: CAR.health,
    braking: false,
    // Traffic state: which road it follows and where it is going.
    alongX: opts.alongX ?? rng.chance(0.5),
    lane: opts.lane ?? (rng.chance(0.5) ? 3.2 : -3.2),
    cruise: rng.range(TRAFFIC.cruiseMin, TRAFFIC.cruiseMax),
    turnAt: 0,
    stuck: 0,
    driver: opts.driver ?? true, // a parked car with no driver can be stolen
  };
}

/** Spawn the traffic fleet and a few parked cars on the road network. */
export function spawnTraffic(city, rng) {
  const cars = [];
  const lines = roadLines();
  for (let i = 0; i < TRAFFIC.cars; i += 1) {
    const line = rng.pick(lines);
    const alongX = rng.chance(0.5);
    const lane = rng.chance(0.5) ? 3.2 : -3.2;
    const t = rng.range(-city.half, city.half);
    const x = alongX ? t : line + lane;
    const z = alongX ? line + lane : t;
    const yaw = alongX ? (lane > 0 ? Math.PI / 2 : -Math.PI / 2) : (lane > 0 ? 0 : Math.PI);
    const car = makeCar(rng, x, z, yaw, { alongX, lane });
    car.speed = car.cruise;
    cars.push(car);
  }
  // Parked cars along the roads, free for the taking (and a wanted star).
  for (let i = 0; i < 8; i += 1) {
    const line = rng.pick(lines);
    const alongX = rng.chance(0.5);
    const t = rng.range(-city.half + 20, city.half - 20);
    const side = rng.chance(0.5) ? 5.4 : -5.4;
    const x = alongX ? t : line + side;
    const z = alongX ? line + side : t;
    const yaw = alongX ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
    cars.push(makeCar(rng, x, z, yaw, { parked: true, driver: false }));
  }
  return cars;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** One traffic car follows its road; at a crossing it may turn. */
export function stepTrafficCar(car, dt, rng, city) {
  if (car.parked) return;
  const lines = roadLines();
  // Find the road line this car is on.
  const axis = car.alongX ? car.z : car.x;
  let line = lines[0];
  for (const L of lines) if (Math.abs(axis - L) < Math.abs(axis - line)) line = L;
  // At a crossing, sometimes turn onto the cross road.
  const cross = car.alongX ? car.x : car.z;
  let nearCross = false;
  for (const L of lines) {
    if (Math.abs(cross - L) < 2.5) { nearCross = true; break; }
  }
  if (nearCross && car.turnAt <= 0 && rng.chance(0.35)) {
    car.alongX = !car.alongX;
    car.lane = rng.chance(0.5) ? 3.2 : -3.2;
    car.turnAt = 1.5;
    // Snap onto the new road's lane.
    if (car.alongX) { car.z = line + car.lane; }
    else { car.x = line + car.lane; }
  }
  car.turnAt -= dt;
  const targetYaw = car.alongX ? (car.lane > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.lane > 0 ? 0 : Math.PI);
  const dyaw = angleDiff(car.yaw, targetYaw);
  car.yaw += Math.max(-2.4 * dt, Math.min(2.4 * dt, dyaw));
  car.speed += (car.cruise - car.speed) * Math.min(1, 2 * dt);
  car.x += Math.sin(car.yaw) * car.speed * dt;
  car.z += Math.cos(car.yaw) * car.speed * dt;
  clampToCity(city, car, CAR.radius);
}

/** Keep traffic cars from piling into each other: the rear one slows. */
export function separateTraffic(cars, dt) {
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i];
      const b = cars[j];
      if (a.parked && b.parked) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 6.5 || d < 0.01) continue;
      const push = (6.5 - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      if (!a.parked) { a.x -= nx * push * 0.5; a.z -= nz * push * 0.5; }
      if (!b.parked) { b.x += nx * push * 0.5; b.z += nz * push * 0.5; }
      if (!a.parked) a.speed = Math.min(a.speed, b.speed);
      if (!b.parked) b.speed = Math.min(b.speed, a.speed);
    }
  }
}

/** Drive a car from input: throttle -1..1, steer -1..1. Returns speed.
 * `now` is the game clock, used to rate-limit collision damage so a car
 * pressed against a wall takes one thump, not one per frame. `bump` is a
 * one-shot flag: it is set here on a hard hit and must be consumed (reset
 * to 0) by whoever reads it, or the crash would repeat every frame. */
export function driveCar(car, dt, throttle, steer, city, now = 0) {
  const maxSpeed = car.police ? CAR.policeMaxSpeed : CAR.maxSpeed;
  if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) {
    if (car.speed > 0.5) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * throttle * dt; // throttle is negative: reversing
  }
  car.braking = throttle < 0 && car.speed > 0.5;
  // Drag and rolling resistance.
  car.speed -= car.speed * CAR.drag * dt;
  if (Math.abs(car.speed) < 0.15 && throttle === 0) car.speed = 0;
  car.speed = Math.max(-CAR.maxReverse, Math.min(maxSpeed, car.speed));
  // Steering only bites while moving; sharper at low speed.
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 8) * (car.speed < 0 ? -1 : 1);
  car.yaw += steer * CAR.turnRate * steerAuthority * dt * (1 - Math.min(0.45, Math.abs(car.speed) / 110));
  const before = { x: car.x, z: car.z };
  car.x += Math.sin(car.yaw) * car.speed * dt;
  car.z += Math.cos(car.yaw) * car.speed * dt;
  const pos = { x: car.x, z: car.z };
  if (collideBuildings(city, pos, CAR.radius)) {
    // A hard hit: bounce a little and lose speed. Damage is rate-limited
    // so holding the throttle against a wall does not wreck the car.
    const impact = Math.abs(car.speed);
    car.x = before.x;
    car.z = before.z;
    car.speed *= -0.25;
    car.bump = 0;
    if (impact > 6 && now - (car.lastBump || -9) > 0.6) {
      car.lastBump = now;
      car.health -= impact * 0.9;
      car.bump = impact;
    }
  }
  clampToCity(city, car, CAR.radius);
  return car.speed;
}

/** A police interceptor steers straight at the player and rams. */
export function stepPoliceCar(car, dt, target, city, rng) {
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(dx, dz);
  const dyaw = angleDiff(car.yaw, wantYaw);
  car.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, dyaw));
  // Ease off when very close so it rams instead of orbiting.
  const throttle = dist > 6 ? 1 : 0.6;
  car.speed += (CAR.policeMaxSpeed * throttle - car.speed) * Math.min(1, 1.6 * dt);
  car.x += Math.sin(car.yaw) * car.speed * dt;
  car.z += Math.cos(car.yaw) * car.speed * dt;
  const pos = { x: car.x, z: car.z };
  if (collideBuildings(city, pos, CAR.radius)) {
    car.x -= Math.sin(car.yaw) * car.speed * dt;
    car.z -= Math.cos(car.yaw) * car.speed * dt;
    car.speed *= 0.4;
    car.yaw += (rng.chance(0.5) ? 1 : -1) * 0.7;
  }
  clampToCity(city, car, CAR.radius);
  return dist;
}

export function spawnPoliceCar(city, rng, nearX, nearZ) {
  // Appear on a road a little way from the player, facing roughly at them.
  const spot = snapToRoad(nearX + rng.range(-70, 70), nearZ + rng.range(-70, 70));
  const car = makeCar(rng, spot.x, spot.z, Math.atan2(nearX - spot.x, nearZ - spot.z), {
    color: POLICE_COLOR, police: true, alongX: spot.alongX,
  });
  car.speed = 20;
  return car;
}

export { CAR_COLORS, POLICE_COLOR, onRoad };
