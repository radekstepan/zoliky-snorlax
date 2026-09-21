/* ------------------------------------------------------------------ */
/*  ŽOLÍKY — retro chiptune SFX (WebAudio, no assets)                 */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = typeof localStorage !== "undefined" && localStorage.getItem("zoliky-muted") === "1";

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  delay?: number;
  slideTo?: number;
}

function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  if (muted) return;
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slideTo), t0 + dur);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(opts.vol ?? 0.12, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  get muted() {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    try {
      localStorage.setItem("zoliky-muted", muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return muted;
  },
  select() {
    tone(620, 0.05, { type: "square", vol: 0.06 });
  },
  draw() {
    tone(340, 0.08, { type: "triangle", vol: 0.14, slideTo: 220 });
    tone(520, 0.05, { type: "square", vol: 0.05, delay: 0.05 });
  },
  /** soft tick when a picked-up card leaves the pile */
  pickTick() {
    tone(920, 0.035, { type: "square", vol: 0.045 });
  },
  /** soft thock when the flying card lands in its hand slot */
  land() {
    tone(210, 0.09, { type: "triangle", vol: 0.16, slideTo: 120 });
    tone(1250, 0.02, { type: "square", vol: 0.035 });
  },
  discard() {
    tone(240, 0.09, { type: "square", vol: 0.1, slideTo: 150 });
  },
  meld() {
    tone(523, 0.07, { type: "square", vol: 0.09 });
    tone(659, 0.07, { type: "square", vol: 0.09, delay: 0.06 });
    tone(784, 0.1, { type: "square", vol: 0.1, delay: 0.12 });
  },
  layoff() {
    tone(880, 0.06, { type: "square", vol: 0.08 });
  },
  swap() {
    tone(440, 0.06, { type: "square", vol: 0.08 });
    tone(660, 0.08, { type: "square", vol: 0.08, delay: 0.06 });
  },
  error() {
    tone(130, 0.16, { type: "sawtooth", vol: 0.11, slideTo: 90 });
  },
  close() {
    tone(392, 0.1, { type: "triangle", vol: 0.14 });
    tone(523, 0.1, { type: "triangle", vol: 0.14, delay: 0.09 });
    tone(659, 0.1, { type: "triangle", vol: 0.14, delay: 0.18 });
    tone(784, 0.22, { type: "triangle", vol: 0.16, delay: 0.27 });
  },
  roundEnd() {
    tone(523, 0.09, { type: "square", vol: 0.1 });
    tone(392, 0.09, { type: "square", vol: 0.1, delay: 0.1 });
    tone(330, 0.18, { type: "square", vol: 0.11, delay: 0.2 });
  },
  win() {
    const seq = [523, 587, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) =>
      tone(f, 0.12, { type: "square", vol: 0.1, delay: i * 0.11 })
    );
  },
  lose() {
    const seq = [392, 370, 349, 330];
    seq.forEach((f, i) =>
      tone(f, 0.16, { type: "triangle", vol: 0.11, delay: i * 0.14 })
    );
  },
  click() {
    tone(700, 0.04, { type: "square", vol: 0.05 });
  },
  reshuffle() {
    tone(180, 0.2, { type: "sawtooth", vol: 0.08, slideTo: 320 });
  },
};
