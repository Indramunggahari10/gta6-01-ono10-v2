// Palma Verde itself: a 9x9 grid of blocks ringed by a coastal road, built
// once from a seed and then frozen. Every building, palm, landmark and
// pickup spot is decided here; the renderer and the traffic only read it.
import { CITY } from './config.js';
import { makeRng } from './random.js';

const PITCH = CITY.block + CITY.road; // 58: one block plus its road
const HALF = (CITY.blocks * PITCH) / 2; // city spans -HALF .. +HALF
const WALL_COLORS = [
  '#e8b48c', '#d99a6c', '#f2d5a0', '#c97e6d', '#a8c8d8', '#e0a899',
  '#f5e6c8', '#b8d0a0', '#d8b8d0', '#e8c890', '#9fb8c8', '#e8a878',
];
const TOWER_COLORS = ['#7fa8c8', '#a8b8c8', '#c8a888', '#88a8b8', '#b8a8c8'];
const ROOF_COLORS = ['#3a3f4a', '#5a4a3a', '#2e4a5a', '#6a5a4a'];

/** Road centre lines (x or z) across the city, including the ring road. */
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= CITY.blocks; i += 1) lines.push(-HALF + i * PITCH - CITY.road / 2);
  return lines;
}

/** Is (x, z) on a road (within the asphalt, not the sidewalk)? */
export function onRoad(x, z) {
  const lines = roadLines();
  for (const line of lines) {
    if (Math.abs(x - line) < CITY.road / 2 - 0.5) return true;
    if (Math.abs(z - line) < CITY.road / 2 - 0.5) return true;
  }
  return false;
}

/** The nearest point on the road network to (x, z), snapped to a lane. */
export function snapToRoad(x, z, lane = 3.2) {
  const lines = roadLines();
  let bestX = lines[0];
  let bestZ = lines[0];
  for (const line of lines) {
    if (Math.abs(x - line) < Math.abs(x - bestX)) bestX = line;
    if (Math.abs(z - line) < Math.abs(z - bestZ)) bestZ = line;
  }
  const dx = Math.abs(x - bestX);
  const dz = Math.abs(z - bestZ);
  if (dx <= dz) return { x: bestX + lane, z, alongX: false };
  return { x, z: bestZ + lane, alongX: true };
}

export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const palms = [];
  const parks = [];
  const lamps = [];

  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const x0 = -HALF + bx * PITCH;
      const z0 = -HALF + bz * PITCH;
      const cx = x0 + CITY.block / 2;
      const cz = z0 + CITY.block / 2;
      const distCentre = Math.hypot(cx, cz) / HALF; // 0 downtown, 1 edge
      // A few blocks stay open as parks and plazas.
      if (rng.chance(0.09)) {
        parks.push({ x: x0, z: z0, w: CITY.block, d: CITY.block });
        for (let p = 0; p < 5; p += 1) {
          palms.push({ x: x0 + 6 + rng.range(0, CITY.block - 12), z: z0 + 6 + rng.range(0, CITY.block - 12), h: rng.range(7, 11) });
        }
        continue;
      }
      const downtown = distCentre < 0.35;
      const tower = downtown && rng.chance(0.55);
      const count = tower ? 1 : rng.int(1, 4);
      if (count === 1) {
        const h = tower
          ? rng.range(30, CITY.maxHeight)
          : rng.range(CITY.minHeight, 22);
        buildings.push({
          x: x0 + 3, z: z0 + 3, w: CITY.block - 6, d: CITY.block - 6, h,
          color: tower ? rng.pick(TOWER_COLORS) : rng.pick(WALL_COLORS),
          roof: rng.pick(ROOF_COLORS), tower,
        });
      } else {
        // Split the block into a 2x2 of shopfronts and low flats.
        const half = CITY.block / 2;
        for (let qx = 0; qx < 2; qx += 1) {
          for (let qz = 0; qz < 2; qz += 1) {
            if (rng.chance(0.18)) continue; // courtyard gap
            buildings.push({
              x: x0 + qx * half + 2, z: z0 + qz * half + 2,
              w: half - 4, d: half - 4, h: rng.range(CITY.minHeight, downtown ? 26 : 15),
              color: rng.pick(WALL_COLORS), roof: rng.pick(ROOF_COLORS), tower: false,
            });
          }
        }
      }
      // Palms at the block's corners and lamps along its roads.
      for (let c = 0; c < 2; c += 1) {
        palms.push({
          x: x0 + (rng.chance(0.5) ? 2 : CITY.block - 2),
          z: z0 + (rng.chance(0.5) ? 2 : CITY.block - 2),
          h: rng.range(6, 10),
        });
      }
    }
  }

  // Lamps stand on every road crossing.
  for (const lx of roadLines()) {
    for (const lz of roadLines()) {
      lamps.push({ x: lx + CITY.road / 2 - 1, z: lz + CITY.road / 2 - 1 });
    }
  }

  // Named places the missions and the HUD point at. Every one sits on a
  // road or a road crossing — never inside a block — so the player can
  // always drive or walk right up to it (the old safehouse spawned inside
  // a building and the player could not move at all).
  const places = {
    safehouse: { x: -152, z: 152, label: 'Safehouse' },
    garage: { x: 196, z: -94, label: 'Spray Shop' },
    gunshop: { x: -94, z: -210, label: 'Ammo Mart' },
    docks: { x: -268, z: 251, label: 'Marina Docks' },
    bank: { x: 22, z: -36, label: 'Verde Bank' },
    plaza: { x: 22, z: 22, label: 'Plaza Verde' },
    beach: { x: -HALF - 24, z: 0, label: 'Palma Beach' },
  };

  // Pickup spots: health, armour, cash and ammo on the sidewalks beside
  // the roads, never inside a building where they could not be reached.
  const pickups = [];
  const kinds = ['health', 'armor', 'cash', 'ammo'];
  const lines = roadLines();
  for (let i = 0; i < 26; i += 1) {
    const line = lines[rng.int(0, lines.length)];
    const alongX = rng.chance(0.5);
    const t = rng.range(-HALF + 10, HALF - 10);
    const side = rng.chance(0.5) ? 8.5 : -8.5; // sidewalk, just off the asphalt
    pickups.push({
      kind: kinds[i % kinds.length],
      x: alongX ? t : line + side,
      z: alongX ? line + side : t,
      taken: false,
      bob: rng.range(0, 6.28),
    });
  }

  return { buildings, palms, parks, lamps, places, pickups, half: HALF, pitch: PITCH };
}

/** Push a circle out of every building it overlaps. Returns true on a hit. */
export function collideBuildings(city, pos, radius) {
  let hit = false;
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
    const cz = Math.max(b.z, Math.min(pos.z, b.z + b.d));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Dead centre: push out along the shallowest side.
      const pushes = [
        [b.x - radius - pos.x, 0], [b.x + b.w + radius - pos.x, 0],
        [0, b.z - radius - pos.z], [0, b.z + b.d + radius - pos.z],
      ];
      pushes.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
      pos.x += pushes[0][0];
      pos.z += pushes[0][1];
    }
  }
  return hit;
}

/** Clamp a position inside the drivable city (the sea stops you west). */
export function clampToCity(city, pos, radius) {
  const min = -city.half - CITY.road - radius;
  const max = city.half + CITY.road + radius;
  pos.x = Math.max(min, Math.min(max, pos.x));
  pos.z = Math.max(min, Math.min(max, pos.z));
}
