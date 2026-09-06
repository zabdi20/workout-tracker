/**
 * The rest-over tone.
 *
 * WebAudio rather than an <audio> element and a bundled file: nothing to
 * ship, no element to prime, and a gain envelope that starts and stops the
 * blip without a click.
 *
 * This is the foreground half only. The spike
 * (docs/superpowers/spikes/2026-08-04-rest-alert-reach.md) measured that
 * nothing here can reach a backgrounded app on iOS — the audio clock itself
 * is suspended — so no amount of scheduling ahead would help.
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Must be called from inside a user gesture, before any await.
 *
 * iOS unlocks audio on a gesture and suspends the context whenever the app is
 * backgrounded, so calling this on every confirm tap is what leaves the
 * context running when the tone fires ninety seconds later. Calling it after
 * an await instead produces a timer that is silent on the first rest of every
 * launch and works forever after — the hardest possible bug to reproduce.
 */
export function unlockRestTone(): void {
  try {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch {
    // A context the browser refuses to create is not a reason to fail a set
    // log.
  }
}

export function playRestTone(): void {
  try {
    if (!context || context.state !== 'running') return;
    const startedAt = context.currentTime;
    // Two short blips rather than one long one: a single beep in a noisy gym
    // reads as incidental, a pair reads as deliberate.
    const blips = [
      { at: startedAt, hz: 880 },
      { at: startedAt + 0.18, hz: 1174 },
    ];
    for (const blip of blips) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = blip.hz;
      // Ramped rather than switched, so neither end of the blip clicks.
      // Exponential ramps cannot touch zero, hence 0.0001.
      gain.gain.setValueAtTime(0.0001, blip.at);
      gain.gain.exponentialRampToValueAtTime(0.3, blip.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, blip.at + 0.12);
      osc.connect(gain).connect(context.destination);
      osc.start(blip.at);
      osc.stop(blip.at + 0.14);
    }
  } catch {
    // A tone that will not play leaves a silent timer, not a broken one.
  }
}

/** Test seam: drops the cached context so each test starts locked. */
export function resetRestToneForTests(): void {
  context = null;
}
