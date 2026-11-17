// The 3D view: a small software renderer on a 2D canvas. No library, no
// WebGL — every building, car and palm is projected by hand and painted
// far-to-near, which keeps the whole game in plain static files.
import { CITY, PALETTE, VIEW } from './config.js';

// --- colour helpers -------------------------------------------------------
// Parses '#rrggbb' and the 'rgb(r,g,b)' strings mixHex returns, since
// skyColors mixes already-mixed colours (day into dusk into night).
function hexRgb(color) {
  if (color.charAt(0) === '#') {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  }
  const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function mixHex(a, b, t) {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  const r = clampByte(ca[0] + (cb[0] - ca[0]) * t);
  const g = clampByte(ca[1] + (cb[1] - ca[1]) * t);
  const bl = clampByte(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function shade(hex, f) {
  const c = hexRgb(hex);
  const r = clampByte(c[0] * f);
  const g = clampByte(c[1] * f);
  const b = clampByte(c[2] * f);
  return `rgb(${r},${g},${b})`;
}

// --- camera ---------------------------------------------------------------
export function makeCamera() {
  return { x: 0, y: 6, z: 0, yaw: 0, pitch: 0.32, focal: 600 };
}

/** Chase camera: sits behind the heading, smoothed toward its target. */
export function chaseCamera(cam, tx, ty, tz, yaw, dist, height, pitch, dt) {
  const k = 1 - Math.exp(-6 * dt);
  const bx = tx - Math.sin(yaw) * dist;
  const bz = tz - Math.cos(yaw) * dist;
  cam.x += (bx - cam.x) * k;
  cam.y += (ty + height - cam.y) * k;
  cam.z += (bz - cam.z) * k;
  cam.yaw = yaw;
  cam.pitch = pitch;
}

/** Project a world point to screen space; null when behind the camera. */
export function project(cam, w, h, x, y, z) {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  // Camera-space axes: forward (sin, 0, cos), right (cos, 0, -sin).
  const xc = dx * cy - dz * sy;
  const zc = dx * sy + dz * cy;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const yc = dy * cp + zc * sp;
  const z2 = zc * cp - dy * sp;
  if (z2 < 0.6) return null;
  const f = cam.focal;
  return { x: w / 2 + (xc / z2) * f, y: h / 2 - (yc / z2) * f, d: z2 };
}

// --- time of day ----------------------------------------------------------
/** t in [0,1): 0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk. */
export function daylight(t) {
  const sun = Math.sin(t * Math.PI * 2 - Math.PI / 2); // 1 at noon, -1 at midnight
  return Math.max(0, Math.min(1, (sun + 0.25) / 0.9));
}
export function skyColors(t) {
  const day = daylight(t);
  const dusk = Math.max(0, 1 - Math.abs(Math.sin(t * Math.PI * 2 - Math.PI / 2)) * 2.4);
  let top = mixHex(PALETTE.skyNightTop, PALETTE.skyDayTop, day);
  let bot = mixHex(PALETTE.skyNightBottom, PALETTE.skyDayBottom, day);
  if (dusk > 0) {
    top = mixHex(top, PALETTE.skyDuskTop, dusk * 0.8);
    bot = mixHex(bot, PALETTE.skyDuskBottom, dusk * 0.8);
  }
  return { top, bot, day, dusk };
}
function sunPosition(t, w, h) {
  const a = t * Math.PI * 2;
  return { x: w * (0.5 + 0.38 * Math.cos(a)), y: h * (0.42 - 0.34 * Math.sin(a)) };
}

// --- the renderer ---------------------------------------------------------
export function createRenderer3D(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = makeCamera();
  let stars = null;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    cam.focal = (canvas.height / 2) / Math.tan(((VIEW.fov / 2) * Math.PI) / 180);
  }
  resize();
  window.addEventListener('resize', resize);

  function quad(points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
  }

  /** Project a polygon to screen space, clipping it against the near plane
   * (z2 >= 0.6) first: without the clip, any quad with one corner behind
   * the camera — the ground plane, a road, a building face the chase camera
   * sits beside — would vanish whole. Returns null when fully behind. */
  function clipProject(pts) {
    const sy = Math.sin(cam.yaw);
    const cy = Math.cos(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    let poly = pts.map((p) => {
      const dx = p[0] - cam.x;
      const dy = p[1] - cam.y;
      const dz = p[2] - cam.z;
      const xc = dx * cy - dz * sy;
      const zc = dx * sy + dz * cy;
      return { xc, yc: dy * cp + zc * sp, z2: zc * cp - dy * sp };
    });
    const NEAR = 0.6;
    const kept = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const aIn = a.z2 >= NEAR;
      const bIn = b.z2 >= NEAR;
      if (aIn) kept.push(a);
      if (aIn !== bIn) {
        const t = (NEAR - a.z2) / (b.z2 - a.z2);
        kept.push({ xc: a.xc + (b.xc - a.xc) * t, yc: a.yc + (b.yc - a.yc) * t, z2: NEAR });
      }
    }
    if (kept.length < 3) return null;
    const w = canvas.width;
    const h = canvas.height;
    return kept.map((q) => ({
      x: w / 2 + (q.xc / q.z2) * cam.focal,
      y: h / 2 - (q.yc / q.z2) * cam.focal,
      d: q.z2,
    }));
  }

  /** Ground quad at y=0.02 from world rect, or null when off-screen. */
  function groundQuad(x0, z0, x1, z1, fill) {
    const p = clipProject([[x0, 0.02, z0], [x1, 0.02, z0], [x1, 0.02, z1], [x0, 0.02, z1]]);
    if (!p) return;
    quad(p, fill);
  }

  /** Draw one box face (4 world points) with a shade factor. */
  function boxFace(pts, fill, depthShade) {
    const p = clipProject(pts);
    if (!p) return null;
    const d = p.reduce((s, q) => s + q.d, 0) / p.length;
    const faded = shade(fill, Math.max(0.45, 1 - (d / 320) * 0.45) * depthShade);
    quad(p, faded);
    return { d, p };
  }

  function drawBuilding(b, day, list) {
    const { x, z, w: bw, d: bd, h: bh } = b;
    const cx = x + bw / 2;
    const cz = z + bd / 2;
    const dx = cx - cam.x;
    const dz = cz - cam.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 300) return;
    const corners = [
      [x, 0, z], [x + bw, 0, z], [x + bw, 0, z + bd], [x, 0, z + bd],
      [x, bh, z], [x + bw, bh, z], [x + bw, bh, z + bd], [x, bh, z + bd],
    ];
    // Faces: [corner indices, shade, isRoof]. A face shows when its outward
    // normal points toward the camera (dot with view direction < 0).
    const faces = [
      { idx: [0, 1, 5, 4], n: [0, 0, -1], s: 0.82 }, // north wall
      { idx: [1, 2, 6, 5], n: [1, 0, 0], s: 0.72 }, // east wall
      { idx: [2, 3, 7, 6], n: [0, 0, 1], s: 0.9 }, // south wall
      { idx: [3, 0, 4, 7], n: [-1, 0, 0], s: 0.64 }, // west wall
      { idx: [4, 5, 6, 7], n: [0, 1, 0], s: 1.0, roof: true }, // roof
    ];
    const toCam = [-dx, 0, -dz];
    for (const f of faces) {
      const dot = f.n[0] * toCam[0] + f.n[2] * toCam[2];
      if (!f.roof && dot <= 0) continue;
      const pts = f.idx.map((i) => corners[i]);
      const lit = f.roof ? PALETTE.buildingRoof : b.color;
      const drawn = boxFace(pts, lit, f.s * (0.55 + 0.45 * day));
      if (!drawn || f.roof) continue;
      // Windows: a grid of lit dots on the wall, denser up close.
      if (dist > 170) continue;
      const rows = Math.max(1, Math.floor(bh / 4.5));
      const cols = Math.max(1, Math.floor(Math.max(bw, bd) / 4));
      const step = rows * cols > 48 ? 2 : 1;
      const a = corners[f.idx[0]];
      const bb = corners[f.idx[1]];
      const cc = corners[f.idx[2]];
      for (let r = 0; r < rows; r += step) {
        for (let c = 0; c < cols; c += step) {
          const u = (c + 0.5) / cols;
          const v = (r + 0.5) / rows;
          const wx = a[0] + (bb[0] - a[0]) * u + (cc[0] - bb[0]) * v;
          const wy = a[1] + (bb[1] - a[1]) * u + (cc[1] - bb[1]) * v;
          const wz = a[2] + (bb[2] - a[2]) * u + (cc[2] - bb[2]) * v;
          const wp = project(cam, canvas.width, canvas.height, wx, wy, wz);
          if (!wp) continue;
          const litWin = ((r * 7 + c * 3 + Math.floor(bh)) % 5 === 0) && day < 0.75;
          ctx.fillStyle = litWin ? PALETTE.windowLit : shade(PALETTE.windowDark, 0.55 + 0.45 * day);
          const s = Math.max(1.5, 260 / wp.d);
          ctx.fillRect(wp.x - s / 2, wp.y - s / 2, s, s * 1.3);
        }
      }
    }
    void list;
  }

  function drawPalm(p, day, list) {
    const base = project(cam, canvas.width, canvas.height, p.x, 0, p.z);
    if (!base || base.d > 260) return;
    list.push({
      d: base.d,
      draw() {
        const top = project(cam, canvas.width, canvas.height, p.x, p.h, p.z);
        if (!top) return;
        const s = 320 / base.d;
        ctx.strokeStyle = shade('#7a5a38', 0.6 + 0.4 * day);
        ctx.lineWidth = Math.max(1, s * 0.14);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.strokeStyle = shade('#3f8f4f', 0.6 + 0.4 * day);
        ctx.lineWidth = Math.max(1, s * 0.1);
        for (let f = 0; f < 5; f += 1) {
          const a = (f / 5) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(top.x + Math.cos(a) * s * 0.9, top.y + Math.sin(a) * s * 0.45 + s * 0.3);
          ctx.stroke();
        }
      },
    });
  }

  function drawLamp(l, day, list, time) {
    const base = project(cam, canvas.width, canvas.height, l.x, 0, l.z);
    if (!base || base.d > 220) return;
    list.push({
      d: base.d,
      draw() {
        const top = project(cam, canvas.width, canvas.height, l.x, 5.5, l.z);
        if (!top) return;
        ctx.strokeStyle = '#22262c';
        ctx.lineWidth = Math.max(1, 26 / base.d);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        if (day < 0.35) {
          ctx.fillStyle = 'rgba(255, 214, 120, 0.9)';
          ctx.beginPath();
          ctx.arc(top.x, top.y, Math.max(2, 220 / base.d), 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });
  }

  /** A car body as two stacked boxes, drawn as faces far-to-near. */
  function drawCarBody(x, z, yaw, len, wid, hgt, color, day, list, opts = {}) {
    const centre = project(cam, canvas.width, canvas.height, x, 0, z);
    if (!centre || centre.d > 280) return;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const fx = sy;
    const fz = cy;
    const rx = cy;
    const rz = -sy;
    const hl = len / 2;
    const hw = wid / 2;
    function corner(ax, ay, az) {
      return [x + fx * ax + rx * az, ay, z + fz * ax + rz * az];
    }
    const body = [
      corner(-hl, 0, -hw), corner(hl, 0, -hw), corner(hl, 0, hw), corner(-hl, 0, hw),
      corner(-hl, hgt * 0.55, -hw), corner(hl, hgt * 0.55, -hw), corner(hl, hgt * 0.55, hw), corner(-hl, hgt * 0.55, hw),
    ];
    const cabLen = len * 0.42;
    const cab = [
      corner(-cabLen / 2, hgt * 0.55, -hw * 0.82), corner(cabLen / 2, hgt * 0.55, -hw * 0.82),
      corner(cabLen / 2, hgt * 0.55, hw * 0.82), corner(-cabLen / 2, hgt * 0.55, hw * 0.82),
      corner(-cabLen / 2, hgt, -hw * 0.82), corner(cabLen / 2, hgt, -hw * 0.82),
      corner(cabLen / 2, hgt, hw * 0.82), corner(-cabLen / 2, hgt, hw * 0.82),
    ];
    const faces = [
      { b: body, idx: [0, 1, 5, 4], fill: color, s: 0.8 },
      { b: body, idx: [1, 2, 6, 5], fill: color, s: 0.7 },
      { b: body, idx: [2, 3, 7, 6], fill: color, s: 0.9 },
      { b: body, idx: [3, 0, 4, 7], fill: color, s: 0.62 },
      { b: body, idx: [4, 5, 6, 7], fill: color, s: 1.0 },
      { b: cab, idx: [0, 1, 5, 4], fill: '#1c2733', s: 0.85 },
      { b: cab, idx: [1, 2, 6, 5], fill: '#1c2733', s: 0.75 },
      { b: cab, idx: [2, 3, 7, 6], fill: '#1c2733', s: 0.95 },
      { b: cab, idx: [3, 0, 4, 7], fill: '#1c2733', s: 0.68 },
      { b: cab, idx: [4, 5, 6, 7], fill: '#24313d', s: 1.0 },
    ];
    const toCam = [cam.x - x, 0, cam.z - z];
    const drawn = [];
    for (const f of faces) {
      const pts = f.idx.map((i) => f.b[i]);
      // Face normal from the first edge cross the second edge.
      const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
      const e2 = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const dot = n[0] * toCam[0] + n[2] * toCam[2];
      const isTop = Math.abs(n[1]) > Math.abs(n[0]) && Math.abs(n[1]) > Math.abs(n[2]);
      if (!isTop && dot <= 0) continue;
      const p = clipProject(pts);
      if (!p) continue;
      const d = p.reduce((s, q) => s + q.d, 0) / p.length;
      drawn.push({ d, p, fill: f.fill, s: f.s });
    }
    drawn.sort((a, b) => b.d - a.d);
    list.push({
      d: centre.d,
      draw() {
        for (const f of drawn) quad(f.p, shade(f.fill, f.s * (0.55 + 0.45 * day)));
        // Headlights and brake lights.
        const headL = project(cam, canvas.width, canvas.height, x + fx * hl, 0.7, z + rz * hw * 0.7);
        const headR = project(cam, canvas.width, canvas.height, x + fx * hl, 0.7, z - rz * hw * 0.7);
        const tailL = project(cam, canvas.width, canvas.height, x - fx * hl, 0.7, z + rz * hw * 0.7);
        const tailR = project(cam, canvas.width, canvas.height, x - fx * hl, 0.7, z - rz * hw * 0.7);
        if (day < 0.4) {
          ctx.fillStyle = '#fff6c8';
          for (const hp of [headL, headR]) {
            if (!hp) continue;
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, Math.max(1.5, 160 / hp.d), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = opts.braking ? '#ff4040' : '#a02020';
        for (const tp of [tailL, tailR]) {
          if (!tp) continue;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, Math.max(1.5, 140 / tp.d), 0, Math.PI * 2);
          ctx.fill();
        }
        if (opts.police) {
          const phase = Math.floor(opts.time * 4) % 2 === 0;
          const fl = project(cam, canvas.width, canvas.height, x, hgt + 0.4, z);
          if (fl) {
            ctx.fillStyle = phase ? PALETTE.policeLightRed : PALETTE.policeLightBlue;
            ctx.beginPath();
            ctx.arc(fl.x, fl.y, Math.max(3, 420 / fl.d), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (opts.smoke) {
          const sp = project(cam, canvas.width, canvas.height, x - fx * hl * 0.5, hgt + 0.6, z);
          if (sp) {
            ctx.fillStyle = 'rgba(120,120,120,0.5)';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, Math.max(3, 300 / sp.d), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
    });
  }

  /** A walking person as a small billboard figure. */
  function drawFigure(x, z, yaw, color, shirt, day, list, opts = {}) {
    const base = project(cam, canvas.width, canvas.height, x, 0, z);
    if (!base || base.d > 240) return;
    list.push({
      d: base.d,
      draw() {
        const s = 340 / base.d;
        const bob = opts.walking ? Math.sin(opts.time * 9 + opts.phase) * s * 0.12 : 0;
        const head = project(cam, canvas.width, canvas.height, x, 3.1 + bob * 0.4, z);
        if (!head) return;
        // Shadow.
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(base.x, base.y, s * 0.5, s * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        // Legs, torso, head. Legs are mid-grey so the figure reads against
        // dark asphalt; the torso carries the shirt colour.
        ctx.fillStyle = shade('#5a6a7a', 0.6 + 0.4 * day);
        ctx.fillRect(base.x - s * 0.16, base.y - s * 1.1 + Math.abs(bob), s * 0.13, s * 1.1);
        ctx.fillRect(base.x + s * 0.03, base.y - s * 1.1 - Math.abs(bob), s * 0.13, s * 1.1);
        ctx.fillStyle = shade(shirt, 0.6 + 0.4 * day);
        ctx.fillRect(base.x - s * 0.3, base.y - s * 2.2 + bob * 0.3, s * 0.6, s * 1.15);
        ctx.fillStyle = shade(color, 0.6 + 0.4 * day);
        ctx.beginPath();
        ctx.arc(head.x, head.y - s * 0.1, s * 0.28, 0, Math.PI * 2);
        ctx.fill();
        if (opts.fallen) {
          ctx.fillStyle = 'rgba(160,30,30,0.55)';
          ctx.beginPath();
          ctx.ellipse(base.x, base.y, s * 0.7, s * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });
  }

  function drawBeacon(x, z, time, list, color = '#ffd21f') {
    const base = project(cam, canvas.width, canvas.height, x, 0, z);
    if (!base || base.d > 320) return;
    list.push({
      d: base.d,
      draw() {
        const top = project(cam, canvas.width, canvas.height, x, 26, z);
        if (!top) return;
        const grad = ctx.createLinearGradient(0, top.y, 0, base.y);
        grad.addColorStop(0, 'rgba(255,210,31,0)');
        grad.addColorStop(1, 'rgba(255,210,31,0.5)');
        ctx.fillStyle = grad;
        const wdt = Math.max(2, 900 / base.d);
        ctx.fillRect(top.x - wdt / 2, top.y, wdt, base.y - top.y);
        const dia = project(cam, canvas.width, canvas.height, x, 9 + Math.sin(time * 2) * 1.2, z);
        if (!dia) return;
        const r = Math.max(4, 700 / dia.d);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(dia.x, dia.y - r);
        ctx.lineTo(dia.x + r * 0.7, dia.y);
        ctx.lineTo(dia.x, dia.y + r);
        ctx.lineTo(dia.x - r * 0.7, dia.y);
        ctx.closePath();
        ctx.fill();
      },
    });
  }

  function drawPickup(p, time, list) {
    const base = project(cam, canvas.width, canvas.height, p.x, 0, p.z);
    if (!base || base.d > 200) return;
    list.push({
      d: base.d,
      draw() {
        const y = 1.2 + Math.sin(time * 2 + p.bob) * 0.3;
        const pt = project(cam, canvas.width, canvas.height, p.x, y, p.z);
        if (!pt) return;
        const s = Math.max(3, 260 / pt.d);
        const colors = { health: '#3ddc5a', armor: '#4fa8ff', cash: '#ffd21f', ammo: '#ff8c2e' };
        ctx.fillStyle = colors[p.kind] || '#ffffff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, s * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#101418';
        ctx.font = `bold ${Math.max(8, s * 0.7)}px ${'system-ui, sans-serif'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = { health: '+', armor: 'A', cash: '$', ammo: '»' }[p.kind] || '?';
        ctx.fillText(glyph, pt.x, pt.y + 1);
      },
    });
  }

  /** Paint one frame. `scene` carries the world, the player, cars, crowd, cops, particles and the mission marker. */
  function draw(scene, time) {
    const w = canvas.width;
    const h = canvas.height;
    const { top, bot, day } = skyColors(scene.timeOfDay);
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Sun or moon, clouds, and stars at night.
    const sun = sunPosition(scene.timeOfDay, w, h);
    if (day > 0.05) {
      ctx.fillStyle = `rgba(255, 236, 170, ${0.25 + 0.75 * day})`;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, Math.max(14, h * 0.045), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#e8ecf5';
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, Math.max(10, h * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
    if (day < 0.25) {
      if (!stars) {
        stars = [];
        let s = 12345;
        for (let i = 0; i < 90; i += 1) {
          s = (Math.imul(s, 1103515245) + 12345) >>> 0;
          stars.push([(s % 1000) / 1000, ((s >>> 8) % 400) / 1000]);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const st of stars) ctx.fillRect(st[0] * w, st[1] * h, 2, 2);
    }
    ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.25 * day})`;
    for (let c = 0; c < 4; c += 1) {
      const cx = ((time * 6 + c * 317) % (w + 400)) - 200;
      const cy = h * (0.08 + c * 0.05);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 90, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const city = scene.city;
    const half = city.half;
    const road = CITY.road;
    // Ground: grass base, sea to the west, sand beach between sea and ring road.
    groundQuad(-half - 60, -half - 60, half + 60, half + 60, shade(PALETTE.grass, 0.5 + 0.5 * day));
    groundQuad(-half - 320, -half - 60, -half - road, half + 60, shade(PALETTE.sea, 0.5 + 0.5 * day));
    groundQuad(-half - road, -half - 60, -half - road + 8, half + 60, shade(PALETTE.sand, 0.5 + 0.5 * day));
    // Roads.
    const lines = [];
    for (let i = 0; i <= CITY.blocks; i += 1) lines.push(-half + i * city.pitch - road / 2);
    const lo = -half - road;
    const hi = half + road;
    for (const L of lines) {
      groundQuad(L - road / 2, lo, L + road / 2, hi, shade(PALETTE.asphalt, 0.5 + 0.5 * day));
      groundQuad(lo, L - road / 2, hi, L + road / 2, shade(PALETTE.asphalt, 0.5 + 0.5 * day));
    }
    // Lane dashes, only near the camera.
    ctx.fillStyle = shade(PALETTE.asphaltLine, 0.5 + 0.5 * day);
    for (const L of lines) {
      for (let s = lo; s < hi; s += 10) {
        if (Math.abs(s - cam.z) > 160 && Math.abs(L - cam.x) > 160) continue;
        groundQuad(L - 0.3, s, L + 0.3, s + 4, shade(PALETTE.asphaltLine, 0.5 + 0.5 * day));
        groundQuad(s, L - 0.3, s + 4, L + 0.3, shade(PALETTE.asphaltLine, 0.5 + 0.5 * day));
      }
    }
    // Block bases (sidewalk) and parks.
    for (let bx = 0; bx < CITY.blocks; bx += 1) {
      for (let bz = 0; bz < CITY.blocks; bz += 1) {
        const x0 = -half + bx * city.pitch;
        const z0 = -half + bz * city.pitch;
        groundQuad(x0 - 1.5, z0 - 1.5, x0 + CITY.block + 1.5, z0 + CITY.block + 1.5, shade(PALETTE.sidewalk, 0.5 + 0.5 * day));
      }
    }
    for (const park of city.parks) {
      groundQuad(park.x, park.z, park.x + park.w, park.z + park.d, shade(PALETTE.grass, 0.55 + 0.45 * day));
    }

    // Vertical things, far to near.
    const list = [];
    for (const b of city.buildings) drawBuilding(b, day, list);
    for (const p of city.palms) drawPalm(p, day, list);
    for (const l of city.lamps) drawLamp(l, day, list, time);
    for (const p of city.pickups) {
      if (!p.taken) drawPickup(p, time, list);
    }
    for (const car of scene.cars) {
      drawCarBody(car.x, car.z, car.yaw, 5.4, 2.4, 1.5, car.color, day, list, {
        police: car.police, braking: car.braking, smoke: car.health < 35, time,
      });
    }
    for (const ped of scene.peds) {
      drawFigure(ped.x, ped.z, ped.yaw, ped.skin, ped.shirt, day, list, {
        walking: ped.moving, time, phase: ped.phase, fallen: ped.fallen > 0,
      });
    }
    if (scene.playerCar) {
      drawCarBody(scene.playerCar.x, scene.playerCar.z, scene.playerCar.yaw, 5.4, 2.4, 1.5, scene.playerCar.color, day, list, {
        braking: scene.playerCar.braking, smoke: scene.playerCar.health < 35, time,
      });
    } else {
      drawFigure(scene.player.x, scene.player.z, scene.player.yaw, '#c89878', '#d23b3b', day, list, {
        walking: scene.player.moving, time, phase: 0,
      });
    }
    if (scene.marker) drawBeacon(scene.marker.x, scene.marker.z, time, list, scene.marker.color);
    // Particles: muzzle flashes, smoke, explosions.
    for (const pt of scene.particles) {
      const pp = project(cam, w, h, pt.x, pt.y, pt.z);
      if (!pp || pp.d > 260) continue;
      list.push({
        d: pp.d,
        draw() {
          ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, Math.max(2, pt.size * 200 / pp.d), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        },
      });
    }
    list.sort((a, b) => b.d - a.d);
    for (const item of list) item.draw();
  }

  return { cam, draw, resize, project: (x, y, z) => project(cam, canvas.width, canvas.height, x, y, z) };
}
