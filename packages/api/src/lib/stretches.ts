export interface Stretch {
  name: string;
  muscles: string[];
  duration: number;
  instructions: string;
}

export const STRETCH_LIBRARY: Stretch[] = [
  { name: 'Wall Pectoral Stretch', muscles: ['chest'], duration: 30, instructions: 'Stand next to a wall, place your arm at 90 degrees, and gently rotate away.' },
  { name: 'Cross-Body Shoulder Stretch', muscles: ['shoulders'], duration: 30, instructions: 'Pull one arm across your chest and hold with the other arm.' },
  { name: 'Tricep Overhead Stretch', muscles: ['triceps'], duration: 30, instructions: 'Raise one arm overhead, bend at elbow, use other hand to gently push down.' },
  { name: 'Doorway Chest Stretch', muscles: ['chest'], duration: 30, instructions: 'Stand in a doorway with arms at 90 degrees on the frame, lean forward.' },
  { name: "Child's Pose", muscles: ['back', 'shoulders'], duration: 30, instructions: 'Kneel and stretch arms forward on the floor, hold.' },
  { name: 'Cat-Cow Stretch', muscles: ['back'], duration: 30, instructions: 'On hands and knees, alternate arching and rounding your back.' },
  { name: 'Lat Stretch (overhead)', muscles: ['back'], duration: 30, instructions: 'Grab a fixed point overhead and lean away to stretch the lat.' },
  { name: 'Standing Bicep Stretch', muscles: ['biceps'], duration: 30, instructions: 'Extend arm behind you with thumb down, gently lift away from body.' },
  { name: 'Standing Quad Stretch', muscles: ['quads'], duration: 30, instructions: 'Stand on one leg, pull the other foot to your glute.' },
  { name: 'Standing Hamstring Stretch', muscles: ['hamstrings'], duration: 30, instructions: 'Place heel on an elevated surface, hinge forward at the hip.' },
  { name: 'Hip Flexor Stretch (Kneeling)', muscles: ['quads', 'glutes'], duration: 30, instructions: 'Kneel on one knee, push hips forward gently.' },
  { name: 'Pigeon Pose', muscles: ['glutes', 'hamstrings'], duration: 45, instructions: 'Bring one knee forward at an angle, extend the other leg back, lower hips.' },
  { name: 'Seated Figure Four', muscles: ['glutes'], duration: 30, instructions: 'Sit and cross one ankle over the opposite knee, lean forward.' },
  { name: 'Standing Calf Stretch', muscles: ['calves'], duration: 30, instructions: 'Step one foot back, press heel into the floor, lean into wall.' },
  { name: 'Butterfly Stretch', muscles: ['hamstrings', 'glutes'], duration: 30, instructions: 'Sit with soles of feet together, gently press knees toward floor.' },
];

export function getStretchesForMuscles(muscleGroups: string[], count = 3): Stretch[] {
  const lowerGroups = muscleGroups.map(m => m.toLowerCase());
  const matching = STRETCH_LIBRARY.filter(s =>
    s.muscles.some(m => lowerGroups.includes(m))
  );

  // Shuffle and pick unique stretches
  const shuffled = matching.sort(() => Math.random() - 0.5);
  const selected: Stretch[] = [];
  const usedNames = new Set<string>();

  for (const s of shuffled) {
    if (usedNames.has(s.name)) continue;
    selected.push(s);
    usedNames.add(s.name);
    if (selected.length >= count) break;
  }

  return selected;
}
