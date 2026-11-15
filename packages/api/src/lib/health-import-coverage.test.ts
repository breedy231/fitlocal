import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseHealthExportZip,
  computeMissingMetrics,
  type DaySnapshot,
} from './health-xml-parser.js';

// Issue #90: body weight and nutrition stopped showing up after imports. These
// tests pin down that the parser keeps every BodyMass / dietary record in a
// realistically shaped export.xml, so a gap after import is upstream (nothing
// writing to HealthKit), and that the import flags metrics that went quiet.
// All values are made up.

const EXPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>
]>
<HealthData locale="en_US">
 <ExportDate value="2026-11-10 21:00:00 -0600"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth=""/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Smart Scale" sourceVersion="6.4" device="&lt;&lt;HKDevice: 0x1&gt;, name:Scale, manufacturer:Acme&gt;" unit="lb" creationDate="2026-11-01 07:12:05 -0500" startDate="2026-11-01 07:11:00 -0500" endDate="2026-11-01 07:11:00 -0500" value="200">
  <MetadataEntry key="HKWasUserEntered" value="0"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health" unit="kg" creationDate="2026-11-09 07:00:00 -0600" startDate="2026-11-09 07:00:00 -0600" endDate="2026-11-09 07:00:00 -0600" value="90"/>
 <Record type="HKQuantityTypeIdentifierDietaryEnergyConsumed" sourceName="MyFitnessPal" sourceVersion="24.1" unit="kcal" creationDate="2026-11-09 22:00:00 -0600" startDate="2026-11-09 12:00:00 -0600" endDate="2026-11-09 12:00:00 -0600" value="600">
  <MetadataEntry key="meal" value="Lunch"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierDietaryEnergyConsumed" sourceName="MyFitnessPal" unit="kcal" creationDate="2026-11-09 22:00:00 -0600" startDate="2026-11-09 23:30:00 -0600" endDate="2026-11-09 23:30:00 -0600" value="400"/>
 <Record type="HKQuantityTypeIdentifierDietaryProtein" sourceName="MyFitnessPal" unit="g" creationDate="2026-11-09 22:00:00 -0600" startDate="2026-11-09 12:00:00 -0600" endDate="2026-11-09 12:00:00 -0600" value="50.5"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" creationDate="2026-11-10 20:00:00 -0600" startDate="2026-11-10 19:00:00 -0600" endDate="2026-11-10 20:00:00 -0600" value="1000"/>
</HealthData>
`;

let workDir: string;
let zipBuffer: Buffer;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'fitlocal-hk-test-'));
  mkdirSync(join(workDir, 'apple_health_export'));
  writeFileSync(join(workDir, 'apple_health_export', 'export.xml'), EXPORT_XML);
  execSync('zip -q -r export.zip apple_health_export', { cwd: workDir });
  zipBuffer = readFileSync(join(workDir, 'export.zip'));
});

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe('parseHealthExportZip: body weight and nutrition (#90)', () => {
  it('keeps every BodyMass and dietary record, with unit conversion and local dates', async () => {
    const { snapshots, stats } = await parseHealthExportZip(zipBuffer);
    const byDate = Object.fromEntries(snapshots.map(s => [s.date, s]));

    expect(stats.bodyWeight).toBe(2);
    expect(stats.calories).toBe(2);
    expect(stats.protein).toBe(1);

    expect(byDate['2026-11-01'].bodyWeightKg).toBeCloseTo(90.72, 1); // 200 lb
    expect(byDate['2026-11-09'].bodyWeightKg).toBe(90);
    // 23:30 Central stays on the 9th (no UTC shift to the 10th)
    expect(byDate['2026-11-09'].calories).toBe(1000);
    expect(byDate['2026-11-09'].proteinG).toBe(50.5);
  });
});

function snap(date: string, fields: Partial<DaySnapshot> = {}): DaySnapshot {
  return {
    date, hrv: null, restingHr: null, sleepHours: null, steps: null,
    bodyWeightKg: null, calories: null, proteinG: null, ...fields,
  };
}

describe('computeMissingMetrics', () => {
  it('flags expected metrics with no data in the last N days of the export, measured from the export end', () => {
    const snapshots = [
      snap('2026-06-24', { bodyWeightKg: 80, calories: 2000, proteinG: 150 }),
      snap('2026-10-20', { calories: 1800 }), // outside a 14-day window ending 11-10
      snap('2026-11-08', { steps: 5000, hrv: 40, restingHr: 55, sleepHours: 7 }),
      snap('2026-11-10', { steps: 6000 }),
    ];

    const missing = computeMissingMetrics(snapshots, 14);

    expect(missing.map(m => m.metric).sort()).toEqual(['bodyWeight', 'calories', 'protein']);
    const weight = missing.find(m => m.metric === 'bodyWeight')!;
    expect(weight.latestDate).toBe('2026-06-24');
    expect(weight.windowStart).toBe('2026-10-28');
    expect(weight.windowEnd).toBe('2026-11-10');
    expect(missing.find(m => m.metric === 'calories')!.latestDate).toBe('2026-10-20');
  });

  it('reports a metric that never appears with latestDate null', () => {
    const missing = computeMissingMetrics([snap('2026-11-10', { steps: 1, hrv: 1, restingHr: 1, sleepHours: 1, calories: 1, proteinG: 1 })], 14);
    expect(missing).toEqual([
      { metric: 'bodyWeight', latestDate: null, windowStart: '2026-10-28', windowEnd: '2026-11-10' },
    ]);
  });

  it('returns nothing for an empty export or when every metric is present', () => {
    expect(computeMissingMetrics([], 14)).toEqual([]);
    const all = snap('2026-11-10', { steps: 1, hrv: 1, restingHr: 1, sleepHours: 1, calories: 1, proteinG: 1, bodyWeightKg: 1 });
    expect(computeMissingMetrics([all], 14)).toEqual([]);
  });
});
