import Database from 'better-sqlite3';

const sqlite = new Database('fitlocal.db');
sqlite.pragma('journal_mode = WAL');

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

async function main() {
  const exercises = sqlite.prepare('SELECT id, name, description, wger_id FROM exercises').all() as Array<{
    id: number; name: string; description: string | null; wger_id: number | null;
  }>;

  const toEnrich = exercises.filter(e => !e.description || (!e.image_url && e.wger_id));
  console.log(`Found ${toEnrich.length}/${exercises.length} exercises needing enrichment`);

  const update = sqlite.prepare(
    'UPDATE exercises SET description = ?, image_url = ?, wger_id = ? WHERE id = ?'
  );

  let enriched = 0;
  let failed = 0;

  for (const exercise of toEnrich) {
    try {
      // Search wger
      const encoded = encodeURIComponent(exercise.name);
      const searchRes = await fetch(
        `https://wger.de/api/v2/exercise/search/?term=${encoded}&language=english&format=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!searchRes.ok) { failed++; continue; }
      const searchData = await searchRes.json() as any;

      if (!searchData?.suggestions?.length) {
        console.log(`  No match: ${exercise.name}`);
        failed++;
        await delay(200);
        continue;
      }

      const baseId = searchData.suggestions[0].data.base_id;

      // Get exercise info for description
      const infoRes = await fetch(
        `https://wger.de/api/v2/exerciseinfo/${baseId}/?format=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      const info = infoRes.ok ? await infoRes.json() as any : null;
      await delay(200);

      const englishTranslation = info?.translations?.find((t: any) => t.language === 2);
      const description = englishTranslation?.description ? stripHtml(englishTranslation.description) : null;

      // Get image
      const imgRes = await fetch(
        `https://wger.de/api/v2/exerciseimage/?exercise_base=${baseId}&format=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      const imgData = imgRes.ok ? await imgRes.json() as any : null;
      await delay(200);

      const mainImage = imgData?.results?.find((img: any) => img.is_main);
      const image = mainImage?.image || imgData?.results?.[0]?.image || null;

      update.run(description, image, baseId, exercise.id);
      enriched++;
      if (enriched % 25 === 0) console.log(`  Progress: ${enriched}/${toEnrich.length}`);
    } catch (e: any) {
      failed++;
      console.log(`  Error on ${exercise.name}: ${e.message}`);
      await delay(500);
    }
  }

  console.log(`\nDone! Enriched ${enriched}/${toEnrich.length} exercises (${failed} failed)`);
  sqlite.close();
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

main().catch(console.error);
