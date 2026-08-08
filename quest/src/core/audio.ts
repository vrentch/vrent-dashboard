/**
 * Sound effects, synthesised at runtime.
 *
 * The whole cue set is oscillators, filtered noise and envelopes — there is no
 * audio file anywhere in the bundle. That keeps the APK small, keeps the first
 * sound instant instead of waiting on a decode, and means a white-label build
 * can be re-pitched without re-recording anything.
 *
 * The cues share one key (A, mostly pentatonic) and one register, so two of
 * them landing on the same frame never sound like an accident. Levels are set
 * for a headset at a normal listening volume: the hover tick is almost
 * subliminal, and nothing is allowed to be the loudest thing in the room.
 *
 * Signal path:
 *
 *   oscillators/noise → envelope gain → PositionalAudio panner (spatial cues)
 *                                     ↘ bus → compressor → master → listener
 *
 * The compressor is there purely so a burst of overlapping cues — four cards
 * matching as a streak resolves — cannot clip.
 */

import * as THREE from "three";

export type CueId =
  | "flip"
  | "match"
  | "miss"
  | "hover"
  | "select"
  | "turnStart"
  | "win"
  | "lose"
  | "join"
  | "countdown";

export interface CueOptions {
  /** Multiplier on the cue's designed level. 1 is the intended balance. */
  gain?: number;
  /** Pitch offset in cents; 100 is a semitone. Countdown pips use this. */
  detune?: number;
  /** Seconds to wait before the cue starts. */
  delay?: number;
}

export interface AudioSystem {
  /** Parent this to the camera so the mix follows the head. */
  readonly listener: THREE.AudioListener;
  /**
   * Web Audio starts suspended. Call this from the same user gesture that
   * enters XR; every `play` also nudges it, but the gesture is what unlocks it.
   */
  resume(): Promise<void>;
  /** A cue with no position — UI, stingers, anything head-locked. */
  play(cue: CueId, options?: CueOptions): void;
  /** A cue emitted from a world position or from an object's current position. */
  playAt(cue: CueId, where: THREE.Vector3 | THREE.Object3D, options?: CueOptions): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Master level, 0-1. */
  setVolume(volume: number): void;
  getVolume(): number;
  dispose(): void;
}

const DEFAULT_VOLUME = 0.85;
/** Enough for a streak resolving over a busy board without stealing a tail. */
const VOICE_COUNT = 10;
/** Seconds. Long enough that mute and volume never click. */
const FADE = 0.03;

/** Equal temperament from A4. Every cue is written in semitones from here. */
const A4 = 440;
function note(semitones: number): number {
  return A4 * Math.pow(2, semitones / 12);
}

// ── Synthesis primitives ────────────────────────────────────────────────────

interface Bus {
  ctx: AudioContext;
  dest: AudioNode;
  /** Context time the cue starts. */
  t0: number;
  /** Caller's level multiplier. */
  level: number;
  /** Caller's pitch offset in cents. */
  detune: number;
  noise: AudioBuffer;
}

interface PartialSpec {
  type?: OscillatorType;
  freq: number;
  /** Glide target reached by the end of the decay. */
  freqEnd?: number;
  gain: number;
  attack?: number;
  decay: number;
  delay?: number;
}

/** A single enveloped oscillator. Returns when it finishes, relative to `t0`. */
function partial(bus: Bus, spec: PartialSpec): number {
  const delay = spec.delay ?? 0;
  const attack = spec.attack ?? 0.004;
  const start = bus.t0 + delay;
  const peak = Math.max(0.0002, spec.gain * bus.level);
  const end = start + attack + spec.decay;

  const osc = bus.ctx.createOscillator();
  osc.type = spec.type ?? "sine";
  osc.detune.value = bus.detune;
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), end);
  }

  const env = bus.ctx.createGain();
  // Exponential ramps cannot touch zero, so the envelope runs between a floor
  // and the peak and is cut to silence at the end.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.gain.setValueAtTime(0, end);

  osc.connect(env).connect(bus.dest);
  osc.start(start);
  osc.stop(end + 0.02);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };

  return delay + attack + spec.decay + 0.02;
}

interface NoiseSpec {
  gain: number;
  decay: number;
  delay?: number;
  attack?: number;
  filter?: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
}

