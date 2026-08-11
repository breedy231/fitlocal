import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lbsToKg } from 'fitlocal-shared';

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

export interface SleepInterval {
  date: string; // attributed date (wake-up date)
  startMs: number;
  endMs: number;
  creationDate: string; // groups segments into sessions
  sourceName: string;
}

// Parse a single <Record .../> line from the XML using regex (streaming, no DOM needed)
function parseRecordLine(line: string): RawSample | null {
  // Extract type attribute
  const typeMatch = line.match(/type="([^"]+)"/);
  if (!typeMatch) return null;

  const hkType = typeMatch[1];
  const metricKey = TYPE_MAP[hkType];
  if (!metricKey) return null;

  // Sleep handled separately — skip here
  if (metricKey === 'sleep') return null;

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
      finalValue = lbsToKg(value); // lbs to kg
    }
  }

  return { type: metricKey, date, value: finalValue };
}

function parseSleepLine(line: string): SleepInterval | null {
  const valueMatch = line.match(/value="([^"]+)"/);
  if (!valueMatch) return null;
  const val = valueMatch[1];
  // Skip InBed, Awake, and legacy value "0" (InBed)
  if (val === 'HKCategoryValueSleepAnalysisInBed' || val === '0') return null;
  if (val.includes('Awake')) return null;

  const startMatch = line.match(/startDate="([^"]+)"/);
  const endMatch = line.match(/endDate="([^"]+)"/);
  const creationMatch = line.match(/creationDate="([^"]+)"/);
  if (!startMatch || !endMatch) return null;

  const start = new Date(startMatch[1]);
  const end = new Date(endMatch[1]);
  if (end.getTime() <= start.getTime()) return null;

  const creationDate = creationMatch ? creationMatch[1] : endMatch[1];
  const sourceMatch = line.match(/sourceName="([^"]+)"/);
  const sourceName = sourceMatch ? sourceMatch[1] : 'unknown';
  // Date will be assigned at session level, not per-segment
  return { date: '', startMs: start.getTime(), endMs: end.getTime(), creationDate, sourceName };
}

// Defense-in-depth safety net: a single date should never exceed this many sleep hours
const MAX_SLEEP_HOURS = 16;

// Merge overlapping intervals and return total hours
export function mergeAndSumSleepHours(intervals: SleepInterval[]): number {
  if (intervals.length === 0) return 0;
  // Sort by start time
  intervals.sort((a, b) => a.startMs - b.startMs);
  const merged: { start: number; end: number }[] = [{ start: intervals[0].startMs, end: intervals[0].endMs }];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].startMs <= last.end) {
      // Overlapping — extend
      last.end = Math.max(last.end, intervals[i].endMs);
    } else {
      merged.push({ start: intervals[i].startMs, end: intervals[i].endMs });
    }
  }
  const totalMs = merged.reduce((sum, m) => sum + (m.end - m.start), 0);
  return totalMs / (1000 * 60 * 60);
}

/**
 * Given intervals from multiple sources (e.g. Apple Watch + a third-party sleep app),
 * pick the source whose merged interval total is the highest and return only its intervals.
 * This eliminates double-counting when two apps record the same night independently.
 *
 * Trade-off: if a user genuinely uses one app for naps and another for nights on the same
 * attributed date, the smaller source is dropped — accepted to eliminate impossible totals.
 */
export function pickBestSourceIntervals(intervals: SleepInterval[]): SleepInterval[] {
  if (intervals.length === 0) return [];

  // Group by sourceName
  const bySource = new Map<string, SleepInterval[]>();
  for (const si of intervals) {
    if (!bySource.has(si.sourceName)) bySource.set(si.sourceName, []);
    bySource.get(si.sourceName)!.push(si);
  }

  // Single source — return as-is
  if (bySource.size === 1) return intervals;

  // Pick source with max merged hours; tie-break by lexicographically smallest name
  let bestSource = '';
  let bestHours = -1;
  for (const [sourceName, sourceIntervals] of bySource) {
    const hours = mergeAndSumSleepHours([...sourceIntervals]); // copy to avoid mutation
    if (hours > bestHours || (hours === bestHours && sourceName < bestSource)) {
      bestHours = hours;
      bestSource = sourceName;
    }
  }

  return bySource.get(bestSource)!;
}

/**
 * Group sleep intervals into sessions by creationDate, then attribute each session to
 * its wake-up date (the local date of the latest segment's creationDate). Preserves the
 * same attribution logic as the original inline code in parseHealthExportZip.
 */
export function groupSleepByDate(intervals: SleepInterval[]): Map<string, SleepInterval[]> {
  const sleepSessions = new Map<string, SleepInterval[]>();
  for (const si of intervals) {
    if (!sleepSessions.has(si.creationDate)) sleepSessions.set(si.creationDate, []);
    sleepSessions.get(si.creationDate)!.push(si);
  }

  const sleepByDate = new Map<string, SleepInterval[]>();
  for (const [, segments] of sleepSessions) {
    // Attribute session to the local date of the latest segment's creation date
    // (creationDate is when Apple Watch uploaded, always after wake-up on the same local date)
    const latestSegment = segments.reduce((a, b) => b.endMs > a.endMs ? b : a);
    const sessionDate = extractLocalDate(latestSegment.creationDate);

    if (!sleepByDate.has(sessionDate)) sleepByDate.set(sessionDate, []);
    sleepByDate.get(sessionDate)!.push(...segments);
  }

  return sleepByDate;
}

