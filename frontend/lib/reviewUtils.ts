import type { Detection } from '@/types';

/**
 * The FINAL VERIFIED SET of detections — what every surface outside Review
 * Mode should render.
 *
 * Drops:
 *  - CV detections the engineer rejected (`review_action === 'rejected'`)
 *  - stale CV originals that were replaced by a modification
 *    (`review_action === 'modified'` on a non-engineer detection — the
 *    corrected copy exists as a separate engineer_added detection)
 *
 * Keeps: accepted, unreviewed (review_action == null — no-op pre-review),
 * and ALL engineer_added detections ('modified' replacements and 'added').
 */
export function verifiedDetections(dets: Detection[]): Detection[] {
  return dets.filter(
    (d) =>
      d.source === 'engineer_added' ||
      (d.review_action !== 'rejected' && d.review_action !== 'modified'),
  );
}
