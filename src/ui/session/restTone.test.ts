import { playRestTone, resetRestToneForTests, unlockRestTone } from './restTone';

interface StubOscillator {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function stubAudio(initialState: 'running' | 'suspended' = 'running') {
  const oscillators: StubOscillator[] = [];
  const context = {
    state: initialState,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createOscillator: vi.fn(() => {
      const osc: StubOscillator = {
        type: '',
        frequency: { value: 0 },
        // osc.connect(gain).connect(destination) — the first connect must
        // return something connectable.
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  const ctor = vi.fn(function AudioContextStub() {
    return context;
  });
  vi.stubGlobal('AudioContext', ctor);
  return { context, ctor, oscillators };
}

beforeEach(() => {
  resetRestToneForTests();
  vi.unstubAllGlobals();
});

it('creates one audio context however many times the gesture fires', () => {
  const { ctor } = stubAudio();
  unlockRestTone();
  unlockRestTone();
  unlockRestTone();
  expect(ctor).toHaveBeenCalledTimes(1);
});

it('resumes a context iOS suspended while the app was backgrounded', () => {
  const { context } = stubAudio('suspended');
  unlockRestTone();
  expect(context.resume).toHaveBeenCalled();
});

it('does nothing when the browser has no AudioContext', () => {
  // jsdom, and any browser old enough to lack it. A silent timer beats a
  // session screen that throws.
  vi.stubGlobal('AudioContext', undefined);
  expect(() => unlockRestTone()).not.toThrow();
  expect(() => playRestTone()).not.toThrow();
});

it('makes no sound before the gesture has unlocked audio', () => {
  const { context } = stubAudio();
  playRestTone();
  expect(context.createOscillator).not.toHaveBeenCalled();
});

it('plays two blips once unlocked', () => {
  // Two rather than one: a single beep in a noisy gym reads as incidental.
  const { oscillators } = stubAudio();
  unlockRestTone();
  playRestTone();
  expect(oscillators).toHaveLength(2);
  expect(oscillators[0].frequency.value).toBeGreaterThan(0);
  expect(oscillators[1].frequency.value).not.toBe(oscillators[0].frequency.value);
  for (const osc of oscillators) {
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
  }
});

it('stays silent when the context is not running', () => {
  const { context, oscillators } = stubAudio();
  unlockRestTone();
  context.state = 'suspended';
  expect(() => playRestTone()).not.toThrow();
  expect(oscillators).toHaveLength(0);
});
