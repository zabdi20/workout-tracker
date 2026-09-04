import type { LoggedSet, MeasurementType } from '../db/types';
import { formatDuration, formatSet, measurementFields } from './measurement';

function names(type: MeasurementType) {
  return measurementFields(type).map((f) => f.name);
}

describe('measurementFields', () => {
  it('asks for weight and reps for a loaded rep set', () => {
    expect(names('weight_reps')).toEqual(['weight', 'reps']);
  });

  it('asks only for reps when the load is the body', () => {
    expect(names('bodyweight_reps')).toEqual(['reps']);
  });

  it('asks for assistance and reps for an assisted rep set', () => {
    expect(names('assisted_reps')).toEqual(['assistance', 'reps']);
  });

  it('asks only for seconds for a timed hold', () => {
    expect(names('duration')).toEqual(['duration']);
  });

  it('asks for metres and seconds for a distance effort', () => {
    expect(names('distance_duration')).toEqual(['distance', 'duration']);
  });

  it('asks for weight and seconds for a loaded carry', () => {
    expect(names('weight_duration')).toEqual(['weight', 'duration']);
  });

  it('maps assistance onto LoggedSet.weight, labelled so it cannot read as load', () => {
    const [assistance] = measurementFields('assisted_reps');
    expect(assistance.property).toBe('weight');
    expect(assistance.label).toBe('Assistance');
    expect(assistance.unitBearing).toBe(true);
  });

  it('marks distance as not unit-bearing — metres are canonical', () => {
    const [distance] = measurementFields('distance_duration');
    expect(distance.property).toBe('distanceMeters');
    expect(distance.unitBearing).toBe(false);
  });
});

describe('formatDuration', () => {
  it('pads seconds under a minute', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('renders whole minutes', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(120)).toBe('2:00');
  });

  it('lets minutes run past sixty rather than adding an hours field', () => {
    // A gym set is never hours long, and a bare m:ss stays unambiguous.
    expect(formatDuration(3700)).toBe('61:40');
  });

  it('renders zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});

function set(fields: Partial<LoggedSet>): LoggedSet {
  return {
    id: 'x',
    sessionId: 's',
    exerciseId: 'e',
    order: 0,
    setType: 'working',
    unit: 'lb',
    completedAt: 0,
    ...fields,
  };
}

describe('formatSet', () => {
  it('renders a loaded rep set', () => {
    expect(formatSet(set({ weight: 135, reps: 8 }), 'weight_reps')).toBe('135 lb × 8');
  });

  it('renders kilos as entered, never converted', () => {
    expect(formatSet(set({ weight: 60, reps: 8, unit: 'kg' }), 'weight_reps'))
      .toBe('60 kg × 8');
  });

  it('renders a bodyweight rep set', () => {
    expect(formatSet(set({ reps: 12 }), 'bodyweight_reps')).toBe('12 reps');
  });

  it('names assistance so it cannot be misread as load', () => {
    expect(formatSet(set({ weight: 40, reps: 8 }), 'assisted_reps'))
      .toBe('8 reps, 40 lb assist');
  });

  it('renders a timed hold', () => {
    expect(formatSet(set({ durationSeconds: 45 }), 'duration')).toBe('0:45');
  });

  it('renders a distance effort', () => {
    expect(formatSet(set({ distanceMeters: 400, durationSeconds: 90 }), 'distance_duration'))
      .toBe('400 m in 1:30');
  });

  it('renders a loaded carry', () => {
    expect(formatSet(set({ weight: 45, durationSeconds: 30 }), 'weight_duration'))
      .toBe('45 lb for 0:30');
  });

  it('renders a placeholder rather than undefined when a value is missing', () => {
    expect(formatSet(set({}), 'weight_reps')).toBe('—');
  });
});
