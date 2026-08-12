// Shared HR-sample helpers used by the /hr-samples ingest route and the
// /workouts/:id/hr zone handler (and, upcoming, /workout-sessions). Pure
// parsing/coercion/downsampling with no DB or Fastify dependency.

// Thin captured HR down to roughly one sample per this interval. Apple Watch
// logs HR every ~5s during a workout; 10s keeps charts/zones faithful while
// halving row count. Time-in-zone weights each sample by the gap to the next
// (capped, so a dropout doesn't inflate a zone).
export const DOWNSAMPLE_MS = 10_000;
// An in-progress workout (started_at set, ended_at still null) is treated as
// open up to "now" so HR can be ingested before the user taps Finish — capped
// so a stale/forgotten active workout doesn't swallow an entire day of samples.
export const MAX_ACTIVE_WINDOW_MS = 6 * 60 * 60_000;

export interface ParsedSample { ms: number; iso: string; bpm: number; }

// Pull a bpm out of a number or a string that may carry units ("145 count/min",
// "145 bpm", "145.0").
export function coerceBpm(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === 'string') {
    const m = v.match(/-?[\d.]+/);
    if (m) { const n = Math.round(parseFloat(m[0])); return Number.isFinite(n) ? n : null; }
  }
  return null;
}

// Accept ISO strings, localized date strings (new Date can parse many), or epoch
// numbers in seconds or milliseconds.
export function coerceMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e12 ? n : n * 1000; }
    const ms = new Date(s).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// Tolerant parser for the variety of shapes iOS Shortcuts can POST:
//   • CSV string, one "<time>,<bpm>" per line (the recommended shape)
//   • a JSON array of objects, with flexible key names
//   • a { samples: <either of the above> } wrapper
// Invalid / out-of-range rows are dropped rather than failing the whole batch.
export function parseSamples(input: unknown): ParsedSample[] {
  // Unwrap { samples: … }.
  if (input && typeof input === 'object' && !Array.isArray(input) && 'samples' in (input as any)) {
    return parseSamples((input as any).samples);
  }

  const rows: { t: unknown; bpm: unknown }[] = [];
  if (typeof input === 'string') {
    for (const line of input.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const comma = trimmed.indexOf(',');
      if (comma === -1) continue;
      rows.push({ t: trimmed.slice(0, comma).trim(), bpm: trimmed.slice(comma + 1).trim() });
    }
  } else if (Array.isArray(input)) {
    for (const s of input) {
      if (s == null) continue;
      if (typeof s === 'object') {
        const o = s as Record<string, unknown>;
        rows.push({
          t: o.t ?? o.date ?? o.startDate ?? o.start ?? o.time ?? o.timestamp,
          bpm: o.bpm ?? o.value ?? o.count ?? o.heartRate ?? o.hr,
        });
      } else if (typeof s === 'string') {
        const comma = s.indexOf(',');
        if (comma !== -1) rows.push({ t: s.slice(0, comma).trim(), bpm: s.slice(comma + 1).trim() });
      }
    }
  }

  const out: ParsedSample[] = [];
  for (const r of rows) {
    const ms = coerceMs(r.t);
    const bpm = coerceBpm(r.bpm);
    if (ms == null || bpm == null || bpm <= 0 || bpm > 300) continue;
    out.push({ ms, iso: new Date(ms).toISOString(), bpm });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

// Keep the first sample in each DOWNSAMPLE_MS window (input must be sorted).
export function downsample(samples: ParsedSample[]): ParsedSample[] {
  const kept: ParsedSample[] = [];
  let lastMs = -Infinity;
  for (const s of samples) {
    if (s.ms - lastMs >= DOWNSAMPLE_MS) {
      kept.push(s);
      lastMs = s.ms;
    }
  }
  return kept;
}
