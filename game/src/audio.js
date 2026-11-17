// All sound is synthesized with WebAudio — no audio files, no network.
// Engine hum, sirens, gunshots, pickups and a small bassline loop are
// built from oscillators and filtered noise, and start on first input.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let musicOn = true;
  let step = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Engine: a low sawtooth whose pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 60;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // Siren: two-tone triangle, silent until the wanted level rises.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      startMusic();
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type = 'sine', vol = 0.25, slideTo = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, vol, lowpass = 1200) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
  }

  // A lazy bassline: root notes of a minor groove, one bar of eight steps.
  const BASSLINE = [55, 0, 55, 65.4, 55, 0, 49, 58.3];
  function startMusic() {
    if (musicTimer !== null) return;
    musicTimer = window.setInterval(() => {
      if (!ctx || !musicOn || ctx.state !== 'running') return;
      const note = BASSLINE[step % BASSLINE.length];
      step += 1;
      if (note) blip(note, 0.22, 'triangle', 0.16);
      if (step % 2 === 0) noiseBurst(0.03, 0.05, 6000); // hat tick
    }, 240);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') void ctx.resume();
    },
    setEngine(speed, driving) {
      if (!ctx) return;
      engineGain.gain.value = driving ? 0.05 + Math.min(0.09, Math.abs(speed) * 0.0016) : 0;
      engineOsc.frequency.value = 55 + Math.abs(speed) * 2.4;
    },
    setSiren(wanted, time) {
      if (!ctx) return;
      sirenGain.gain.value = wanted > 0 ? 0.035 : 0;
      sirenOsc.frequency.value = Math.floor(time * 2.4) % 2 === 0 ? 660 : 880;
    },
    setMusic(on) {
      musicOn = on;
    },
    toggleMusic() {
      musicOn = !musicOn;
      return musicOn;
    },
    shoot() { noiseBurst(0.12, 0.4, 2400); blip(220, 0.08, 'square', 0.18, 60); },
    punch() { noiseBurst(0.08, 0.25, 900); },
    pickup() { blip(660, 0.09, 'sine', 0.22); blip(990, 0.14, 'sine', 0.22); },
    crash() { noiseBurst(0.25, 0.4, 700); },
    missionDone() {
      blip(523, 0.12, 'triangle', 0.25);
      window.setTimeout(() => blip(659, 0.12, 'triangle', 0.25), 120);
      window.setTimeout(() => blip(784, 0.22, 'triangle', 0.25), 240);
    },
    missionFail() { blip(220, 0.3, 'sawtooth', 0.2, 110); },
    phone() { blip(880, 0.1, 'sine', 0.2); window.setTimeout(() => blip(880, 0.1, 'sine', 0.2), 160); },
    busted() { blip(330, 0.4, 'sawtooth', 0.25, 165); },
    click() { blip(440, 0.05, 'square', 0.12); },
  };
}
