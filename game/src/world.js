// The simulation: everything that happens in Palma Verde, with no drawing
// and no browser in it. The player on foot or in a car, traffic, the crowd,
// the police response, pickups, the mission chain and the wanted system.
// step() advances one fixed step and queues events the loop reacts to.
import { CAR, CITY, DAY_LENGTH, MONEY, PLAYER, SAVE_KEY, STEP, WANTED } from './config.js';
import { buildCity, clampToCity, collideBuildings } from './city.js';
import { makeRng } from './random.js';
import { driveCar, makeCar, separateTraffic, spawnPoliceCar, spawnTraffic, stepPoliceCar, stepTrafficCar } from './vehicles.js';
import { knockPedestrian, spawnCrowd, stepPedestrian } from './pedestrians.js';
import { MISSIONS, createMissionState, missionMarker, startMission } from './missions.js';

const PLAYER_CAR_COLOR = '#c83232';

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createGame(seed) {
  const rng = makeRng(seed);
  const city = buildCity(seed);
  const game = {
    city,
    rng,
    seed,
    elapsed: 0,
    timeOfDay: 0.32, // a bright morning start, 07:40 on the HUD clock
    player: {
      x: city.places.safehouse.x, z: city.places.safehouse.z, yaw: 0,
      health: PLAYER.maxHealth, armor: 0, ammo: PLAYER.startAmmo,
      moving: false, punchCooldown: 0, shootCooldown: 0, invuln: 0,
    },
    playerCar: null,
    cars: spawnTraffic(city, rng),
    cops: { cars: [], foot: [] },
    peds: spawnCrowd(city, rng),
    wanted: 0,
    money: MONEY.start,
    totalEarned: 0,
    missions: createMissionState(),
    mission: null,
    marker: null,
    particles: [],
    events: [],
    cameraMode: 0, // 0 near chase, 1 far chase, 2 high cinematic
    unseenTimer: 0,
    callTimer: 6, // first phone call comes soon after starting
    respawnTimer: 0,
  };

  function emit(type, data = {}) {
    game.events.push({ type, ...data });
  }

  function addWanted(n) {
    const before = game.wanted;
    game.wanted = Math.max(0, Math.min(WANTED.max, game.wanted + n));
    if (game.wanted > before) {
      game.unseenTimer = 0;
      emit('wanted-up', { wanted: game.wanted });
    }
  }

  function burst(x, y, z, color, count, size = 1) {
    for (let i = 0; i < count; i += 1) {
      game.particles.push({
        x, y, z,
        vx: (rng() - 0.5) * 8, vy: rng() * 6, vz: (rng() - 0.5) * 8,
        life: rng() * 0.5 + 0.4, maxLife: 0.9, color, size: size * rng.range(0.6, 1.4),
      });
    }
  }

  function giveCar(x, z, yaw) {
    const car = makeCar(rng, x, z, yaw, { color: PLAYER_CAR_COLOR });
    game.playerCar = car;
    return car;
  }

  function nearestCar(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of game.cars) {
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function tryEnterCar() {
    const p = game.player;
    const car = nearestCar(p.x, p.z, 6);
    if (!car) return false;
    game.cars.splice(game.cars.indexOf(car), 1);
    car.parked = false;
    car.driver = true;
    game.playerCar = car;
    p.x = car.x;
    p.z = car.z;
    // Stealing any car — parked or with a driver at the wheel — draws a
    // star: the city watches its cars.
    addWanted(WANTED.stealCar);
    emit('steal', { text: 'Car stolen — the cops noticed' });
    return true;
  }

  function exitCar() {
    const car = game.playerCar;
    if (!car) return false;
    const p = game.player;
    p.x = car.x + Math.cos(car.yaw) * 3;
    p.z = car.z - Math.sin(car.yaw) * 3;
    p.yaw = car.yaw;
    car.speed = 0;
    car.parked = true;
    car.driver = false;
    game.cars.push(car);
    game.playerCar = null;
    return true;
  }

  function punch() {
    const p = game.player;
    if (p.punchCooldown > 0 || game.playerCar) return;
    p.punchCooldown = PLAYER.punchCooldown;
    emit('punch');
    const targets = [...game.cops.foot, ...game.peds];
    for (const t of targets) {
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > PLAYER.punchRange) continue;
      const ang = Math.abs(angleDiff(p.yaw, Math.atan2(dx, dz)));
      if (ang > 1.1) continue;
      if (t.health !== undefined) {
        t.health -= PLAYER.punchDamage;
        burst(t.x, 2, t.z, '#ffd21f', 4, 0.8);
        if (t.health <= 0) {
          game.cops.foot.splice(game.cops.foot.indexOf(t), 1);
          addWanted(WANTED.killCop);
          emit('cop-down', { text: 'Officer down — wanted level up' });
        }
      } else if (knockPedestrian(t)) {
        addWanted(WANTED.hitPedestrian);
        emit('ped-down', { text: 'Pedestrian hit — wanted level up' });
      }
      return;
    }
  }

  function shoot() {
    const p = game.player;
    if (p.shootCooldown > 0 || game.playerCar) return;
    if (p.ammo <= 0) {
      emit('click-empty', { text: 'Out of ammo — find an ammo pickup' });
      p.shootCooldown = 0.3;
      return;
    }
    p.shootCooldown = PLAYER.shootCooldown;
    p.ammo -= 1;
    emit('shoot');
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    burst(p.x + fx * 2, 2.2, p.z + fz * 2, '#ffe98a', 3, 0.7);
    let best = null;
    let bestD = PLAYER.bulletRange;
    const candidates = [];
    for (const cop of game.cops.foot) candidates.push({ kind: 'cop', obj: cop });
    for (const ped of game.peds) candidates.push({ kind: 'ped', obj: ped });
    for (const car of game.cops.cars) candidates.push({ kind: 'police-car', obj: car });
    for (const c of candidates) {
      const dx = c.obj.x - p.x;
      const dz = c.obj.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const along = (dx * fx + dz * fz) / (d || 1);
      if (along < 0.94) continue;
      bestD = d;
      best = c;
    }
    if (!best) return;
    const t = best.obj;
    burst(t.x, 2, t.z, '#ff5040', 6, 1);
    if (best.kind === 'ped') {
      if (knockPedestrian(t)) addWanted(WANTED.hitPedestrian);
    } else if (best.kind === 'cop') {
      t.health -= PLAYER.bulletDamage;
      addWanted(WANTED.shoot);
      if (t.health <= 0) {
        game.cops.foot.splice(game.cops.foot.indexOf(t), 1);
        addWanted(WANTED.killCop);
        emit('cop-down', { text: 'Officer down — wanted level up' });
      }
    } else {
      t.health -= PLAYER.bulletDamage;
      addWanted(WANTED.shoot);
      if (t.health <= 0) {
        burst(t.x, 2, t.z, '#ff7a20', 22, 2.2);
        burst(t.x, 3, t.z, '#555555', 12, 2.6);
        game.cops.cars.splice(game.cops.cars.indexOf(t), 1);
        addWanted(WANTED.killCop);
        emit('cop-car-down', { text: 'Interceptor destroyed' });
      }
    }
  }

  function startMissionAt(index) {
    if (index >= MISSIONS.length) return false;
    game.mission = startMission(MISSIONS, index, city, game.seed);
    game.marker = missionMarker(MISSIONS, game.mission, city);
    if (game.mission.def.wantedOnStart > 0) {
      game.wanted = game.mission.def.wantedOnStart;
      game.unseenTimer = 0;
    }
    emit('mission-start', { title: game.mission.def.title, objective: game.mission.def.objective });
    return true;
  }

  function finishMission() {
    const def = game.mission.def;
    game.money += def.reward;
    game.totalEarned += def.reward;
    game.missions.done.push(def.id);
    game.missions.index += 1;
    game.mission = null;
    game.marker = null;
    emit('mission-done', { title: def.title, reward: def.reward });
    if (game.missions.index < MISSIONS.length) {
      game.callTimer = 8;
    } else {
      emit('story-done', { text: 'All five jobs done — Palma Verde is yours, Dario.' });
    }
    save();
  }

  function failMission(reason) {
    emit('mission-fail', { title: game.mission.def.title, reason });
    game.mission = null;
    game.marker = null;
    game.wanted = Math.max(0, game.wanted - 1);
    game.callTimer = 10;
  }

  function save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: game.money, totalEarned: game.totalEarned,
        missionIndex: game.missions.index, done: game.missions.done,
      }));
    } catch {
      // Storage off: progress lasts this visit only.
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.money === 'number') game.money = data.money;
      if (typeof data.totalEarned === 'number') game.totalEarned = data.totalEarned;
      if (typeof data.missionIndex === 'number') game.missions.index = Math.min(data.missionIndex, MISSIONS.length);
      if (Array.isArray(data.done)) game.missions.done = data.done;
    } catch {
      // A corrupt save starts fresh.
    }
  }

  function respawn() {
    const p = game.player;
    const safe = city.places.safehouse;
    if (game.playerCar) {
      game.cars.push(game.playerCar);
      game.playerCar = null;
    }
    p.x = safe.x;
    p.z = safe.z;
    p.yaw = 0;
    p.health = PLAYER.maxHealth;
    p.armor = 0;
    p.ammo = Math.max(p.ammo, 12);
    game.wanted = 0;
    game.cops.cars = [];
    game.cops.foot = [];
    if (game.mission) failMission('You woke up at the safehouse.');
    save();
  }

  function stepPlayer(dt, input) {
    const p = game.player;
    if (p.punchCooldown > 0) p.punchCooldown -= dt;
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    const car = game.playerCar;
    if (car) {
      const throttle = input.forward;
      const steer = input.steer;
      const speed = driveCar(car, dt, throttle, steer, city, game.elapsed);
      if (car.bump > 8) {
        // Consume the one-shot bump flag: without this reset the crash
        // sound and smoke burst would fire on every frame after one hit.
        car.bump = 0;
        emit('crash');
        burst(car.x, 1.5, car.z, '#c8c8c8', 6, 1);
      }
      p.x = car.x;
      p.z = car.z;
      p.yaw = car.yaw;
      p.moving = Math.abs(speed) > 0.5;
      // Running over pedestrians.
      for (const ped of game.peds) {
        if (ped.fallen > 0) continue;
        const d = Math.hypot(ped.x - car.x, ped.z - car.z);
        if (d < 2.6 && Math.abs(speed) > 4) {
          if (knockPedestrian(ped)) {
            addWanted(WANTED.hitPedestrian);
            emit('ped-down', { text: 'Pedestrian hit — wanted level up' });
            burst(ped.x, 1.5, ped.z, '#ff5040', 6, 1);
          }
        }
      }
      // Ramming traffic: one thump per contact, not damage every frame.
      for (const other of game.cars) {
        if (other.parked) continue;
        const d = Math.hypot(other.x - car.x, other.z - car.z);
        if (d < 4.5 && game.elapsed - (car.lastRam || -9) > 0.6) {
          car.lastRam = game.elapsed;
          other.speed = Math.min(other.speed, 4);
          car.health -= Math.abs(speed) * 0.35;
          other.health -= Math.abs(speed) * 0.5;
          if (Math.abs(speed) > 12) {
            emit('crash');
            burst(car.x, 1.5, car.z, '#c8c8c8', 5, 1);
          }
          car.speed *= 0.6;
        }
      }
      if (car.health <= 0) {
        burst(car.x, 2, car.z, '#ff7a20', 24, 2.4);
        burst(car.x, 3, car.z, '#555555', 14, 2.8);
        emit('car-wrecked', { text: 'Your car is wrecked!' });
        game.playerCar = null;
        p.x = car.x + 3;
        p.z = car.z + 3;
      }
      return;
    }
    // On foot: forward/back along the heading, steer turns the heading.
    const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    p.yaw += input.steer * 2.6 * dt * (input.forward !== 0 ? 1 : 0.6);
    const move = input.forward * speed;
    p.moving = input.forward !== 0;
    const before = { x: p.x, z: p.z };
    p.x += Math.sin(p.yaw) * move * dt;
    p.z += Math.cos(p.yaw) * move * dt;
    const pos = { x: p.x, z: p.z };
    if (collideBuildings(city, pos, PLAYER.radius)) {
      p.x = before.x;
      p.z = before.z;
    }
    clampToCity(city, p, PLAYER.radius);
  }

  function stepPolice(dt) {
    const p = game.player;
    // How many interceptors should be out there.
    const wantCars = game.wanted > 0 ? Math.min(game.wanted + 1, 5) : 0;
    if (game.cops.cars.length < wantCars && game.elapsed - (game.lastCopSpawn || 0) > 2.5) {
      game.cops.cars.push(spawnPoliceCar(city, rng, p.x, p.z));
      game.lastCopSpawn = game.elapsed;
    }
    if (game.wanted === 0) {
      // Stand down: cars drive off and fade when far away.
      for (let i = game.cops.cars.length - 1; i >= 0; i -= 1) {
        const cop = game.cops.cars[i];
        stepTrafficCar(cop, dt, rng, city);
        if (Math.hypot(cop.x - p.x, cop.z - p.z) > 120) game.cops.cars.splice(i, 1);
      }
      game.cops.foot = [];
    } else {
      for (let i = game.cops.cars.length - 1; i >= 0; i -= 1) {
        const cop = game.cops.cars[i];
        const dist = stepPoliceCar(cop, dt, p, city, rng);
        // Ramming the player's car damages it; ramming the player hurts.
        if (game.playerCar) {
          if (dist < 4.2 && Math.abs(cop.speed) > 6) {
            game.playerCar.health -= 14 * dt * 1.5;
            cop.health -= 6 * dt * 1.5;
            if (game.elapsed - (game.lastRamSound || 0) > 0.8) {
              emit('crash');
              game.lastRamSound = game.elapsed;
            }
          }
        } else if (dist < 3.2) {
          if (p.invuln <= 0) {
            p.health -= 8 * dt * 4;
            p.invuln = 0.4;
            emit('hit');
          }
        }
        if (cop.health <= 0) {
          burst(cop.x, 2, cop.z, '#ff7a20', 20, 2.2);
          game.cops.cars.splice(i, 1);
        }
      }
      // Foot officers join the chase once the heat is on and the player walks.
      if (game.wanted >= 2 && !game.playerCar && game.cops.foot.length < 2) {
        if (game.elapsed - (game.lastFootSpawn || 0) > 4) {
          const spot = { x: p.x + rng.range(-40, 40), z: p.z + rng.range(-40, 40) };
          game.cops.foot.push({
            x: spot.x, z: spot.z, yaw: 0, health: 100,
            punchCooldown: 0, shootCooldown: 1, touchTime: 0, moving: true, phase: rng.range(0, 6),
          });
          game.lastFootSpawn = game.elapsed;
        }
      }
      for (let i = game.cops.foot.length - 1; i >= 0; i -= 1) {
        const cop = game.cops.foot[i];
        const dx = p.x - cop.x;
        const dz = p.z - cop.z;
        const d = Math.hypot(dx, dz);
        cop.yaw = Math.atan2(dx, dz);
        if (cop.punchCooldown > 0) cop.punchCooldown -= dt;
        if (cop.shootCooldown > 0) cop.shootCooldown -= dt;
        if (d > 3) {
          const speed = Math.min(WANTED.copFootSpeed, d * 0.9);
          cop.x += Math.sin(cop.yaw) * speed * dt;
          cop.z += Math.cos(cop.yaw) * speed * dt;
          cop.moving = true;
        } else {
          cop.moving = false;
          cop.touchTime += dt;
          if (cop.punchCooldown <= 0 && p.invuln <= 0) {
            p.health -= 10;
            p.invuln = 0.5;
            cop.punchCooldown = 0.9;
            emit('hit');
          }
          if (cop.touchTime > 1.6) {
            emit('busted');
            game.cops.foot.splice(i, 1);
            respawn();
            return;
          }
        }
        if (d > 8 && d < WANTED.copShootRange && cop.shootCooldown <= 0) {
          cop.shootCooldown = WANTED.copShootCooldown;
          if (p.invuln <= 0) {
            p.health -= 6;
            p.invuln = 0.3;
            emit('hit');
          }
          burst(cop.x, 2.2, cop.z, '#ffe98a', 2, 0.6);
        }
        if (d > 90) game.cops.foot.splice(i, 1);
      }
    }
    // Wanted decay: unseen for a while drops one star.
    const nearestCop = Math.min(
      ...game.cops.cars.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
      ...game.cops.foot.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
      Infinity,
    );
    if (game.wanted > 0 && nearestCop > 55) {
      game.unseenTimer += dt;
      if (game.unseenTimer >= WANTED.decaySeconds) {
        game.wanted -= 1;
        game.unseenTimer = 0;
        emit('wanted-down', { wanted: game.wanted });
      }
    } else {
      game.unseenTimer = 0;
    }
  }

  function stepMissions(dt) {
    // Phone calls: Mara rings, the player answers with Q.
    if (!game.mission && game.missions.index < MISSIONS.length) {
      if (game.callTimer > 0) {
        game.callTimer -= dt;
        if (game.callTimer <= 0) {
          game.missions.callPending = MISSIONS[game.missions.index];
          emit('phone', { caller: game.missions.callPending.caller });
        }
      }
    }
    const m = game.mission;
    if (!m) return;
    const def = m.def;
    if (def.timeLimit > 0) {
      m.timer -= dt;
      if (m.timer <= 0) {
        failMission('Out of time.');
        return;
      }
    }
    const p = game.player;
    if (def.kind === 'escape') {
      const nearestCop = Math.min(
        ...game.cops.cars.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
        ...game.cops.foot.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
        Infinity,
      );
      if (nearestCop > 50) {
        m.escapeTimer -= dt;
        if (m.escapeTimer <= 0) {
          finishMission();
          return;
        }
      }
      const dock = city.places.docks;
      if (Math.hypot(p.x - dock.x, p.z - dock.z) < 8) {
        finishMission();
        return;
      }
      return;
    }
    if (def.kind === 'collect') {
      for (const t of m.targets) {
        if (!t.taken && Math.hypot(p.x - t.x, p.z - t.z) < 4) {
          t.taken = true;
          m.collected += 1;
          game.money += MONEY.package;
          emit('pickup', { text: `Package ${m.collected}/${def.count} secured (+$${MONEY.package})` });
          game.marker = missionMarker(MISSIONS, m, city);
        }
      }
      if (m.collected >= def.count) {
        const plaza = city.places[def.place];
        if (Math.hypot(p.x - plaza.x, p.z - plaza.z) < 8) finishMission();
      }
      return;
    }
    if (def.kind === 'fetch-deliver') {
      if (m.phase === 'fetch') {
        const from = city.places[def.from];
        if (Math.hypot(p.x - from.x, p.z - from.z) < 7) {
          m.phase = 'deliver';
          game.marker = missionMarker(MISSIONS, m, city);
          emit('pickup', { text: 'Case grabbed — now deliver it!' });
        }
        return;
      }
      const dest = city.places[def.place];
      if (Math.hypot(p.x - dest.x, p.z - dest.z) < 8) finishMission();
      return;
    }
    // drive-to
    const dest = city.places[def.place];
    if (Math.hypot(p.x - dest.x, p.z - dest.z) < 8) finishMission();
  }

  function stepPickups(dt) {
    const p = game.player;
    for (const pk of city.pickups) {
      if (pk.taken) {
        pk.respawn = (pk.respawn || 0) - dt;
        if (pk.respawn <= 0) pk.taken = false;
        continue;
      }
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 2.4) {
        pk.taken = true;
        pk.respawn = 60;
        if (pk.kind === 'health') {
          p.health = Math.min(PLAYER.maxHealth, p.health + 30);
          emit('pickup', { text: 'Health +30' });
        } else if (pk.kind === 'armor') {
          p.armor = Math.min(100, p.armor + 40);
          emit('pickup', { text: 'Armour +40' });
        } else if (pk.kind === 'cash') {
          game.money += MONEY.package;
          game.totalEarned += MONEY.package;
          emit('pickup', { text: `Found $${MONEY.package} on the street` });
        } else {
          p.ammo = Math.min(PLAYER.maxAmmo, p.ammo + 24);
          emit('pickup', { text: 'Ammo +24' });
        }
      }
    }
  }

  function stepParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i -= 1) {
      const pt = game.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.vy -= 4 * dt;
      if (pt.life <= 0 || pt.y < 0) game.particles.splice(i, 1);
    }
  }

  /** One fixed step. `input` is {forward, steer, run}. */
  function step(dt, input) {
    game.elapsed += dt;
    game.timeOfDay = (game.timeOfDay + dt / DAY_LENGTH) % 1;
    stepPlayer(dt, input);
    for (const car of game.cars) stepTrafficCar(car, dt, rng, city);
    separateTraffic(game.cars, dt);
    const danger = game.playerCar && Math.abs(game.playerCar.speed) > 10
      ? { x: game.playerCar.x, z: game.playerCar.z } : null;
    for (const ped of game.peds) stepPedestrian(ped, dt, city, rng, danger);
    stepPolice(dt);
    stepMissions(dt);
    stepPickups(dt);
    stepParticles(dt);
    if (game.player.health <= 0) {
      emit('wasted');
      respawn();
    }
  }

  load();

  // Attach the methods to the game object itself and return that same
  // object: the step closures mutate `game`, so the caller must hold the
  // very same object or it would read stale numbers (wanted, money, car).
  Object.assign(game, {
    step,
    emit,
    addWanted,
    burst,
    giveCar,
    nearestCar,
    tryEnterCar,
    exitCar,
    punch,
    shoot,
    startMissionAt,
    startMission: startMissionAt,
    finishMission,
    save,
    respawn,
  });
  return game;
}

export { MISSIONS, STEP };
