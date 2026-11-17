// The story: five jobs from Mara Solis, a fixer who runs Palma Verde's
// night economy. Each mission has an intro call, one or more objectives
// (go here, grab that, survive this), a time limit where it matters, and
// a payout. The game tracks which job is next and saves it.
import { roadLines } from './city.js';
import { hashSeed, makeRng } from './random.js';

export const MISSIONS = [
  {
    id: 'wheels',
    title: 'First Wheels',
    caller: 'Mara Solis',
    call: 'Dario, you are back in Palma Verde and still on foot? Steal a car — any car — and bring it to my safehouse. Try not to make the cops your welcoming committee.',
    objective: 'Steal any car and drive it to the safehouse',
    reward: 150,
    wantedOnStart: 0,
    timeLimit: 0,
    kind: 'drive-to',
    place: 'safehouse',
  },
  {
    id: 'packages',
    title: 'Package Run',
    caller: 'Mara Solis',
    call: 'Three packages are stashed around the city. Pick them all up and bring them to the plaza. The boys who hid them are... unreliable. Watch the streets.',
    objective: 'Collect 3 packages, then reach Plaza Verde',
    reward: 250,
    wantedOnStart: 0,
    timeLimit: 0,
    kind: 'collect',
    count: 3,
    place: 'plaza',
  },
  {
    id: 'pursuit',
    title: 'Hot Pursuit',
    caller: 'Mara Solis',
    call: 'The Verde PD just put your face on every screen in town. Lose them — stay out of sight for 45 seconds — or make it to the docks. Your call, hotshot.',
    objective: 'Lose the police: stay unseen for 45s or reach the docks',
    reward: 400,
    wantedOnStart: 3,
    timeLimit: 0,
    kind: 'escape',
    place: 'docks',
    escapeSeconds: 45,
  },
  {
    id: 'drop',
    title: 'The Drop',
    caller: 'Mara Solis',
    call: 'A courier case at the bank, a buyer at the marina. Ninety seconds, and the cops already know the route. Drive like the tide is chasing you.',
    objective: 'Grab the case at Verde Bank, deliver it to the docks in 90s',
    reward: 600,
    wantedOnStart: 2,
    timeLimit: 90,
    kind: 'fetch-deliver',
    from: 'bank',
    place: 'docks',
  },
  {
    id: 'heist',
    title: 'Bay Heist',
    caller: 'Mara Solis',
    call: 'Last one, Dario. Verde Bank, noon rush, four stars before you even touch the door. Take the cash, get to the safehouse, and we never speak of this again.',
    objective: 'Rob Verde Bank, then escape to the safehouse',
    reward: 1200,
    wantedOnStart: 4,
    timeLimit: 0,
    kind: 'fetch-deliver',
    from: 'bank',
    place: 'safehouse',
  },
];

export function createMissionState() {
  return {
    index: 0, // next mission to play
    active: null, // runtime state of the running mission
    done: [], // completed mission ids
    callPending: null, // a phone call waiting to be answered
    callTimer: 0,
  };
}

/** Start the next mission: returns its runtime state.
 * `seed` is the game's seed: package targets are drawn from a PRNG keyed
 * on it, never Math.random, so the same seed always stashes the packages
 * in the same streets and the mission screenshot is reproducible. */
export function startMission(missions, index, city, seed = 1) {
  const def = missions[index];
  const state = {
    def,
    phase: def.kind === 'fetch-deliver' ? 'fetch' : 'go',
    collected: 0,
    timer: def.timeLimit,
    escapeTimer: def.escapeSeconds || 0,
    unseenTimer: 0,
    targets: [],
  };
  if (def.kind === 'collect') {
    // Stash the packages ON THE ROADS, never inside a block: a package
    // inside a building could never be reached.
    const rng = makeRng((seed ^ hashSeed(def.id)) >>> 0);
    const lines = roadLines();
    const used = new Set();
    while (state.targets.length < def.count) {
      const line = lines[rng.int(0, lines.length)];
      const t = -city.half + rng.range(0, city.half * 2);
      const key = `${Math.round(line)},${Math.round(t / 40)}`;
      if (used.has(key)) continue;
      used.add(key);
      const alongX = rng.chance(0.5);
      state.targets.push({
        x: alongX ? t : line,
        z: alongX ? line : t,
        taken: false,
      });
    }
  }
  return state;
}

/** Where the player must go right now, or null when there is no target. */
export function missionMarker(missions, state, city) {
  if (!state) return null;
  const def = state.def;
  if (def.kind === 'drive-to' || def.kind === 'escape') {
    return { ...city.places[def.place], color: '#ffd21f' };
  }
  if (def.kind === 'collect') {
    if (state.collected < def.count) {
      const next = state.targets.find((t) => !t.taken);
      if (next) return { x: next.x, z: next.z, label: 'Package', color: '#ffd21f' };
    }
    return { ...city.places[def.place], color: '#ffd21f' };
  }
  if (def.kind === 'fetch-deliver') {
    if (state.phase === 'fetch') return { ...city.places[def.from], color: '#ff8c2e' };
    return { ...city.places[def.place], color: '#ffd21f' };
  }
  return null;
}

/** Objective text shown under the HUD while a mission runs. */
export function missionObjectiveText(state) {
  if (!state) return '';
  const def = state.def;
  if (def.kind === 'collect') {
    if (state.collected < def.count) return `Packages: ${state.collected}/${def.count} — follow the beacon`;
    return `All packages collected — get to ${def.place === 'plaza' ? 'Plaza Verde' : def.place}`;
  }
  if (def.kind === 'fetch-deliver') {
    if (state.phase === 'fetch') return 'Grab the case at Verde Bank';
    return `Deliver the case to ${def.place === 'docks' ? 'the Marina Docks' : 'the safehouse'}`;
  }
  if (def.kind === 'escape') {
    return `Stay unseen: ${Math.max(0, Math.ceil(state.escapeTimer))}s — or reach the docks`;
  }
  return def.objective;
}
