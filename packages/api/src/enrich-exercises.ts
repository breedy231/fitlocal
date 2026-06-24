import Database from 'better-sqlite3';
import { pickBestDescription } from 'fitlocal-shared';

const DB_PATH = process.env.DATABASE_PATH || 'fitlocal.db';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity;

const sqlite = new Database(DB_PATH, DRY_RUN ? { readonly: true } : {});
sqlite.pragma('journal_mode = WAL');

const WGER = 'https://wger.de/api/v2';
const ENGLISH = 2; // wger language id for English

// One English translation row from /exercise-translation/.
interface WgerTranslation {
  id: number;
  name: string;
  exercise: number; // base id — the join key to /exerciseinfo/{id}/
  description: string;
  language: number;
}

interface WgerPaged<T> {
  next: string | null;
  results: T[];
}

// /exerciseinfo/{base_id}/ — the all-in-one detail endpoint that replaced the
// dead /exerciseinfo/{id}/ + /exercise/search/ flow. Carries nested
// translations, images, and (fully-expanded) equipment objects.
interface WgerExerciseInfo {
  id: number;
  translations: Array<{ language: number; name: string; description: string }>;
  images: Array<{ image: string; is_main: boolean }>;
  equipment: Array<{ id: number; name: string }>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

// Normalize a name for matching: lowercase, collapse all non-alphanumerics to a
// single space. Lets "Pull-ups" match wger's "Pull ups", etc.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, retries = 3): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as T;
    } catch {
      // network flake — retry with backoff below
    }
    if (attempt < retries) await delay(500 * (attempt + 1));
  }
  return null;
}

/**
 * wger removed the fuzzy /exercise/search/ endpoint. The only way to resolve a
 * name to a base id now is to page the full English translation list and build
 * a normalized name -> base id index ourselves. ~3.4k rows / ~17 pages.
 */
async function buildNameIndex(): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  let url: string | null = `${WGER}/exercise-translation/?format=json&language=${ENGLISH}&limit=200`;
  let page = 0;

  while (url) {
    const data: WgerPaged<WgerTranslation> | null = await fetchJson(url);
    if (!data) {
      // Fail loud: a truncated index silently produces spurious "No match"
      // results for names that actually exist on later pages.
      throw new Error(`wger name index failed on page ${page} (${url}) — aborting to avoid partial index`);
    }
    for (const t of data.results) {
      const key = normalizeName(t.name);
      // First occurrence wins — keeps the index stable across runs.
      if (key && !index.has(key)) index.set(key, t.exercise);
    }
    url = data.next;
    page++;
    await delay(200);
  }

  console.log(`Built wger name index: ${index.size} English exercise names (${page} pages)`);
  return index;
}

async function main() {
  const exercises = sqlite
    .prepare('SELECT id, name, description, wger_id FROM exercises')
    .all() as Array<{
    id: number;
    name: string;
    description: string | null;
    wger_id: number | null;
  }>;

  const toEnrich = exercises.filter((e) => !e.description).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(
    `Found ${exercises.filter((e) => !e.description).length}/${exercises.length} exercises needing enrichment` +
      (LIMIT !== Infinity ? ` (processing ${toEnrich.length} due to --limit)` : '') +
      (DRY_RUN ? ' [DRY RUN — no writes]' : '')
  );

  const nameIndex = await buildNameIndex();

  const update = sqlite.prepare(
    'UPDATE exercises SET description = ?, image_url = ?, wger_id = ? WHERE id = ?'
  );

  let enriched = 0;

  for (const exercise of toEnrich) {
    const baseId = nameIndex.get(normalizeName(exercise.name));

    if (baseId == null) {
      console.log(`  No match: ${exercise.name}`);
      continue;
    }

    // Single all-in-one lookup: translations + images + equipment.
    const info = await fetchJson<WgerExerciseInfo>(`${WGER}/exerciseinfo/${baseId}/?format=json`);
    await delay(300);

    if (!info) {
      console.log(`  No info (base ${baseId}): ${exercise.name}`);
      continue;
    }

    // Prefer the English (language 2) translation, but fall back to scanning all
    // translations — wger sometimes mislabels non-English text as English, and
    // some entries only carry usable how-to text in another translation slot.
    // pickBestDescription filters non-Latin text and prefers instructional copy.
    const candidates = (info.translations ?? [])
      .sort((a, b) => (a.language === ENGLISH ? -1 : 0) - (b.language === ENGLISH ? -1 : 0))
      .map((t) => stripHtml(t.description));
    const description = pickBestDescription(candidates);

    const mainImage = info.images?.find((img) => img.is_main);
    const image = mainImage?.image || info.images?.[0]?.image || null;

    // Bonus (issue #44): wger's equipment taxonomy, for cross-checking the
    // name-based tags from #33. Logged, not persisted — equipment tagging lives
    // in equipment-classifier.ts.
    const equipment = (info.equipment ?? []).map((e) => e.name).join(', ') || 'none';

    if (!DRY_RUN) {
      update.run(description, image, baseId, exercise.id);
    }
    enriched++;
    console.log(
      `  ${DRY_RUN ? 'Would enrich' : 'Enriched'} ${enriched}: ${exercise.name} ` +
        `(base ${baseId}, equip: ${equipment}, desc: ${description ? `${description.length} chars` : 'none'}, img: ${image ? 'yes' : 'no'})`
    );
  }

  console.log(`\nDone! ${DRY_RUN ? 'Would enrich' : 'Enriched'} ${enriched}/${toEnrich.length} exercises`);
  sqlite.close();
}

main().catch(console.error);
