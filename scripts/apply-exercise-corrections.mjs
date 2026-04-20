#!/usr/bin/env node
/**
 * Apply exercise data corrections from JEFIT scrape + manual descriptions.
 * Run after scrape-jefit.mjs has produced exercise-corrections.json.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';

const db = new Database('fitlocal.db');
db.pragma('journal_mode = WAL');

const corrections = JSON.parse(
  readFileSync('scripts/exercise-corrections.json', 'utf-8')
);

// ── Manual descriptions for unmatched + bad-match exercises ──
// Format: { id: { description, imageUrl? } }
const manual = {
  // Foam rolls
  1:   { description: 'Place a foam roller under your hamstrings and roll slowly from just above the knee to just below the glutes, pausing on tender spots.' },
  2:   { description: 'Lie face down with a foam roller under your quadriceps. Roll from just above the knee to the hip, pausing on tight areas.' },
  3:   { description: 'Sit on a foam roller with one ankle crossed over the opposite knee. Lean into the crossed side and roll over the glute, pausing on tight spots.' },
  14:  { description: 'Lie face down with a foam roller under your chest near the armpit. Roll slowly across the pec muscles, pausing on tender areas.' },
  16:  { description: 'Sit on the floor and place a foam roller under your lower back. Roll gently from the mid-back to just above the hips.' },
  30:  { description: 'Lie on your side with a foam roller under your armpit. Roll along the lat from the armpit to the mid-ribcage, pausing on tight spots.' },
  40:  { description: 'Lie on your side with a foam roller under the outer thigh. Roll from the hip to just above the knee along the IT band and outer thigh.' },
  41:  { description: 'Sit with one leg extended and the foam roller under the inner thigh. Roll from the knee toward the groin, pausing on tender spots.' },
  47:  { description: 'Sit on the floor with a foam roller under your calves. Roll from above the ankle to just below the knee, pausing on tight areas.' },

  // TRX exercises
  78:  { description: 'Grip TRX handles and lean back with arms extended. Pull your chest toward the handles by squeezing your shoulder blades together, then lower with control.' },
  239: { description: 'Hold a TRX handle in one hand in a side plank position. Rotate your hips and throw your free arm under your body, then rotate back open explosively.' },
  242: { description: 'Face the TRX anchor in a staggered stance. Start with one arm extended holding a handle, then pull yourself up while rotating your torso open.' },
  245: { description: 'Face the TRX anchor with both handles. Pull yourself forward at different angles like clock positions — 10 o\'clock, 12, and 2 o\'clock — to target different back muscles.' },
  246: { description: 'Face the TRX anchor holding both handles. Perform a swimming motion, alternating arms in a wide pull pattern while maintaining a lean-back body position.' },
  264: { description: 'Lie face up with heels in TRX foot cradles. Bridge your hips up and alternately drive each knee toward your chest in a running motion.' },
  269: { description: 'Lie face up with heels in TRX foot cradles. Bridge your hips up, then alternate pulling each heel toward your glutes.' },
  270: { description: 'Stand facing away from the TRX anchor with one foot in a cradle behind you. Perform pulse lunges — small, quick partial-range lunges on the front leg.' },

  // Mini loop band exercises
  100: { description: 'Lie on your side with a mini loop band around your thighs just above the knees. Keep feet together and open the top knee like a clamshell, then lower with control.' },
  142: { description: 'Kneel with a mini loop band around your wrists. Hinge forward slightly and pull one arm back in a rowing motion while the band provides resistance.' },
  147: { description: 'Hold a mini loop band with both hands overhead. Press one arm straight down to your side against the band\'s resistance, then return slowly.' },
  167: { description: 'Stand with a mini loop band around your wrists, arms extended overhead. Pull your hands apart in a fly motion, squeezing your shoulder blades together.' },
  286: { description: 'Stand on one leg with a mini loop band around your wrists. Hinge forward into a single-leg Romanian deadlift, then row one arm up at the bottom.' },
  308: { description: 'Lie face up with a mini loop band around your thighs just above the knees. Drive your hips up into a bridge while pressing outward against the band.' },
  309: { description: 'Get on all fours with a mini loop band around your thighs above the knees. Keeping the knee bent, lift one leg out to the side like a fire hydrant.' },
  326: { description: 'With a mini loop band around your ankles, step into a lunge, then kick the back leg straight behind you at the top before stepping into the next lunge.' },
  328: { description: 'With a mini loop band around your thighs just above the knees, perform walking lunges while pressing outward against the band throughout the movement.' },

  // Handle/resistance band
  57:  { description: 'Stand on a resistance band and hold the handles with palms facing down. Raise your arms straight in front of you to shoulder height, then lower with control.' },
  93:  { description: 'Stand on a resistance band, hinge forward at the hips, and pull the handles toward your ribcage. Squeeze your shoulder blades together at the top.' },
  107: { description: 'Sit on a resistance band with handles at shoulder height. Press both handles overhead until your arms are fully extended, then lower with control.' },
  111: { description: 'Stand on a resistance band and press the handles overhead from shoulder height until arms are fully extended, then lower with control.' },
  116: { description: 'Anchor a resistance band at mid-height. With arms extended forward, pull the handles apart and back, squeezing your rear delts and shoulder blades.' },
  119: { description: 'Anchor a loop band overhead. Grip it with one hand and press downward, extending the elbow to work the triceps. Return slowly.' },
  180: { description: 'Stand on a loop band and hinge forward. Pull the band toward your ribcage with both hands, squeezing your shoulder blades together at the top.' },

  // Common exercises JEFIT didn't match
  7:   { description: 'Lie face down on a leg curl machine with the pad behind your ankles. Curl your heels toward your glutes by bending at the knees, then lower with control.' },
  21:  { description: 'Hinge forward with a dumbbell in one hand, upper arm parallel to your torso. Extend your forearm back until the arm is straight, squeezing the tricep at the top.' },
  28:  { description: 'Lie on your side with knees bent at 90 degrees and a band around your thighs. Keeping your feet together, open the top knee up, then lower with control.' },
  31:  { description: 'Stand with feet together and arms overhead. Bend forward at the hips to touch your toes with straight legs, then stand back up.' },
  45:  { description: 'Stand with a barbell across your upper back. Bend your knees and hips to lower into a squat until thighs are parallel, then drive back up.' },
  46:  { description: 'Stand tall and squeeze your shoulder blades together and down, holding the contraction for a few seconds. Releases upper back and shoulder tension.' },
  49:  { description: 'Stand with feet shoulder-width apart. Lower into a squat by bending your knees and pushing your hips back, then stand back up. Bodyweight only.' },
  52:  { description: 'Stand with arms at your sides. Make large forward circles with both arms, gradually increasing the range of motion to warm up the shoulders.' },
  53:  { description: 'Stand with arms at your sides. Make large backward circles with both arms, gradually increasing the range of motion to warm up the shoulders.' },
  55:  { description: 'Stand on one leg and swing the other leg in circles out to the side, keeping the movement controlled. Warms up the hip joint.' },
  64:  { description: 'Lie face down with arms bent in a W shape. Squeeze your shoulder blades together and lift your hands off the floor, hold briefly, then lower.' },
  84:  { description: 'Stand holding dumbbells at your sides with palms facing your body. Curl both dumbbells up without rotating your wrists, keeping a neutral grip throughout.' },
  86:  { description: 'Lie on a bench holding a dumbbell in one hand with arm extended overhead. Bend the elbow to lower the weight toward your forehead, then extend back up.' },
  88:  { description: 'Stand holding an EZ-bar with an underhand grip on the angled portions. Curl the bar up toward your shoulders, then lower with control.' },
  96:  { description: 'Step forward into a lunge, then rotate your torso toward the front leg while holding the bottom position. Return to standing and alternate sides.' },
  125: { description: 'Stand holding dumbbells with a wider-than-shoulder grip and palms up. Curl both dumbbells toward your shoulders, emphasizing the outer bicep head.' },
  126: { description: 'Lie face down and make small forward circles with your legs from the hips, keeping them straight. Opens up the hip flexors and warms the joint.' },
  129: { description: 'Lie face down and make circles with your legs from the hips, alternating directions. Mobilizes the hip joint and warms the surrounding muscles.' },
  134: { description: 'Lie on a bench holding a barbell with arms extended overhead. Bend your elbows to lower the bar toward your forehead, then press back up.' },
  137: { description: 'From a crab position (hands and feet on the floor, hips up), reach one hand over and across your body toward the opposite side while lifting your hips.' },
  139: { description: 'Sit on the edge of a bench or lie on the floor. Pull your knees in toward your chest, then extend your legs straight out without touching the floor.' },
  162: { description: 'Stand next to a cable machine. Pull the handle across your body from low to high in a rowing motion, rotating your torso for a full contraction.' },
  170: { description: 'Sit at a lat pulldown machine and grip the bar with palms facing you (supinated). Pull the bar down to your upper chest, squeezing your lats.' },
  171: { description: 'Stand with feet hip-width apart and a slight bend in the knees. Push your hips back while keeping your back flat, then return to standing. Foundational movement pattern.' },
  181: { description: 'Hold a dumbbell vertically by one end with both hands like a waiter holding a tray. Curl it up by bending at the elbows, keeping your upper arms still.' },
  183: { description: 'Hold dumbbells at your sides. Raise them laterally to shoulder height, then sweep them forward in front of you. Lower and repeat.' },
  187: { description: 'Stand holding an EZ-bar with a narrow, underhand grip on the inner angles. Curl the bar up toward your shoulders, then lower with control. Emphasizes the inner bicep head.' },
  191: { description: 'Stand with feet together. Jump feet out to a wide stance while pressing arms overhead, then jump back to center. A lower-impact jumping jack variation.' },
  203: { description: 'Straddle a T-bar row machine or a barbell anchored in a corner. Bend forward and row the weight toward your chest, squeezing your back at the top.' },
  205: { description: 'Sit at a lat pulldown station with a V-bar attachment. Pull the bar down toward your upper chest with a neutral grip, squeezing your lats at the bottom.' },
  210: { description: 'Stand beside a line on the floor. Hop forward and back over the line quickly, staying light on your feet. Builds agility and foot speed.' },
  223: { description: 'Stand beside a line on the floor. Hop side to side over the line quickly, staying light on your feet. Builds lateral agility.' },
  232: { description: 'Sit on a decline bench holding a weight at your chest. Rotate your torso side to side, touching the weight to each side of the bench.' },
  251: { description: 'Lie face down on an incline bench with arms hanging straight down holding dumbbells. Curl the weights up while keeping your upper arms stationary against the bench.' },
  253: { description: 'Stand in a wide stance bent forward with two kettlebells or dumbbells on the floor. Row one weight up while bracing against the other, alternating sides.' },
  259: { description: 'Stand on a BOSU ball or balance trainer with feet shoulder-width apart. Perform squats while maintaining balance on the unstable surface.' },
  273: { description: 'Sit with legs extended. Alternately point your toes forward and flex them back toward your shins. Mobilizes the ankle joint.' },
  274: { description: 'Jog in place, kicking your heels up toward your glutes with each stride. Warms up the quadriceps and hamstrings.' },
  275: { description: 'Lie on your back with arms and legs extended. Simultaneously lift your upper body and legs to touch your toes at the top, forming a V shape.' },
  278: { description: 'Position yourself face down on a back extension bench with your hips on the pad. Lower your torso toward the floor, then raise back up by squeezing your lower back and glutes.' },
  282: { description: 'From standing, bend forward and walk your hands out into a plank position. Walk your hands back to your feet and stand up. Stretches hamstrings and warms the core.' },
  293: { description: 'Stand with dumbbells at your sides. Explosively pull them up by extending your hips and shrugging your shoulders, catching them at shoulder height.' },
  295: { description: 'Hold dumbbells at shoulder height. Squat down, then drive up explosively while pressing the dumbbells overhead in one fluid motion.' },
  302: { description: 'Sit on the floor with hands behind you, fingers pointing back. Lift your hips off the floor until your torso is parallel to the ground, like an upside-down tabletop.' },
  304: { description: 'Stand holding a single dumbbell or kettlebell at shoulder height. Press it overhead until your arm is fully extended, then lower with control.' },
  311: { description: 'From a lunge position, perform small, quick up-and-down pulses without fully standing up. Keeps constant tension on the quads and glutes.' },
  315: { description: 'Hold a kettlebell by the horns at chest height. Circle it around your head in a smooth motion, alternating directions. Mobilizes the shoulders.' },
  320: { description: 'Hold a dumbbell overhead with one arm. From a kneeling position, stand up while keeping the weight locked out overhead, then kneel back down.' },
  321: { description: 'Hold dumbbells at your sides with palms facing forward. Curl them up only to mid-range (about 90 degrees), keeping constant tension on the biceps.' },
  323: { description: 'Hold a dumbbell at your chest. From a kneeling position, step one foot forward and stand up, then reverse the motion back to kneeling.' },
  332: { description: 'From a lunge position, explosively jump and switch legs in mid-air, landing in a lunge with the opposite foot forward.' },
  337: { description: 'Ride a stationary bike at a steady or interval pace. Builds cardiovascular endurance with low impact on joints.' },
  371: { description: 'Step up and down on a stair stepper machine at a steady pace. Builds lower body endurance and cardiovascular fitness.' },
  380: { description: 'Jog in place, lifting your knees to a comfortable height. A low-impact cardio warm-up exercise.' },
  386: { description: 'Lie on a bench holding a barbell or EZ-bar with arms extended overhead. Bend your elbows to lower the weight toward your forehead, then press back up.' },

  // Stretches and mobility
  123: { description: 'Sit with one leg extended and one folded in. Reach toward the extended foot, fanning your body gently side to side to stretch the hamstring and obliques.' },
  343: { description: 'Sit in a shin box position (one leg internally rotated, one externally). Lean toward the front leg to stretch the quad of the back leg.' },
  344: { description: 'From a lunge position, lower your back knee to the floor and slide the front foot forward until you feel a deep stretch in the hip flexor and glute.' },
  345: { description: 'Sit with legs extended. Reach forward toward your toes, folding at the hips to stretch the hamstrings and lower back.' },
  346: { description: 'Stand or sit tall. Clasp your hands behind your back and open your chest by pulling your shoulders back and lifting your sternum.' },
  347: { description: 'Exhale fully and draw your belly button in toward your spine as far as possible. Hold the contraction, then release and breathe in. Strengthens the transverse abdominis.' },
  348: { description: 'Kneel in a shin box position and shift your weight forward over the front leg to stretch the hip flexor of the back leg.' },
  350: { description: 'Stand with feet hip-width apart. Fold forward from the hips, letting your arms and head hang toward the floor. Stretches the hamstrings and lower back.' },
  351: { description: 'Stand tall, reach one arm behind your back, and open your chest by rotating away from the reaching arm. Stretches the chest and anterior shoulder.' },
  352: { description: 'Sit or stand tall and gently drop your chin toward your chest. Hold to stretch the back of the neck and upper traps.' },
  353: { description: 'Lie on your back with legs extended. Press one heel away from you, lengthening that side of the body. Stretches the hip and lower back.' },
  354: { description: 'Lie face down with palms under your shoulders. Press your chest up while keeping your hips on the floor, arching your back. Opens the chest and stretches the abs.' },
  355: { description: 'Sit in a chair and cross one ankle over the opposite knee. Lean forward gently to stretch the outer hip and glute of the crossed leg.' },
  356: { description: 'Stand in a split stance with one foot forward. Lower your back knee toward the floor without moving your feet, then press back up. A stationary lunge.' },
  357: { description: 'Stand on one leg and fold forward from the hips, reaching toward the standing foot with both hands. Stretches the hamstring of the standing leg.' },
  358: { description: 'Stand with feet wider than shoulder-width. Squat down, then rotate your torso to one side reaching one arm overhead. Alternate sides.' },
  360: { description: 'Lie on your back and cross one ankle over the opposite knee. Pull the bottom leg toward your chest to stretch the outer hip and glute of the crossed leg.' },
  363: { description: 'Sit or stand tall and place your hand on the side of your head. Press gently sideways while resisting with your neck. Hold isometrically to strengthen the lateral neck.' },
  365: { description: 'Place your hand on your forehead and press forward while resisting with your neck. Hold isometrically to strengthen the front of the neck.' },
  366: { description: 'Place your hand on the back of your head and press backward while resisting with your neck. Hold isometrically to strengthen the rear neck muscles.' },
  367: { description: 'Sit with legs spread wide apart. Lean forward from the hips, reaching your hands toward the floor between your legs. Stretches the inner thighs and groin.' },
  368: { description: 'Step into a lunge, then reach back and grab your rear ankle, pulling your heel toward your glute for a combined hip flexor and quad stretch.' },
  370: { description: 'Stand and cross one foot in front of the other. Fold forward from the hips toward the floor. Stretches the outer hip, IT band, and hamstrings of the back leg.' },
  374: { description: 'Hold dumbbells or just make fists with arms bent at 90 degrees. Hold the position isometrically, keeping tension on the biceps without moving.' },
  375: { description: 'Stand on one leg and lift the other leg straight out to the side. Hold the position to build hip abductor strength and balance.' },

  // Garbage entries to delete
  387: null,
  388: null,
};

// ── Apply corrections ──

const updateStmt = db.prepare(
  'UPDATE exercises SET description = COALESCE(?, description), image_url = COALESCE(?, image_url) WHERE id = ?'
);
const deleteStmt = db.prepare('DELETE FROM exercises WHERE id = ?');

const applyAll = db.transaction(() => {
  let descUpdated = 0;
  let imgUpdated = 0;
  let deleted = 0;

  // 1. Apply JEFIT-sourced corrections
  for (const c of corrections) {
    // Skip low-confidence matches for description overwrites
    if (c.score < 0.5 && c.newDescription) {
      // Only apply image if available (images are less sensitive to mismatch)
      if (c.availableGif) {
        updateStmt.run(null, c.availableGif, c.id);
        imgUpdated++;
      }
      continue;
    }

    const desc = c.newDescription || null;
    const img = c.newImageUrl || (c.availableGif && !c.newImageUrl ? c.availableGif : null);

    // For exercises that already have descriptions but JEFIT has a better one,
    // update the image even if we're not overwriting the description
    if (desc || img) {
      updateStmt.run(desc, img, c.id);
      if (desc) descUpdated++;
      if (img) imgUpdated++;
    } else if (c.availableGif) {
      // Always use JEFIT GIF if available (animated > static)
      updateStmt.run(null, c.availableGif, c.id);
      imgUpdated++;
    }
  }

  // 2. Apply manual corrections for unmatched exercises
  for (const [idStr, value] of Object.entries(manual)) {
    const id = parseInt(idStr);
    if (value === null) {
      deleteStmt.run(id);
      deleted++;
    } else {
      updateStmt.run(value.description, value.imageUrl || null, id);
      descUpdated++;
    }
  }

  return { descUpdated, imgUpdated, deleted };
});

const result = applyAll();
console.log(`✓ Descriptions updated: ${result.descUpdated}`);
console.log(`✓ Images updated: ${result.imgUpdated}`);
console.log(`✓ Garbage entries deleted: ${result.deleted}`);

// ── Verify results ──
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN description IS NOT NULL AND description != '' AND length(description) > 20 THEN 1 ELSE 0 END) as has_desc,
    SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END) as has_img,
    SUM(CASE WHEN description LIKE '%Kontrollierte%' OR description LIKE '%Schwung%' OR description LIKE '%Muskulatur%' THEN 1 ELSE 0 END) as german,
    SUM(CASE WHEN description LIKE '%Is english%' THEN 1 ELSE 0 END) as bad_english
  FROM exercises
`).get();

console.log(`\nPost-migration stats:`);
console.log(`  Total exercises: ${stats.total}`);
console.log(`  With good description: ${stats.has_desc}`);
console.log(`  With image: ${stats.has_img}`);
console.log(`  Still has German text: ${stats.german}`);
console.log(`  Still has 'Is english': ${stats.bad_english}`);

db.close();
