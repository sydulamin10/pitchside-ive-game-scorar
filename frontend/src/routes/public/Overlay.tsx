/**
 * The broadcast overlay: a browser source for OBS, Streamlabs or vMix.
 *
 * Requirements that shape it: a transparent background so it keys cleanly over a
 * camera feed, a fixed height so a scene never reflows mid-over, no chrome of any
 * kind, and updates driven by the live frame rather than a page reload.
 *
 * Query parameters (documented on /broadcast):
 *   ?position=bottom|top   where the bar sits
 *   ?theme=dark|light      tile colour
 *   ?scale=1.25            multiplier for a 1080p or 4K canvas
 *   ?balls=0               hide the recent-ball strip
 */

import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router";

import { RecentBalls } from "@/components/board/ScoreBoard";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { cn } from "@/lib/utils";

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const { state } = useMatchStream(slug, { pollMs: 4_000 });

  const theme = params.get("theme") === "light" ? "light" : "dark";
  const position = params.get("position") === "top" ? "top" : "bottom";
  const scale = Number(params.get("scale") ?? "1") || 1;
  const showBalls = params.get("balls") !== "0";

  // A browser source must not paint a background over the video.
  useEffect(() => {
    const root = document.documentElement;
    const previous = { html: root.style.background, body: document.body.style.background };
    root.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      root.style.background = previous.html;
      document.body.style.background = previous.body;
    };
  }, []);

  if (!state?.score) return null;

  const score = state.score;
  const batting = state.batting_team?.short_name ?? state.batting_team?.name ?? "";
  const accent = state.batting_team?.primary_color ?? "var(--color-flip)";

  return (
    <div
      className={cn(
        "fixed inset-x-0 flex justify-center px-6",
        position === "top" ? "top-6" : "bottom-6",
      )}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: position === "top" ? "top" : "bottom",
      }}
    >
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-[4px] border shadow-tile",
          theme === "dark"
            ? "border-black/60 bg-[color-mix(in_srgb,var(--color-ink)_92%,transparent)] text-chalk"
            : "border-chalk-deep bg-[color-mix(in_srgb,var(--color-chalk)_95%,transparent)] text-ink",
        )}
      >
        <div aria-hidden="true" className="w-2 shrink-0" style={{ backgroundColor: accent }} />

        <div className="flex items-center gap-4 px-4 py-2.5">
          <span className="font-sans text-sm font-bold tracking-[0.14em] uppercase">
            {batting}
          </span>
          <span className="font-mono text-3xl leading-none font-semibold tabular">
            {score.runs}
            <span className="opacity-60">/</span>
            {score.wickets}
          </span>
          <span className="font-mono text-lg leading-none tabular opacity-80">
            {score.overs_text}
          </span>
        </div>

        <Divider theme={theme} />

        <div className="flex flex-col justify-center gap-0.5 px-4 py-2">
          {[state.striker, state.non_striker].map((batter, index) =>
            batter ? (
              <span key={batter.player_id} className="font-sans text-xs whitespace-nowrap">
                {batter.name}
                {index === 0 && <span style={{ color: accent }}> *</span>}{" "}
                <span className="font-mono tabular opacity-80">
                  {batter.runs} ({batter.balls_faced})
                </span>
              </span>
            ) : null,
          )}
        </div>

        {state.bowler && (
          <>
            <Divider theme={theme} />
            <div className="flex flex-col justify-center gap-0.5 px-4 py-2">
              <span className="font-sans text-xs whitespace-nowrap">{state.bowler.name}</span>
              <span className="font-mono text-xs tabular opacity-80">
                {state.bowler.wickets}/{state.bowler.runs_conceded} ({state.bowler.overs_text})
              </span>
            </div>
          </>
        )}

        {(score.runs_needed ?? 0) > 0 && score.balls_remaining != null && (
          <>
            <Divider theme={theme} />
            <div className="flex flex-col justify-center px-4 py-2">
              <span className="font-sans text-[0.65rem] font-bold tracking-[0.14em] uppercase opacity-70">
                Needs
              </span>
              <span className="font-mono text-sm tabular whitespace-nowrap">
                {score.runs_needed} off {score.balls_remaining}
              </span>
            </div>
          </>
        )}

        {score.is_free_hit && (
          <>
            <Divider theme={theme} />
            <div
              className="flex items-center px-4 font-sans text-xs font-bold tracking-[0.14em] uppercase"
              style={{ color: accent }}
            >
              Free hit
            </div>
          </>
        )}

        {showBalls && state.recent_balls?.length ? (
          <>
            <Divider theme={theme} />
            <RecentBalls
              balls={state.recent_balls.slice(-6)}
              label={false}
              className="px-4 py-2"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Divider({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      aria-hidden="true"
      className={cn("w-px shrink-0", theme === "dark" ? "bg-white/15" : "bg-black/15")}
    />
  );
}
