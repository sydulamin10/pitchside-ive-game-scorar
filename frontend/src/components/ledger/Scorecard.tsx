/**
 * The scorebook pages: batting, bowling, fall of wickets, partnerships, and the
 * over-by-over log. Ledger tables with hairline rules and row numbering, never
 * card grids.
 */

import { cn } from "@/lib/utils";
import type { InningsSnapshot } from "@/lib/api/types";
import { Paper, Seam } from "@/components/ui/Surface";

function dismissalLine(text: string | null, status: string): string {
  if (text) return text;
  if (status === "not_out") return "not out";
  if (status === "did_not_bat") return "did not bat";
  if (status === "retired_hurt") return "retired hurt";
  return "";
}

export function BattingLedger({ innings }: { innings: InningsSnapshot }) {
  const batters = innings.state.batting.filter(
    (b) => b.has_batted || b.is_striker || b.is_non_striker,
  );
  const didNotBat = innings.state.batting.filter(
    (b) => !b.has_batted && !b.is_striker && !b.is_non_striker,
  );
  const extras = innings.state.extras;

  return (
    <Paper className="ledger-scroll">
      <table className="ledger">
        <caption>{innings.batting_team_name} — batting</caption>
        <thead>
          <tr>
            <th scope="col">Batter</th>
            <th scope="col">R</th>
            <th scope="col">B</th>
            <th scope="col">4s</th>
            <th scope="col">6s</th>
            <th scope="col">SR</th>
          </tr>
        </thead>
        <tbody>
          {batters.map((batter, index) => (
            <tr key={batter.player_id}>
              <td>
                <span className="row-number mr-2">{index + 1}</span>
                <span className={cn("font-semibold", batter.is_out && "font-normal")}>
                  {batter.name}
                </span>
                {batter.is_striker && <span className="text-[var(--color-flip-deep)]"> *</span>}
                <span className="block pl-6 text-xs text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">
                  {dismissalLine(batter.dismissal_text, batter.status)}
                </span>
              </td>
              <td className="font-semibold">{batter.runs}</td>
              <td>{batter.balls_faced}</td>
              <td>{batter.fours}</td>
              <td>{batter.sixes}</td>
              <td>{batter.balls_faced > 0 ? batter.strike_rate.toFixed(1) : "—"}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>
              <span className="font-semibold">Extras</span>
              <span className="pl-2 text-xs text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">
                (b {extras.bye}, lb {extras.leg_bye}, w {extras.wide}, nb {extras.no_ball}
                {extras.penalty > 0 && `, pen ${extras.penalty}`})
              </span>
            </td>
            <td colSpan={4} className="font-semibold">
              {extras.total}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="text-left font-semibold">
              Total
              <span className="pl-2 text-xs font-normal text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">
                {innings.state.overs_text} ov · RR {innings.state.run_rate.toFixed(2)}
              </span>
            </td>
            <td colSpan={5} className="font-mono text-base">
              {innings.state.total_runs}/{innings.state.wickets}
            </td>
          </tr>
        </tfoot>
      </table>

      {didNotBat.length > 0 && (
        <p className="px-3 pt-1 pb-3 font-sans text-xs text-[color-mix(in_srgb,var(--color-ink)_60%,transparent)]">
          <span className="font-semibold">Yet to bat: </span>
          {didNotBat.map((b) => b.name).join(", ")}
        </p>
      )}
    </Paper>
  );
}

export function BowlingLedger({ innings }: { innings: InningsSnapshot }) {
  const bowlers = innings.state.bowling.filter((b) => b.balls_bowled > 0);
  if (bowlers.length === 0) return null;

  return (
    <Paper className="ledger-scroll">
      <table className="ledger">
        <caption>{innings.bowling_team_name} — bowling</caption>
        <thead>
          <tr>
            <th scope="col">Bowler</th>
            <th scope="col">O</th>
            <th scope="col">M</th>
            <th scope="col">R</th>
            <th scope="col">W</th>
            <th scope="col">Econ</th>
            <th scope="col">Wd</th>
            <th scope="col">Nb</th>
          </tr>
        </thead>
        <tbody>
          {bowlers.map((bowler, index) => (
            <tr key={bowler.player_id}>
              <td>
                <span className="row-number mr-2">{index + 1}</span>
                <span className="font-semibold">{bowler.name}</span>
                {bowler.is_current_bowler && (
                  <span className="text-[var(--color-flip-deep)]"> *</span>
                )}
              </td>
              <td>{bowler.overs_text}</td>
              <td>{bowler.maidens}</td>
              <td>{bowler.runs_conceded}</td>
              <td className="font-semibold">{bowler.wickets}</td>
              <td>{bowler.economy.toFixed(2)}</td>
              <td>{bowler.wides}</td>
              <td>{bowler.no_balls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Paper>
  );
}

export function FallOfWicketsLedger({ innings }: { innings: InningsSnapshot }) {
  const wickets = innings.state.fall_of_wickets;
  if (wickets.length === 0) return null;

  return (
    <Paper className="ledger-scroll">
      <table className="ledger">
        <caption>Fall of wickets</caption>
        <thead>
          <tr>
            <th scope="col">Wkt</th>
            <th scope="col">Score</th>
            <th scope="col">Over</th>
            <th scope="col">Batter</th>
          </tr>
        </thead>
        <tbody>
          {wickets.map((wicket) => (
            <tr key={wicket.wicket_number}>
              <td className="font-mono">{wicket.wicket_number}</td>
              <td className="font-semibold">
                {wicket.runs_at_fall}/{wicket.wicket_number}
              </td>
              <td>{wicket.overs_text}</td>
              <td className="text-right">
                {wicket.batter_name}
                <span className="block text-xs text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">
                  {wicket.dismissal_text}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Paper>
  );
}

export function PartnershipsLedger({ innings }: { innings: InningsSnapshot }) {
  const partnerships = innings.state.partnerships.filter((p) => p.balls > 0 || p.runs > 0);
  if (partnerships.length === 0) return null;

  return (
    <Paper className="ledger-scroll">
      <table className="ledger">
        <caption>Partnerships</caption>
        <thead>
          <tr>
            <th scope="col">Wkt</th>
            <th scope="col">Batters</th>
            <th scope="col">Runs</th>
            <th scope="col">Balls</th>
          </tr>
        </thead>
        <tbody>
          {partnerships.map((p) => (
            <tr key={`${p.wicket_number}-${p.batter_a_id}`}>
              <td className="font-mono">{p.wicket_number}</td>
              <td className="text-right">
                {p.batter_a_name} <span className="tabular">{p.batter_a_runs}</span>
                {p.batter_b_name && (
                  <>
                    {" · "}
                    {p.batter_b_name} <span className="tabular">{p.batter_b_runs}</span>
                  </>
                )}
                {p.is_current && <span className="text-[var(--color-flip-deep)]"> *</span>}
              </td>
              <td className="font-semibold">{p.runs}</td>
              <td>{p.balls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Paper>
  );
}

/** Over-by-over, the way the book records it: one line per over. */
export function OversLedger({
  innings,
  onSelectBall,
}: {
  innings: InningsSnapshot;
  onSelectBall?: (deliveryId: string) => void;
}) {
  const overs = [...innings.state.overs].reverse();
  if (overs.length === 0) return null;

  return (
    <Paper>
      <table className="ledger">
        <caption>Over by over</caption>
        <tbody>
          {overs.map((over) => (
            <tr key={over.over_number}>
              <td className="w-14 text-left align-top">
                <span className="font-mono font-semibold">{over.over_number}</span>
                {over.is_maiden && (
                  <span className="block text-[0.6rem] font-bold tracking-wider text-[var(--color-boundary)] uppercase">
                    maiden
                  </span>
                )}
              </td>
              <td className="text-left align-top">
                <div className="flex flex-wrap gap-1">
                  {over.balls.map((ball) => (
                    <button
                      key={ball.delivery_id}
                      type="button"
                      onClick={onSelectBall ? () => onSelectBall(ball.delivery_id) : undefined}
                      disabled={!onSelectBall}
                      title={`${ball.over_ball_text} · ${ball.bowler_name} to ${ball.striker_name}${
                        ball.commentary ? ` — ${ball.commentary}` : ""
                      }`}
                      className={cn(
                        "min-w-7 rounded-[2px] border px-1.5 py-0.5 font-mono text-xs font-semibold tabular",
                        "border-[color-mix(in_srgb,var(--color-ink)_25%,transparent)]",
                        ball.is_wicket &&
                          "border-[var(--color-boundary)] text-[var(--color-boundary)]",
                        ball.batter_runs >= 4 &&
                          "border-[var(--color-flip-deep)] text-[var(--color-flip-deep)]",
                        onSelectBall &&
                          "hover:bg-[color-mix(in_srgb,var(--color-ink)_10%,transparent)]",
                      )}
                    >
                      {ball.display}
                    </button>
                  ))}
                </div>
                <span className="mt-1 block text-xs text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">
                  {over.bowler_name} · {over.runs} {over.runs === 1 ? "run" : "runs"}
                  {over.wickets > 0 && `, ${over.wickets} wkt`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Paper>
  );
}

/** All the pages of one innings, in the order a scorebook has them. */
export function InningsScorecard({
  innings,
  onSelectBall,
}: {
  innings: InningsSnapshot;
  onSelectBall?: (deliveryId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <BattingLedger innings={innings} />
      <BowlingLedger innings={innings} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FallOfWicketsLedger innings={innings} />
        <PartnershipsLedger innings={innings} />
      </div>
      <Seam />
      <OversLedger innings={innings} onSelectBall={onSelectBall} />
    </div>
  );
}