/**
 * Compute the canonical sleep hours for a set of intervals attributed to one date:
 * 1. Pick the best single source (eliminates multi-source double-counting)
 * 2. Merge overlapping segments (handles fragmented staged-sleep from one app)
 * 3. Clamp to MAX_SLEEP_HOURS (defense-in-depth)
 */
export function computeSleepHoursForDate(intervals: SleepInterval[]): number {
  const best = pickBestSourceIntervals(intervals);
  const hours = mergeAndSumSleepHours(best);
  return Math.min(hours, MAX_SLEEP_HOURS);
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
    throw new Error(`Failed to unzip: ${e.message}`, { cause: e });
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
  // Aggregate directly into byDate to avoid accumulating millions of samples in memory
  const byDate = new Map<string, {
    hrv: number[]; restingHr: number[];
    steps: number[]; bodyWeight: number[]; calories: number[]; protein: number[];
  }>();
  const sleepIntervals: SleepInterval[] = [];
  const stats: Record<string, number> = {};

  const rl = createInterface({
    input: createReadStream(xmlPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('<Record ')) continue;

    // Check for sleep records first
    if (trimmed.includes('SleepAnalysis')) {
      const interval = parseSleepLine(trimmed);
      if (interval) {
        sleepIntervals.push(interval);
        stats['sleep'] = (stats['sleep'] || 0) + 1;
      }
      continue;
    }

    const sample = parseRecordLine(trimmed);
    if (sample) {
      if (!byDate.has(sample.date)) {
        byDate.set(sample.date, { hrv: [], restingHr: [], steps: [], bodyWeight: [], calories: [], protein: [] });
      }
      (byDate.get(sample.date)! as any)[sample.type].push(sample.value);
      stats[sample.type] = (stats[sample.type] || 0) + 1;
    }
  }

  // Cleanup
  try { execSync(`rm -rf "${tmpDir}"`); } catch { /* ignore */ }

  // Group sleep segments into sessions by creationDate, attribute each to its wake-up date,
  // then pick the best single source per date to eliminate multi-source double-counting.
  const sleepByDate = groupSleepByDate(sleepIntervals);

  // Collect all dates
  const allDates = new Set([...byDate.keys(), ...sleepByDate.keys()]);

  const snapshots: DaySnapshot[] = [];
  for (const date of allDates) {
    const day = byDate.get(date);
    const sleepInts = sleepByDate.get(date);
    const sleepHours = sleepInts ? computeSleepHoursForDate(sleepInts) : 0;

    snapshots.push({
      date,
      hrv: day?.hrv.length ? Math.round(day.hrv.reduce((a, b) => a + b, 0) / day.hrv.length) : null,
      restingHr: day?.restingHr.length ? Math.round(day.restingHr.reduce((a, b) => a + b, 0) / day.restingHr.length) : null,
      sleepHours: sleepHours > 0 ? Math.round(sleepHours * 100) / 100 : null,
      steps: day?.steps.length ? Math.round(day.steps.reduce((a, b) => a + b, 0)) : null,
      bodyWeightKg: day?.bodyWeight.length ? Math.round(day.bodyWeight[day.bodyWeight.length - 1] * 100) / 100 : null,
      calories: day?.calories.length ? Math.round(day.calories.reduce((a, b) => a + b, 0)) : null,
      proteinG: day?.protein.length ? Math.round(day.protein.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    });
  }

  // Sort by date
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  return { snapshots, stats };
}

/**
 * For each metric, find the most recent date that had a non-null value.
 * Returns a map from stat key to YYYY-MM-DD date string.
 * Keys: hrv, restingHr, steps, bodyWeight, calories, protein, sleep
 * Only keys with at least one non-null value are included.
 */
export function computeLatestByMetric(snapshots: DaySnapshot[]): Record<string, string> {
  const latest: Record<string, string> = {};

  const fieldToKey: Array<[keyof DaySnapshot, string]> = [
    ['hrv', 'hrv'],
    ['restingHr', 'restingHr'],
    ['steps', 'steps'],
    ['bodyWeightKg', 'bodyWeight'],
    ['calories', 'calories'],
    ['proteinG', 'protein'],
    ['sleepHours', 'sleep'],
  ];

  for (const snapshot of snapshots) {
    for (const [field, key] of fieldToKey) {
      if (snapshot[field] !== null && snapshot[field] !== undefined) {
        if (!(key in latest) || snapshot.date > latest[key]) {
          latest[key] = snapshot.date;
        }
      }
    }
  }

  return latest;
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
