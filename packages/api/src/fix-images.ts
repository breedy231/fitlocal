import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../../fitlocal.db');
const db = new Database(dbPath);

const exercises = db.prepare('SELECT id, name, wger_id FROM exercises WHERE wger_id IS NOT NULL').all() as any[];
console.log(`Fixing images for ${exercises.length} exercises...`);

const update = db.prepare('UPDATE exercises SET image_url = ? WHERE id = ?');
let fixed = 0;

for (const ex of exercises) {
  try {
    const res = await fetch(`https://wger.de/api/v2/exerciseinfo/${ex.wger_id}/?format=json`);
    if (!res.ok) { await new Promise(r => setTimeout(r, 500)); continue; }
    const data = await res.json() as any;
    const img = data.images?.find((i: any) => i.is_main) ?? data.images?.[0];
    if (img?.image) {
      const url = img.image.startsWith('http') ? img.image : `https://wger.de${img.image}`;
      update.run(url, ex.id);
      fixed++;
    } else {
      update.run(null, ex.id);
    }
    if (fixed % 25 === 0 && fixed > 0) console.log(`Progress: ${fixed} fixed...`);
    await new Promise(r => setTimeout(r, 350));
  } catch { /* skip */ }
}
console.log(`Done. ${fixed}/${exercises.length} exercises have images.`);
db.close();
