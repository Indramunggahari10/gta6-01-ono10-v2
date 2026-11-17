// The HUD: money, health and armour bars, wanted stars, speed, the
// mission objective line, toasts, the phone-call overlay, the menus — and
// the minimap, a live top-down map of the city with the player, the police
// and the mission beacon on it. All DOM, drawn over the 3D canvas.
import { CITY, PALETTE } from './config.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud(city) {
  const minimap = el('minimap');
  const mctx = minimap ? minimap.getContext('2d') : null;
  const moneyEl = el('hud-money');
  const healthFill = el('hud-health-fill');
  const armorFill = el('hud-armor-fill');
  const ammoEl = el('hud-ammo');
  const starsEl = el('hud-stars');
  const speedEl = el('hud-speed');
  const objectiveEl = el('hud-objective');
  const missionEl = el('hud-mission');
  const toastEl = el('hud-toast');
  const clockEl = el('hud-clock');
  let toastTimer = 0;

  function drawMinimap(state) {
    if (!mctx) return;
    const size = minimap.width;
    const half = city.half + 30;
    const scale = size / (half * 2);
    const toMap = (x, z) => [(x + half) * scale, (z + half) * scale];
    mctx.clearRect(0, 0, size, size);
    // Sea and land.
    mctx.fillStyle = '#12333d';
    mctx.fillRect(0, 0, size, size);
    const [lx, lz] = toMap(-city.half - 14, -city.half - 14);
    mctx.fillStyle = '#2a4a2e';
    mctx.fillRect(lx, lz, (city.half * 2 + 28) * scale, (city.half * 2 + 28) * scale);
    // Blocks, from the same grid the city is built on.
    mctx.fillStyle = '#5a5f66';
    for (let bx = 0; bx < CITY.blocks; bx += 1) {
      for (let bz = 0; bz < CITY.blocks; bz += 1) {
        const [x, z] = toMap(-city.half + bx * city.pitch, -city.half + bz * city.pitch);
        mctx.fillRect(x, z, CITY.block * scale, CITY.block * scale);
      }
    }
    // Mission beacon.
    if (state.marker) {
      const [mx, mz] = toMap(state.marker.x, state.marker.z);
      mctx.fillStyle = '#ffd21f';
      mctx.save();
      mctx.translate(mx, mz);
      mctx.rotate(Math.PI / 4);
      mctx.fillRect(-5, -5, 10, 10);
      mctx.restore();
    }
    // Police blips (red) and traffic (grey).
    for (const cop of state.cops) {
      const [cx, cz] = toMap(cop.x, cop.z);
      mctx.fillStyle = '#ff2e3e';
      mctx.beginPath();
      mctx.arc(cx, cz, 4, 0, Math.PI * 2);
      mctx.fill();
    }
    for (const car of state.cars) {
      if (car.police) continue;
      const [cx, cz] = toMap(car.x, car.z);
      mctx.fillStyle = 'rgba(220,220,220,0.7)';
      mctx.fillRect(cx - 1.5, cz - 1.5, 3, 3);
    }
    // Player arrow.
    const [px, pz] = toMap(state.player.x, state.player.z);
    mctx.save();
    mctx.translate(px, pz);
    mctx.rotate(Math.atan2(Math.sin(state.player.yaw), Math.cos(state.player.yaw)) + Math.PI);
    mctx.fillStyle = '#ffffff';
    mctx.beginPath();
    mctx.moveTo(0, -8);
    mctx.lineTo(5, 6);
    mctx.lineTo(-5, 6);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
    // North tick.
    mctx.fillStyle = '#ffffff';
    mctx.font = 'bold 11px system-ui, sans-serif';
    mctx.textAlign = 'left';
    mctx.fillText('N', 6, 14);
  }

  function stars(wanted) {
    let out = '';
    for (let i = 0; i < 5; i += 1) out += i < wanted ? '★' : '☆';
    return out;
  }

  function clock(timeOfDay) {
    const total = Math.floor(timeOfDay * 24 * 60);
    const hh = String(Math.floor(total / 60)).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  return {
    update(state, dt) {
      if (moneyEl) moneyEl.textContent = `$${Math.floor(state.money).toLocaleString('en-US')}`;
      if (healthFill) healthFill.style.width = `${Math.max(0, state.health)}%`;
      if (armorFill) armorFill.style.width = `${Math.max(0, state.armor)}%`;
      if (ammoEl) ammoEl.textContent = state.driving ? '' : `Ammo ${state.ammo}`;
      if (starsEl) {
        starsEl.textContent = stars(state.wanted);
        starsEl.style.color = state.wanted > 0 ? PALETTE.wantedStar : 'rgba(255,255,255,0.4)';
      }
      if (speedEl) speedEl.textContent = state.driving ? `${Math.round(Math.abs(state.speed) * 2.4)} km/h` : '';
      if (objectiveEl) objectiveEl.textContent = state.objective || '';
      if (missionEl) missionEl.textContent = state.missionTitle || '';
      if (clockEl) clockEl.textContent = clock(state.timeOfDay);
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0 && toastEl) toastEl.textContent = '';
      }
      drawMinimap(state);
    },
    toast(message, seconds = 3) {
      if (!toastEl) return;
      toastEl.textContent = message;
      toastTimer = seconds;
    },
    showPhone(caller, text) {
      const phone = el('phone');
      const name = el('phone-caller');
      const body = el('phone-text');
      if (!phone) return;
      if (name) name.textContent = `Incoming call — ${caller}`;
      if (body) body.textContent = text;
      phone.classList.remove('hidden');
    },
    hidePhone() {
      const phone = el('phone');
      if (phone) phone.classList.add('hidden');
    },
    showScreen(name, data = {}) {
      for (const id of ['title', 'pause', 'over', 'help']) {
        const panel = el(`screen-${id}`);
        if (panel) panel.classList.toggle('hidden', id !== name);
      }
      if (name === 'over') {
        const title = el('over-title');
        const body = el('over-text');
        if (title) title.textContent = data.title || 'WASTED';
        if (body) body.textContent = data.text || '';
      }
      if (name === 'title') {
        const best = el('title-best');
        if (best) best.textContent = data.best ? `Best haul: $${data.best.toLocaleString('en-US')}` : '';
        const progress = el('title-progress');
        if (progress) progress.textContent = data.progress || '';
      }
    },
    hideScreens() {
      for (const id of ['title', 'pause', 'over', 'help']) {
        const panel = el(`screen-${id}`);
        if (panel) panel.classList.add('hidden');
      }
    },
  };
}
