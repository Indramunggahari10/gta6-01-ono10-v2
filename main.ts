// Palma Verde — the entry program (Node 22, standard library only).
// It hands the game in: copies this repository's game/ and screenshots/
// to /output and writes /output/dossier.json with the vendored make.fun
// library, exactly as the kit's starter does. Outside the grader's
// container, MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The dossier is built from the files as they stand; the program adds
// nothing of its own, so two runs write identical bytes.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's caps (reference/gate.json): a screenshot over 256 KiB, more
// than four of them, or a game/ past its file and byte caps would be
// refused, so refuse loudly here instead of handing in a broken entry.
const SCREENSHOT_LIMIT = 4;
const SCREENSHOT_MAX_BYTES = 262144;
// The gate's pixel caps (reference/gate.json): long side at most 1280,
// short side at least 480. Read the size straight from the PNG IHDR or
// the JPEG start-of-frame marker — no image library, no decoding.
const SHOT_LONG_MAX = 1280;
const SHOT_SHORT_MIN = 480;

function readImageDimensions(path) {
  const buf = readFileSync(path);
  // PNG: 8-byte signature, then IHDR with width/height at bytes 16/20.
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan markers for a start-of-frame (0xC0-0xCF except 0xC4/0xC8/0xCC).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  throw new Error(`screenshot ${path} is not a readable PNG or JPEG`);
}

function checkScreenshots(dir) {
  if (!existsSync(dir)) return;
  const shots = readdirSync(dir).filter((name) => !name.startsWith('.'));
  if (shots.length > SCREENSHOT_LIMIT) {
    throw new Error(`too many screenshots: ${shots.length} (max ${SCREENSHOT_LIMIT})`);
  }
  for (const name of shots) {
    const path = join(dir, name);
    const size = statSync(path).size;
    if (size > SCREENSHOT_MAX_BYTES) {
      throw new Error(`screenshot ${name} is ${size} bytes (max ${SCREENSHOT_MAX_BYTES})`);
    }
    const { width, height } = readImageDimensions(path);
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long > SHOT_LONG_MAX || short < SHOT_SHORT_MIN) {
      throw new Error(`screenshot ${name} is ${width}x${height} (long side max ${SHOT_LONG_MAX}, short side min ${SHOT_SHORT_MIN})`);
    }
  }
}

// The gate refuses symlinks under game/: walk it and refuse loudly here
// instead of handing in an entry the scorer would reject.
function checkNoSymlinks(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`game/ holds a symlink: ${path}`);
    }
    if (statSync(path).isDirectory()) checkNoSymlinks(path);
  }
}

checkScreenshots(join(repoRoot, 'screenshots'));
checkNoSymlinks(join(repoRoot, 'game'));

// The game itself must be there: index.html is the file the gate checks
// first, and a missing one would hand in an empty entry.
if (!existsSync(join(repoRoot, 'game', 'index.html'))) {
  throw new Error('game/index.html is missing');
}

mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

const dossierPath = join(outDir, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// One line of proof the hand-in worked, for the build log.
const dossierBytes = statSync(dossierPath).size;
const dossierSha = createHash('sha256').update(readFileSync(dossierPath)).digest('hex');
const gameFiles = readdirSync(join(outDir, 'game'), { recursive: true }).length;
console.log(`Palma Verde handed in: ${gameFiles} game entries, dossier ${dossierBytes} bytes sha256:${dossierSha} -> ${outDir}`);
