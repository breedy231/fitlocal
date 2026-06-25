import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, sqlite } from '../db.js';

// Thin captured HR down to roughly one sample per this interval. Apple Watch
// logs HR every ~5s during a workout; 10s keeps charts/zones faithful while
// halving row count. Time-in-zone weights each sample by the gap to the next
// (capped, so a dropout doesn't inflate a zone).
const DOWNSAMPLE_MS = 10_000;
const ZONE_GAP_CAP_MS = 30_000;
// An in-progress workout (started_at set, ended_at still null) is treated as
// open up to "now" so HR can be ingested before the user taps Finish — capped
// so a stale/forgotten active workout doesn't swallow an entire day of samples.
const MAX_ACTIVE_WINDOW_MS = 6 * 60 * 60_000;

interface ParsedSample { ms: number; iso: string; bpm: number; }

// Accept the Shortcut-friendly CSV string ("<iso>,<bpm>\n…") or a JSON array of
// { t, bpm }. Invalid / out-of-range rows are dropped rather than failing the
// whole batch — a flaky sensor reading shouldn't reject a session.
function parseSamples(input: unknown): ParsedSample[] {
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
      if (s && typeof s === 'object') rows.push({ t: (s as any).t, bpm: (s as any).bpm });
    }
  }

  const out: ParsedSample[] = [];
  for (const r of rows) {
    const ms = new Date(String(r.t)).getTime();
    const bpm = Math.round(Number(r.bpm));
    if (!Number.isFinite(ms) || !Number.isFinite(bpm) || bpm <= 0 || bpm > 300) continue;
    out.push({ ms, iso: new Date(ms).toISOString(), bpm });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

// Keep the first sample in each DOWNSAMPLE_MS window (input must be sorted).
function downsample(samples: ParsedSample[]): ParsedSample[] {
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

interface WorkoutWindow { id: number; date: string; startMs: number; endMs: number; }

export async function hrRoutes(app: FastifyInstance) {
  // Ingest Apple Watch HR for the day's workouts. The poster sends raw samples
  // with no workout knowledge; we bucket each into the workout whose
  // [started_at, ended_at] window contains it (#59). Re-posting is idempotent —
  // a workout's samples are replaced, not appended.
  app.post<{ Body: { samples?: unknown } }>('/hr-samples', async (req, reply) => {
    const samples = parseSamples(req.body?.samples);
    if (samples.length === 0) {
      return reply.status(400).send({ error: 'No valid HR samples in payload' });
    }

    const minMs = samples[0].ms;
    const maxMs = samples[samples.length - 1].ms;
    // Bound the candidate scan by date (±1 day covers tz skew at midnight).
    const loDate = new Date(minMs - 86_400_000).toISOString().slice(0, 10);
    const hiDate = new Date(maxMs + 86_400_000).toISOString().slice(0, 10);

    const rawWindows = db.all(sql`
      SELECT id, date, started_at AS startedAt, ended_at AS endedAt
      FROM workouts
      WHERE started_at IS NOT NULL
        AND date >= ${loDate} AND date <= ${hiDate}
    `) as { id: number; date: string; startedAt: string; endedAt: string | null }[];

    const now = Date.now();
    const windows: WorkoutWindow[] = rawWindows
      .map((w) => {
        const startMs = new Date(w.startedAt).getTime();
        // Active workout (no ended_at): open up to now, capped.
        const endMs = w.endedAt ? new Date(w.endedAt).getTime() : Math.min(now, startMs + MAX_ACTIVE_WINDOW_MS);
        return { id: w.id, date: w.date, startMs, endMs };
      })
      .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs >= w.startMs);

    const byWorkout = new Map<number, ParsedSample[]>();
    let unmatched = 0;
    for (const s of samples) {
      const w = windows.find((w) => s.ms >= w.startMs && s.ms <= w.endMs);
      if (!w) { unmatched++; continue; }
      const list = byWorkout.get(w.id);
      if (list) list.push(s);
      else byWorkout.set(w.id, [s]);
    }

    const results: { workoutId: number; date: string; sampleCount: number; avgHr: number; maxHr: number }[] = [];
    const persist = sqlite.transaction(() => {
      const del = sqlite.prepare('DELETE FROM workout_hr_samples WHERE workout_id = ?');
      const ins = sqlite.prepare('INSERT INTO workout_hr_samples (workout_id, t, bpm) VALUES (?, ?, ?)');
      for (const [workoutId, raw] of byWorkout) {
        const kept = downsample(raw);
        if (kept.length === 0) continue;
        del.run(workoutId);
        for (const s of kept) ins.run(workoutId, s.iso, s.bpm);
        const date = windows.find((w) => w.id === workoutId)!.date;
        results.push({
          workoutId,
          date,
          sampleCount: kept.length,
          avgHr: Math.round(kept.reduce((a, s) => a + s.bpm, 0) / kept.length),
          maxHr: Math.max(...kept.map((s) => s.bpm)),
        });
      }
    });
    persist();

    results.sort((a, b) => a.workoutId - b.workoutId);
    return reply.status(201).send({
      received: samples.length,
      stored: results.reduce((a, r) => a + r.sampleCount, 0),
      unmatched,
      workouts: results,
    });
  });

  // HR series + summary + (if a max HR is configured) time-in-zone for a workout.
  app.get<{ Params: { id: string } }>('/workouts/:id/hr', async (req, reply) => {
    const workoutId = parseInt(req.params.id);
    if (!Number.isFinite(workoutId)) return reply.status(400).send({ error: 'Bad workout id' });

    const samples = db.all(sql`
      SELECT t, bpm FROM workout_hr_samples WHERE workout_id = ${workoutId} ORDER BY t ASC
    `) as { t: string; bpm: number }[];

    if (samples.length === 0) {
      return { workoutId, sampleCount: 0, avgHr: null, maxHr: null, minHr: null, maxHrConfig: null, zones: null, samples: [] };
    }

    const bpms = samples.map((s) => s.bpm);
    const avgHr = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    const maxHr = Math.max(...bpms);
    const minHr = Math.min(...bpms);

    const goal = db.all(sql`SELECT max_hr AS maxHr FROM user_goals LIMIT 1`) as { maxHr: number | null }[];
    const maxHrConfig = goal[0]?.maxHr ?? null;

    let zones: { zone: number; label: string; minBpm: number; maxBpm: number | null; seconds: number }[] | null = null;
    if (maxHrConfig && maxHrConfig > 0) {
      // 5-zone %-of-max model; Z5 is open-ended (≥90%).
      const bounds = [
        { zone: 1, label: 'Z1 Recovery', lo: 0.5, hi: 0.6 },
        { zone: 2, label: 'Z2 Aerobic', lo: 0.6, hi: 0.7 },
        { zone: 3, label: 'Z3 Tempo', lo: 0.7, hi: 0.8 },
        { zone: 4, label: 'Z4 Threshold', lo: 0.8, hi: 0.9 },
        { zone: 5, label: 'Z5 Max', lo: 0.9, hi: null as number | null },
      ];
      const seconds = bounds.map((b) => ({
        zone: b.zone, label: b.label,
        minBpm: Math.round(b.lo * maxHrConfig),
        maxBpm: b.hi == null ? null : Math.round(b.hi * maxHrConfig),
        seconds: 0,
      }));
      const zoneOf = (bpm: number): number => {
        const pct = bpm / maxHrConfig;
        if (pct < 0.6) return 1;
        if (pct < 0.7) return 2;
        if (pct < 0.8) return 3;
        if (pct < 0.9) return 4;
        return 5;
      };
      for (let i = 0; i < samples.length; i++) {
        const cur = new Date(samples[i].t).getTime();
        const next = i + 1 < samples.length ? new Date(samples[i + 1].t).getTime() : cur + DOWNSAMPLE_MS;
        const dt = Math.min(Math.max(next - cur, 0), ZONE_GAP_CAP_MS);
        seconds[zoneOf(samples[i].bpm) - 1].seconds += dt / 1000;
      }
      zones = seconds.map((z) => ({ ...z, seconds: Math.round(z.seconds) }));
    }

    return { workoutId, sampleCount: samples.length, avgHr, maxHr, minHr, maxHrConfig, zones, samples };
  });
}
