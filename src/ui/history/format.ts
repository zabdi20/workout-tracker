/** Whole minutes, or a dash for a workout with no recorded end. */
export function formatWorkoutDuration(startedAt: number, endedAt?: number): string {
  if (endedAt === undefined) return '—';
  return `${Math.round((endedAt - startedAt) / 60_000)} min`;
}
