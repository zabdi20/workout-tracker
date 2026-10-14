import type { PrKind } from '../domain/records';

const LABELS: Record<PrKind, string> = {
  heaviest: 'heaviest',
  e1rm: 'est. 1RM',
  reps: 'rep best',
};

/** The record types a set earned, e.g. "PR: heaviest, est. 1RM". */
export function PrBadge({ kinds }: { kinds: PrKind[] }) {
  return <span className="pr-badge">{`PR: ${kinds.map((k) => LABELS[k]).join(', ')}`}</span>;
}
