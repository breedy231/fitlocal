import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// HealthKit type identifiers we care about
const TYPE_MAP: Record<string, string> = {
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': 'hrv',
  'HKQuantityTypeIdentifierRestingHeartRate': 'restingHr',
  'HKQuantityTypeIdentifierStepCount': 'steps',
  'HKQuantityTypeIdentifierBodyMass': 'bodyWeight',
  'HKQuantityTypeIdentifierDietaryEnergyConsumed': 'calories',
  'HKQuantityTypeIdentifierDietaryProtein': 'protein',
  'HKCategoryTypeIdentifierSleepAnalysis': 'sleep',
};

// Extract YYYY-MM-DD from a HealthKit date string like "2026-03-25 22:00:00 -0500"
// without converting through UTC (which shifts late-night times to the next day)
function extractLocalDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  // Fallback: try ISO parse but this may shift timezone
  return new Date(dateStr).toISOString().slice(0, 10);
}

export interface DaySnapshot {
  date: string;
  hrv: number | null;
  restingHr: number | null;
  sleepHours: number | null;
  steps: number | null;
  bodyWeightKg: number | null;
  calories: number | null;
  proteinG: number | null;
}

interface RawSample {
  type: string;
  date: string; // YYYY-MM-DD
  value: number;
}

// Parse a single <Record .../> line from the XML using regex (streaming, no DOM needed)
function parseRecordLine(line: string): RawSample | null {
  // Extract type attribute
  const typeMatch = line.match(/type="([^"]+)"/);
  if (!typeMatch) return null;

  const hkType = typeMatch[1];
  const metricKey = TYPE_MAP[hkType];
  if (!metricKey) return null;

  // Sleep analysis is a category, not a quantity — compute duration
  if (metricKey === 'sleep') {
    // Only count actual sleep, not "InBed"
    const valueMatch = line.match(/value="([^"]+)"/);
    if (valueMatch) {
      const val = valueMatch[1];
      // HKCategoryValueSleepAnalysis: 0=InBed, 1=Asleep (legacy)
      // Newer: AsleepCore, AsleepDeep, AsleepREM, AsleepUnspecified
      if (val === 'HKCategoryValueSleepAnalysisInBed' || val === '0') return null;
    }

    const startMatch = line.match(/startDate="([^"]+)"/);
    const endMatch = line.match(/endDate="([^"]+)"/);
    if (!startMatch || !endMatch) return null;

    const start = new Date(startMatch[1]);
    const end = new Date(endMatch[1]);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (hours <= 0 || hours > 24) return null;

    // Attribute sleep to the end date (when you wake up), using local date
    const date = extractLocalDate(endMatch[1]);
    return { type: 'sleep', date, value: hours };
  }

  // Quantity types — extract value and startDate
  const valueMatch = line.match(/value="([^"]+)"/);
  const dateMatch = line.match(/startDate="([^"]+)"/);
  if (!valueMatch || !dateMatch) return null;

  const value = parseFloat(valueMatch[1]);
  if (isNaN(value)) return null;

  // Use the local date from the string (YYYY-MM-DD) to avoid UTC timezone shift
  const date = extractLocalDate(dateMatch[1]);

  // Unit conversions
  let finalValue = value;
  if (metricKey === 'calories') {
    // HealthKit stores dietary energy in kcal already, but check unit
    const unitMatch = line.match(/unit="([^"]+)"/);
    if (unitMatch && unitMatch[1] === 'kJ') {
      finalValue = value / 4.184; // kJ to kcal
    }
  }
  if (metricKey === 'bodyWeight') {
    const unitMatch = line.match(/unit="([^"]+)"/);
    if (unitMatch && unitMatch[1] === 'lb') {
      finalValue = value * 0.453592; // lbs to kg
    }
  }

  return { type: metricKey, date, value: finalValue };
}

export async function parseHealthExportZip(zipBuffer: Buffer): Promise<{
  snapshots: DaySnapshot[];
  stats: Record<string, number>;
}> {
  // Write zip to temp, extract, find export.xml
  const tmpDir = join(tmpdir(), `fitlocal-health-${Date.now()}`);
  const zipPath = join(tmpDir, 'export.zip');

  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(zipPath, zipBuffer);

  try {
    execSync(`unzip -o -q "${zipPath}" -d "${tmpDir}"`, { maxBuffer: 500 * 1024 * 1024 });
  } catch (e: any) {
    throw new Error(`Failed to unzip: ${e.message}`);
  }

  // Find export.xml — could be at root or in apple_health_export/
  let xmlPath = join(tmpDir, 'apple_health_export', 'export.xml');
  if (!existsSync(xmlPath)) {
    xmlPath = join(tmpDir, 'export.xml');
  }
  if (!existsSync(xmlPath)) {
    // Search for it
    const files = findFile(tmpDir, 'export.xml');
    if (files.length === 0) throw new Error('No export.xml found in zip');
    xmlPath = files[0];
  }

  // Stream-parse the XML line by line (export.xml can be 1GB+)
  const samples: RawSample[] = [];
  const stats: Record<string, number> = {};

  const rl = createInterface({
    input: createReadStream(xmlPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('<Record ')) continue;

    const sample = parseRecordLine(trimmed);
    if (sample) {
      samples.push(sample);
      stats[sample.type] = (stats[sample.type] || 0) + 1;
    }
  }

  // Cleanup
  try { execSync(`rm -rf "${tmpDir}"`); } catch { /* ignore */ }

  // Aggregate samples by date
  const byDate = new Map<string, {
    hrv: number[]; restingHr: number[]; sleep: number[];
    steps: number[]; bodyWeight: number[]; calories: number[]; protein: number[];
  }>();

  for (const s of samples) {
    if (!byDate.has(s.date)) {
      byDate.set(s.date, { hrv: [], restingHr: [], sleep: [], steps: [], bodyWeight: [], calories: [], protein: [] });
    }
    const day = byDate.get(s.date)!;
    (day as any)[s.type].push(s.value);
  }

  const snapshots: DaySnapshot[] = [];
  for (const [date, day] of byDate) {
    snapshots.push({
      date,
      hrv: day.hrv.length > 0 ? Math.round(day.hrv.reduce((a, b) => a + b, 0) / day.hrv.length) : null,
      restingHr: day.restingHr.length > 0 ? Math.round(day.restingHr.reduce((a, b) => a + b, 0) / day.restingHr.length) : null,
      sleepHours: day.sleep.length > 0 ? Math.round(day.sleep.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      steps: day.steps.length > 0 ? Math.round(day.steps.reduce((a, b) => a + b, 0)) : null,
      bodyWeightKg: day.bodyWeight.length > 0 ? Math.round(day.bodyWeight[day.bodyWeight.length - 1] * 100) / 100 : null,
      calories: day.calories.length > 0 ? Math.round(day.calories.reduce((a, b) => a + b, 0)) : null,
      proteinG: day.protein.length > 0 ? Math.round(day.protein.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    });
  }

  // Sort by date
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  return { snapshots, stats };
}

function findFile(dir: string, name: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFile(fullPath, name));
      } else if (entry.name === name) {
        results.push(fullPath);
      }
    }
  } catch { /* ignore permission errors */ }
  return results;
}
