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