/** A burst of filtered noise. Returns when it finishes, relative to `t0`. */
function noiseBurst(bus: Bus, spec: NoiseSpec): number {
  const delay = spec.delay ?? 0;
  const attack = spec.attack ?? 0.002;
  const start = bus.t0 + delay;
  const peak = Math.max(0.0002, spec.gain * bus.level);
  const end = start + attack + spec.decay;

  const src = bus.ctx.createBufferSource();
  src.buffer = bus.noise;
  src.loop = true;

  const filter = bus.ctx.createBiquadFilter();
  filter.type = spec.filter ?? "bandpass";
  filter.Q.value = spec.q ?? 1;
  filter.frequency.setValueAtTime(spec.freq, start);
  if (spec.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), end);
  }

  const env = bus.ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.gain.setValueAtTime(0, end);

  src.connect(filter).connect(env).connect(bus.dest);
  // A random read offset stops forty card flips sounding like one sample.
  src.start(start, Math.random() * bus.noise.duration);
  src.stop(end + 0.02);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    env.disconnect();
  };

  return delay + attack + spec.decay + 0.02;
}

// ── The cue set ─────────────────────────────────────────────────────────────

type Cue = (bus: Bus) => number;

const CUES: Record<CueId, Cue> = {
  // Barely there. It fires on every card the pointer crosses, so anything with
  // a tail would turn scanning the board into a rattle.
  hover: (b) => partial(b, { freq: note(19), gain: 0.045, attack: 0.002, decay: 0.035 }),

  // A click with a fifth in it, so it reads as deliberate rather than as a tick.
  select: (b) =>
    Math.max(
      partial(b, { freq: note(12), gain: 0.13, attack: 0.002, decay: 0.07 }),
      partial(b, { freq: note(19), gain: 0.06, attack: 0.002, decay: 0.05 }),
      noiseBurst(b, { freq: 4200, gain: 0.028, decay: 0.022, filter: "highpass" }),
    ),

  // Physical rather than musical: card stock turning, then settling.
  flip: (b) =>
    Math.max(
      noiseBurst(b, { freq: 700, freqEnd: 2400, q: 0.9, gain: 0.1, decay: 0.13 }),
      partial(b, { freq: 168, freqEnd: 120, gain: 0.095, attack: 0.001, decay: 0.1 }),
    ),

  // Rising fifth with a bell partial on top. Warm, and over quickly.
  match: (b) =>
    Math.max(
      partial(b, { type: "triangle", freq: note(12), gain: 0.1, decay: 0.16 }),
      partial(b, { freq: note(19), gain: 0.075, decay: 0.22, delay: 0.075 }),
      partial(b, { freq: note(24), gain: 0.032, decay: 0.3, delay: 0.075 }),
    ),

  // A step down, not a buzzer. A miss is ordinary; it should not scold.
  miss: (b) =>
    Math.max(
      partial(b, { freq: note(2), gain: 0.085, decay: 0.1 }),
      partial(b, { freq: note(-1), gain: 0.085, decay: 0.2, delay: 0.09 }),
      noiseBurst(b, { freq: 480, gain: 0.045, decay: 0.08, filter: "lowpass", q: 0.7 }),
    ),

  // Swells instead of hitting, so it draws the eye without startling.
  turnStart: (b) =>
    Math.max(
      partial(b, { freq: note(0), gain: 0.07, attack: 0.05, decay: 0.28 }),
      partial(b, { freq: note(7), gain: 0.048, attack: 0.06, decay: 0.3, delay: 0.02 }),
    ),

  win: (b) =>
    Math.max(
      partial(b, { type: "triangle", freq: note(12), gain: 0.085, decay: 0.26 }),
      partial(b, { type: "triangle", freq: note(16), gain: 0.085, decay: 0.26, delay: 0.11 }),
      partial(b, { type: "triangle", freq: note(19), gain: 0.085, decay: 0.3, delay: 0.22 }),
      partial(b, { freq: note(24), gain: 0.04, attack: 0.02, decay: 0.5, delay: 0.22 }),
    ),

  // The same shape inverted and darker. Losing is not a failure sound.
  lose: (b) =>
    Math.max(
      partial(b, { freq: note(7), gain: 0.07, decay: 0.28 }),
      partial(b, { freq: note(3), gain: 0.07, decay: 0.3, delay: 0.12 }),
      partial(b, { freq: note(-2), gain: 0.07, attack: 0.01, decay: 0.42, delay: 0.24 }),
    ),

  join: (b) =>
    Math.max(
      partial(b, { freq: note(7), gain: 0.065, decay: 0.09 }),
      partial(b, { freq: note(12), gain: 0.065, decay: 0.16, delay: 0.08 }),
    ),

  // One pip. The caller raises the pitch for each step and for the go.
  countdown: (b) =>
    Math.max(
      partial(b, { freq: note(12), gain: 0.095, attack: 0.003, decay: 0.1 }),
      partial(b, { freq: note(24), gain: 0.026, attack: 0.003, decay: 0.06 }),
    ),
};

