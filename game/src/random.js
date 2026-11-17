// A deterministic random source for the city and the screenshot scenes.
// SplitMix32: the same seed always builds the same Palma Verde, so a
// screenshot taken from a seed is repeatable frame for frame.
export function makeRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  function next() {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  }
  // Integer in [min, max), float in [min, max), and one item from a list.
  next.int = (min, max) => min + Math.floor(next() * (max - min));
  next.range = (min, max) => min + next() * (max - min);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  return next;
}

/** Cheap hash of a string into a 32-bit seed, for naming things by place. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
