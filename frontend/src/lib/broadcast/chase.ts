import type { CompactState } from "@/lib/api/types";

/** Caption for a chasing innings on overlays and score plates. */
export function chaseCaption(
  score: CompactState["score"] | undefined,
  inningsSequence?: number | null,
): string | null {
  if (!score) return null;
  const chasing = score.target_runs != null || (inningsSequence != null && inningsSequence >= 2);
  if (!chasing) return null;
  const parts: string[] = [];
  if (score.target_runs != null) parts.push(`Target ${score.target_runs}`);
  if (score.runs_needed != null && score.runs_needed > 0) {
    parts.push(
      score.balls_remaining != null
        ? `Need ${score.runs_needed} from ${score.balls_remaining}`
        : `Need ${score.runs_needed}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Chase";
}
