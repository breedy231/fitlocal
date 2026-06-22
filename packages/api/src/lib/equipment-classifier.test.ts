import { describe, it, expect } from 'vitest';
import { classifyEquipment } from './equipment-classifier.js';

describe('classifyEquipment', () => {
  it('tags the implement from the name', () => {
    expect(classifyEquipment('Dumbbell Bicep Curl')).toEqual(['dumbbell']);
    expect(classifyEquipment('Barbell Curl')).toEqual(['barbell']);
    expect(classifyEquipment('Kettlebell Swing')).toEqual(['kettlebell']);
    expect(classifyEquipment('Cable Row')).toEqual(['cable']);
  });

  it('treats EZ-bar, T-bar and landmine as barbell', () => {
    expect(classifyEquipment('EZ-Bar Curl')).toEqual(['barbell']);
    expect(classifyEquipment('T-Bar Row')).toEqual(['barbell']);
    expect(classifyEquipment('Landmine Romanian Deadlift')).toEqual(['barbell']);
  });

  // The core of #33: flat vs incline vs decline must be distinguished.
  it('distinguishes bench angles', () => {
    expect(classifyEquipment('Dumbbell Bench Press')).toEqual(['dumbbell', 'flat-bench']);
    expect(classifyEquipment('Dumbbell Incline Bench Press')).toEqual(['dumbbell', 'incline-bench']);
    expect(classifyEquipment('Barbell Decline Bench Press')).toEqual(['barbell', 'decline-bench']);
  });

  it('does not require a bench for a floor press', () => {
    expect(classifyEquipment('Dumbbell Floor Press')).toEqual(['dumbbell']);
    expect(classifyEquipment('Single Arm Floor Press')).toEqual([]);
  });

  it('infers barbell for a bare bench press', () => {
    expect(classifyEquipment('Barbell Bench Press')).toEqual(['barbell', 'flat-bench']);
    expect(classifyEquipment('Close-Grip Bench Press')).toEqual(['barbell', 'flat-bench']);
  });

  it('does not double-tag a smith machine as a generic machine', () => {
    expect(classifyEquipment('Smith Machine Squat')).toEqual(['smith-machine']);
    expect(classifyEquipment('Smith Machine Bench Press')).toEqual(['smith-machine', 'flat-bench']);
  });

  it('does not demand a separate bench for a machine press', () => {
    expect(classifyEquipment('Machine Bench Press')).toEqual(['machine']);
    expect(classifyEquipment('Hammerstrength Incline Chest Press')).toEqual(['machine']);
  });

  it('classifies pulldowns / leg machines / assisted as machine', () => {
    expect(classifyEquipment('Lat Pulldown')).toEqual(['machine']);
    expect(classifyEquipment('Leg Press')).toEqual(['machine']);
    expect(classifyEquipment('Assisted Pull Up')).toEqual(['machine']);
  });

  it('tags pull/chin ups as pull-up-bar unless assisted', () => {
    expect(classifyEquipment('Assisted Chin Up')).toEqual(['machine']);
    expect(classifyEquipment('Push Up')).toEqual([]); // not a pull-up
  });

  it('tags band and suspension families', () => {
    expect(classifyEquipment('Mini Loop Band Squat')).toEqual(['band']);
    expect(classifyEquipment('Handle Band Bicep Curl')).toEqual(['band']);
    expect(classifyEquipment('TRX Row')).toEqual(['suspension']);
  });

  it('does not infer a barbell compound when a band is present', () => {
    expect(classifyEquipment('Mini Loop Band Single Leg Romanian Deadlift with Row')).toEqual(['band']);
  });

  it('infers the canonical implement for staples named without one', () => {
    expect(classifyEquipment('Deadlift')).toEqual(['barbell']);
    expect(classifyEquipment('Back Squat')).toEqual(['barbell']);
    expect(classifyEquipment('Front Squat')).toEqual(['barbell']);
    expect(classifyEquipment('Push Press')).toEqual(['barbell']);
    expect(classifyEquipment('Good Morning')).toEqual(['barbell']);
    expect(classifyEquipment('Hammer Curls')).toEqual(['dumbbell']);
    expect(classifyEquipment('Goblet Squat')).toEqual(['dumbbell']);
  });

  it('returns an empty set for bodyweight / mobility / outdoor work', () => {
    expect(classifyEquipment('Plank')).toEqual([]);
    expect(classifyEquipment('Air Squats')).toEqual([]);
    expect(classifyEquipment('Running')).toEqual([]);
    expect(classifyEquipment('Child\'s Pose')).toEqual([]);
  });

  it('tags cardio machines individually', () => {
    expect(classifyEquipment('Running - Treadmill')).toEqual(['treadmill']);
    expect(classifyEquipment('Cycling - Stationary')).toEqual(['stationary-bike']);
    expect(classifyEquipment('Elliptical')).toEqual(['elliptical']);
  });

  it('does not match equipment words inside other words', () => {
    // guard against the classic substring footgun (e.g. "band" inside a word)
    expect(classifyEquipment('Cable Crunch')).toEqual(['cable']);
    expect(classifyEquipment('Crunches')).toEqual([]);
  });
});