// ── System ──────────────────────────────────────────────────────────────────

interface Voice {
  audio: THREE.PositionalAudio;
  input: GainNode;
  /** Context time this voice is expected to fall silent. */
  freeAt: number;
}

/**
 * Builds the sound system. Pass the camera (or any head-tracked object) to
 * attach the listener straight away, or attach `system.listener` yourself.
 */
export function createAudio(attachTo?: THREE.Object3D | null): AudioSystem {
  const listener = new THREE.AudioListener();
  if (attachTo) attachTo.add(listener);

  const ctx = listener.context;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  // The fader sits after the compressor so turning the game down does not also
  // change how hard it is being compressed.
  const master = ctx.createGain();
  master.gain.value = DEFAULT_VOLUME;
  compressor.connect(master).connect(listener.getInput());

  // Two seconds of white noise, shared by every burst.
  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  const voices: Voice[] = [];
  for (let i = 0; i < VOICE_COUNT; i++) {
    const audio = new THREE.PositionalAudio(listener);
    audio.setRefDistance(0.6);
    audio.setRolloffFactor(1.1);
    audio.setDistanceModel("inverse");
    audio.setMaxDistance(20);
    // Re-route past the listener's own gain onto our bus, so mute and volume
    // are ours and do not fight AudioListener.masterVolume.
    audio.gain.disconnect();
    audio.gain.connect(compressor);

    const input = ctx.createGain();
    audio.setNodeSource(input);
    voices.push({ audio, input, freeAt: 0 });
  }

  let volume = DEFAULT_VOLUME;
  let muted = false;
  let disposed = false;

  function applyMasterGain(): void {
    const target = muted ? 0 : volume;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + FADE);
  }

  function nudgeContext(): void {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  }

  function makeBus(dest: AudioNode, options: CueOptions | undefined): Bus {
    return {
      ctx,
      dest,
      t0: ctx.currentTime + Math.max(0, options?.delay ?? 0),
      level: Math.max(0, options?.gain ?? 1),
      detune: options?.detune ?? 0,
      noise,
    };
  }

  function takeVoice(): Voice {
    const now = ctx.currentTime;
    let best = voices[0];
    for (const voice of voices) {
      if (voice.freeAt <= now) return voice;
      if (voice.freeAt < best.freeAt) best = voice;
    }
    return best;
  }

  return {
    listener,

    async resume() {
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          // Still locked; the next gesture will get another chance.
        }
      }
    },

    play(cue, options) {
      if (disposed || muted) return;
      nudgeContext();
      CUES[cue](makeBus(compressor, options));
    },

    playAt(cue, where, options) {
      if (disposed || muted) return;
      nudgeContext();

      const voice = takeVoice();
      if (where instanceof THREE.Vector3) voice.audio.position.copy(where);
      else where.getWorldPosition(voice.audio.position);
      // The voice has no parent, so its world matrix is its own; updating it
      // here is what moves the panner, with no scene wiring to remember.
      voice.audio.updateMatrixWorld(true);

      const bus = makeBus(voice.input, options);
      voice.freeAt = bus.t0 + CUES[cue](bus);
    },

    setMuted(next) {
      muted = next;
      applyMasterGain();
    },

    isMuted() {
      return muted;
    },

    setVolume(next) {
      volume = THREE.MathUtils.clamp(next, 0, 1);
      applyMasterGain();
    },

    getVolume() {
      return volume;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const voice of voices) {
        voice.input.disconnect();
        voice.audio.gain.disconnect();
        voice.audio.removeFromParent();
      }
      compressor.disconnect();
      master.disconnect();
      listener.removeFromParent();
      // The AudioContext is a Three.js singleton shared with any future audio
      // system, so it is left open rather than closed.
    },
  };
}
