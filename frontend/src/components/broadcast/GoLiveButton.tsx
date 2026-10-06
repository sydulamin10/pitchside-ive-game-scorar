import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { useCanGoLive } from "@/lib/liveAccess";

export function GoLiveButton({
  matchId,
  liveUnlocked = false,
  size = "sm",
  fullWidth = false,
  hint = false,
}: {
  matchId: string;
  liveUnlocked?: boolean;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  hint?: boolean;
}) {
  const { locked, reason } = useCanGoLive(matchId, liveUnlocked);
  const href = `/app/matches/${matchId}/broadcast`;

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      {locked ? (
        <Button
          size={size}
          variant="secondary"
          fullWidth={fullWidth}
          disabled
          title={reason}
        >
          Go Live
        </Button>
      ) : (
        <Link to={href} className={fullWidth ? "block" : undefined}>
          <Button size={size} variant="secondary" fullWidth={fullWidth}>
            Go Live
          </Button>
        </Link>
      )}
      {hint && locked ? (
        <p className="pt-1 font-sans text-[0.65rem] text-willow-soft">
          Needs a live credit.{" "}
          <Link to="/app/pricing" className="text-flip underline">
            Pricing
          </Link>
        </p>
      ) : null}
    </div>
  );
}
