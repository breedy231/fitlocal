import Database from 'better-sqlite3';
import { pickBestDescription } from 'fitlocal-shared';

const sqlite = new Database('fitlocal.db');
sqlite.pragma('journal_mode = WAL');

interface WgerSearchResult {
  suggestions: Array<{
    data: { id: number; base_id: number; name: string };
  }>;
}

interface WgerExerciseInfo {
  id: number;
  muscles: Array<{ id: number; name: string; name_en: string }>;
  muscles_secondary: Array<{ id: number; name: string; name_en: string }>;
  translations: Array<{ language: number; description: string }>;
}

interface WgerImageResult {
  results: Array<{ image: string; is_main: boolean }>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function main() {
  const exercises = sqlite.prepare('SELECT id, name, description, wger_id FROM exercises').all() as Array<{
    id: number;
    name: string;
    description: string | null;
    wger_id: number | null;
  }>;

  const toEnrich = exercises.filter((e) => !e.description);
  console.log(`Found ${toEnrich.length}/${exercises.length} exercises needing enrichment`);

  const update = sqlite.prepare(
    'UPDATE exercises SET description = ?, image_url = ?, wger_id = ? WHERE id = ?'
  );

  let enriched = 0;

  for (const exercise of toEnrich) {
    const encoded = encodeURIComponent(exercise.name);
    const searchUrl = `https://wger.de/api/v2/exercise/search/?term=${encoded}&language=english&format=json`;
    const searchResult = await fetchJson<WgerSearchResult>(searchUrl);

    if (!searchResult?.suggestions?.length) {
      console.log(`  No match: ${exercise.name}`);
      await delay(300);
      continue;
    }

    const baseId = searchResult.suggestions[0].data.base_id;

    // Get exercise info
    const infoUrl = `https://wger.de/api/v2/exerciseinfo/${baseId}/?format=json`;
    const info = await fetchJson<WgerExerciseInfo>(infoUrl);
    await delay(300);

    if (!info) {
      console.log(`  No info: ${exercise.name}`);
      continue;
    }

    // Prefer the English language-2 translation, but fall back to scanning all
    // translations — wger sometimes mislabels non-English text as English, and
    // some entries only carry usable how-to text in another translation slot.
    // pickBestDescription filters non-Latin text and prefers instructional copy.
    const candidates = (info.translations ?? [])
      .sort((a, b) => (a.language === 2 ? -1 : 0) - (b.language === 2 ? -1 : 0))
      .map((t) => stripHtml(t.description));
    const description = pickBestDescription(candidates);

    // Get image
    const imageUrl = `https://wger.de/api/v2/exerciseimage/?exercise_base=${baseId}&format=json`;
    const imageResult = await fetchJson<WgerImageResult>(imageUrl);
    await delay(300);

    const mainImage = imageResult?.results?.find((img) => img.is_main);
    const image = mainImage?.image || imageResult?.results?.[0]?.image || null;

    update.run(description, image, baseId, exercise.id);
    enriched++;
    console.log(`  Enriched ${enriched}/${toEnrich.length}: ${exercise.name}`);
  }

  console.log(`\nDone! Enriched ${enriched}/${toEnrich.length} exercises`);
  sqlite.close();
}

main().catch(console.error);
