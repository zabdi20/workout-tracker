import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildLibrary, type SourceExercise } from '../src/data/mapping';

const sources: SourceExercise[] = JSON.parse(
  readFileSync('vendor/free-exercise-db.json', 'utf8'),
);

const library = buildLibrary(sources);

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/exercises.json', JSON.stringify(library, null, 2) + '\n');

const byEquipment = library.reduce<Record<string, number>>((acc, e) => {
  acc[e.equipment] = (acc[e.equipment] ?? 0) + 1;
  return acc;
}, {});

console.log(`Read    ${sources.length} source exercises`);
console.log(`Wrote   ${library.length} exercises to src/data/exercises.json`);
console.log('By equipment:', byEquipment);
