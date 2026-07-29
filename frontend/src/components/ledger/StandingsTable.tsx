/**
 * The points table, written the way a tournament noticeboard would have it:
 * one line per team, qualification marked with a rule rather than a colour block.
 */

import type { StandingRow, TournamentGroup } from "@/lib/api/types";
import { Paper } from "@/components/ui/Surface";
import { cn, signed } from "@/lib/utils";

export function StandingsTable({
  rows,
  groups,
  advancing,
  useNetRunRate = true,
}: {
  rows: StandingRow[];
  groups?: TournamentGroup[];
  /** Teams per group that go through; used to draw the qualification rule. */
  advancing?: number;
  useNetRunRate?: boolean;
}) {
  if (rows.length === 0) return null;

  const grouped = new Map<string | null, StandingRow[]>();
  for (const row of rows) {
    const key = row.group_id ?? null;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...grouped.entries()].map(([groupId, groupRows]) => (
        <Paper key={groupId ?? "all"} className="ledger-scroll">
          <table className="ledger">
            <caption>
              {groupId
                ? (groups?.find((g) => g.id === groupId)?.name ?? "Group")
                : "Points table"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">P</th>
                <th scope="col">W</th>
                <th scope="col">L</th>
                <th scope="col">T</th>
                <th scope="col">N/R</th>
                <th scope="col">Pts</th>
                {useNetRunRate && <th scope="col">NRR</th>}
              </tr>
            </thead>
            <tbody>
              {groupRows.map((row) => (
                <tr
                  key={row.team_id}
                  className={cn(
                    advancing !== undefined &&
                      row.position === advancing &&
                      "border-b-2 border-b-[var(--color-flip-deep)]",
                  )}
                >
                  <td>
                    <span className="row-number mr-2">{row.position}</span>
                    <span className="font-semibold">{row.team_name || row.team_id}</span>
                    {row.form.length > 0 && (
                      <span className="block pl-6 font-mono text-[0.65rem] tracking-widest opacity-60">
                        {row.form.join(" ")}
                      </span>
                    )}
                  </td>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.lost}</td>
                  <td>{row.tied}</td>
                  <td>{row.no_result}</td>
                  <td className="font-semibold">{row.points}</td>
                  {useNetRunRate && <td>{signed(row.net_run_rate)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Paper>
      ))}
    </div>
  );
}
