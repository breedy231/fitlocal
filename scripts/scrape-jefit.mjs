#!/usr/bin/env node
/**
 * Scrape JEFIT exercise database and match against our exercises.
 *
 * Step 1: Scrape all listing pages → build index of {id, name, slug}
 * Step 2: Fuzzy-match our DB exercises to JEFIT entries
 * Step 3: Fetch detail pages for matches → extract description + GIF
 * Step 4: Write corrections JSON
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

const JEFIT_BASE = 'https://www.jefit.com';
const DELAY_MS = 300; // polite delay between requests

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── Step 1: Scrape listing pages ──

async function scrapeListings() {
  const exercises = [];
  const seen = new Set();

  for (let page = 1; page <= 72; page++) {
    try {
      const html = await fetchPage(`${JEFIT_BASE}/exercises?page=${page}`);
      const re = /href="\/exercises\/(\d+)\/([^"]+)"/g;
      let match;
      while ((match = re.exec(html)) !== null) {
        const id = parseInt(match[1]);
        if (seen.has(id)) continue;
        seen.add(id);
        const slug = match[2];
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        exercises.push({ id, slug, name });
      }
      process.stdout.write(`\rScraped page ${page}/72 (${exercises.length} exercises)`);
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`\nError on page ${page}: ${err.message}`);
    }
  }
  console.log(`\nTotal JEFIT exercises found: ${exercises.length}`);
  return exercises;
}

// ── Step 2: Fuzzy matching ──

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordOverlap(a, b) {
  const wordsA = new Set(normalize(a).split(' '));
  const wordsB = new Set(normalize(b).split(' '));
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? overlap / union : 0;
}

function findBestMatch(ourName, jefitExercises) {
  let best = null;
  let bestScore = 0;

  const normOur = normalize(ourName);

  for (const je of jefitExercises) {
    const normJe = normalize(je.name);

    // Exact match
    if (normOur === normJe) return { ...je, score: 1.0 };

    // One contains the other
    if (normOur.includes(normJe) || normJe.includes(normOur)) {
      const score = 0.85;
      if (score > bestScore) { best = je; bestScore = score; }
      continue;
    }

    const score = wordOverlap(ourName, je.name);
    if (score > bestScore) { best = je; bestScore = score; }
  }

  return best && bestScore >= 0.4 ? { ...best, score: bestScore } : null;
}

// ── Step 3: Fetch detail pages ──

async function fetchExerciseDetail(id, slug) {
  const html = await fetchPage(`${JEFIT_BASE}/exercises/${id}/${slug}`);

  // Extract LD+JSON Exercise schema
  const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  let description = '';
  for (const block of ldMatches) {
    try {
      const json = block.replace(/<\/?script[^>]*>/g, '');
      const data = JSON.parse(json);
      if (data['@type'] === 'Exercise' && data.description) {
        description = data.description;
        break;
      }
    } catch {}
  }

  // Extract GIF URL
  const gifMatch = html.match(/https:\/\/cdn\.jefit\.com\/assets\/img\/exercises\/gifs\/\d+\.gif/);
  const gifUrl = gifMatch ? gifMatch[0] : null;

  // Clean up description: take first 2-3 sentences max for conciseness
  if (description) {
    description = description.replace(/\r\n/g, '\n').trim();
    // Take the first paragraph or ~300 chars as a concise description
    const paragraphs = description.split(/\n\n+/);
    if (paragraphs.length > 1 && paragraphs[0].length > 50) {
      description = paragraphs[0].trim();
    } else if (description.length > 400) {
      // Find a sentence break near 300 chars
      const cutoff = description.indexOf('.', 250);
      if (cutoff > 0 && cutoff < 500) {
        description = description.substring(0, cutoff + 1).trim();
      }
    }
  }

  return { description, gifUrl };
}

// ── Main ──

async function main() {
  // Get our exercises from SQLite
  const ourExercisesRaw = execSync(
    `sqlite3 -json ${join(REPO_ROOT, 'fitlocal.db')} "SELECT id, name, description, image_url FROM exercises ORDER BY id"`
  ).toString();
  const ourExercises = JSON.parse(ourExercisesRaw);
  console.log(`Our exercises: ${ourExercises.length}`);

  // Step 1: Scrape JEFIT listings
  console.log('\n── Step 1: Scraping JEFIT listings ──');
  const jefitExercises = await scrapeListings();

  // Save index for reference
  writeFileSync(
    join(SCRIPT_DIR, 'jefit-index.json'),
    JSON.stringify(jefitExercises, null, 2)
  );

  // Step 2: Match
  console.log('\n── Step 2: Matching exercises ──');
  const matches = [];
  const unmatched = [];

  for (const our of ourExercises) {
    const match = findBestMatch(our.name, jefitExercises);
    if (match) {
      matches.push({
        ourId: our.id,
        ourName: our.name,
        jefitId: match.id,
        jefitSlug: match.slug,
        jefitName: match.name,
        score: match.score,
        currentDesc: our.description || '',
        currentImage: our.image_url || '',
      });
    } else {
      unmatched.push({ id: our.id, name: our.name });
    }
  }

  console.log(`Matched: ${matches.length} / ${ourExercises.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log('Unmatched exercises:');
    for (const u of unmatched) {
      console.log(`  - [${u.id}] ${u.name}`);
    }
  }

  // Step 3: Fetch details for matches
  console.log('\n── Step 3: Fetching exercise details ──');
  const corrections = [];
  let fetched = 0;

  for (const m of matches) {
    try {
      const detail = await fetchExerciseDetail(m.jefitId, m.jefitSlug);
      fetched++;

      const needsDescFix = !m.currentDesc || m.currentDesc.length < 20 ||
        /Kontrollierte|Ausführung|Schwung|Muskulatur|Is english|^\[\[/.test(m.currentDesc);
      const needsImageFix = !m.currentImage || m.currentImage === '';

      if (detail.description && (needsDescFix || detail.description.length > 0)) {
        corrections.push({
          id: m.ourId,
          name: m.ourName,
          matchedTo: m.jefitName,
          score: m.score,
          newDescription: needsDescFix && detail.description ? detail.description : null,
          newImageUrl: needsImageFix && detail.gifUrl ? detail.gifUrl : null,
          // Also include good image even if we have one, in case current is wrong/duplicate
          availableGif: detail.gifUrl || null,
        });
      }

      process.stdout.write(`\rFetched ${fetched}/${matches.length}`);
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`\nError fetching ${m.jefitSlug}: ${err.message}`);
    }
  }

  console.log(`\nCorrections generated: ${corrections.length}`);

  // Write results
  writeFileSync(
    join(SCRIPT_DIR, 'exercise-corrections.json'),
    JSON.stringify(corrections, null, 2)
  );
  writeFileSync(
    join(SCRIPT_DIR, 'unmatched-exercises.json'),
    JSON.stringify(unmatched, null, 2)
  );

  console.log('\n✓ Written scripts/exercise-corrections.json');
  console.log('✓ Written scripts/unmatched-exercises.json');

  // Summary stats
  const descFixes = corrections.filter(c => c.newDescription).length;
  const imgFixes = corrections.filter(c => c.newImageUrl).length;
  const imgAvailable = corrections.filter(c => c.availableGif).length;
  console.log(`\nSummary:`);
  console.log(`  Descriptions to fix: ${descFixes}`);
  console.log(`  Images to add (missing): ${imgFixes}`);
  console.log(`  GIFs available (total): ${imgAvailable}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
