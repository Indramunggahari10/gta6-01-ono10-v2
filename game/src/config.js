// Palma Verde — shared tuning numbers for the whole game.
// One place holds every magic number so the city, the cars, the police
// and the missions all agree on speeds, sizes and money.
export const VIEW = { width: 1280, height: 720, fov: 72 };
export const SAVE_KEY = 'palma-verde-save-v1';
export const BEST_KEY = 'palma-verde-best-v1';

// City grid: blocks are square, roads run between them.
export const CITY = {
  blocks: 9, // blocks across (and down)
  block: 44, // block side in world units
  road: 14, // road width between blocks
  sidewalk: 3, // sidewalk strip around each block
  maxHeight: 46, // tallest tower
  minHeight: 7, // shortest shopfront
};
export const STEP = 1 / 60;

// Player on foot.
export const PLAYER = {
  walkSpeed: 7,
  runSpeed: 11.5,
  radius: 1.1,
  height: 3.4,
  maxHealth: 100,
  punchDamage: 12,
  punchRange: 3.2,
  punchCooldown: 0.45,
  shootCooldown: 0.28,
  bulletDamage: 34,
  bulletRange: 90,
  startAmmo: 24,
  maxAmmo: 120,
};

// Cars.
export const CAR = {
  accel: 26,
  brake: 42,
  reverseAccel: 16,
  maxSpeed: 46,
  maxReverse: 14,
  turnRate: 2.1,
  drag: 0.55,
  grip: 8.5,
  radius: 2.4,
  length: 5.4,
  width: 2.4,
  health: 100,
  policeMaxSpeed: 52,
};

// Traffic and pedestrians.
export const TRAFFIC = { cars: 16, cruiseMin: 9, cruiseMax: 15 };
export const CROWD = { walkers: 26, walkMin: 1.2, walkMax: 2.6 };

// Wanted level.
export const WANTED = {
  max: 5,
  stealCar: 1, // stealing a parked car
  hitPedestrian: 1,
  shoot: 1,
  killCop: 2,
  decaySeconds: 18, // unseen this long drops one star
  copFootSpeed: 8.4,
  copShootRange: 26,
  copShootCooldown: 1.1,
};

// Money and pickups.
export const MONEY = {
  start: 120,
  package: 40,
  repairCost: 80,
  ammoCost: 60,
  bribeCost: 150, // pay-n-spray clears the wanted level
};

// Day / night: one full cycle lasts this many seconds of play.
export const DAY_LENGTH = 360;

// Palette: a sun-soaked coastal city — warm walls, teal water, orange dusk.
export const PALETTE = {
  skyDayTop: '#3f8fd2',
  skyDayBottom: '#bfe3f2',
  skyDuskTop: '#5a3d7a',
  skyDuskBottom: '#ff9e5e',
  skyNightTop: '#0a1026',
  skyNightBottom: '#1c2b4a',
  sea: '#1e7f8e',
  sand: '#e8d29a',
  grass: '#5d9b4f',
  asphalt: '#33373d',
  asphaltLine: '#e8e4c8',
  sidewalk: '#9aa0a3',
  buildingRoof: '#2c2f36',
  windowLit: '#ffd978',
  windowDark: '#20262e',
  hudText: '#ffffff',
  hudPanel: 'rgba(8, 12, 20, 0.62)',
  wantedStar: '#ffd21f',
  policeLightRed: '#ff2e3e',
  policeLightBlue: '#2e7bff',
};

export const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
