import { describe, expect, it } from "vitest";

import { computeStandings } from "./standings";
import { spec } from "./fixtures";

describe("points table fixtures", () => {
  it.each(spec.standings_cases.map((c) => [c.name, c] as const))("%s", (name, testCase) => {
    const rows = computeStandings(testCase.records, {
      config: testCase.config,
      teamNames: testCase.team_names,
    });
    expect(rows.length, name).toBe(testCase.expect.length);
    testCase.expect.forEach((wanted, index) => {
      const row = rows[index] as unknown as Record<string, unknown>;
      for (const [key, want] of Object.entries(wanted)) {
        expect(row[key], `${name}: row ${index}.${key}`).toEqual(want);
      }
    });
  });

  it("folds a points deduction into the table and reorders it", () => {
    const records = [
      { team_id: "t1", match_id: "m1", outcome: "win" as const },
      { team_id: "t2", match_id: "m2", outcome: "win" as const },
    ];
    const names = { t1: "Alpha", t2: "Beta" };
    const clean = computeStandings(records, { teamNames: names });
    expect(clean.map((row) => row.team_id)).toEqual(["t1", "t2"]);

    const docked = computeStandings(records, {
      teamNames: names,
      pointsAdjustments: { t1: -2 },
    });
    expect(docked.map((row) => row.team_id)).toEqual(["t2", "t1"]);
    expect(docked[0]!.points).toBe(2);
    expect(docked[1]!.points).toBe(0);
    // The adjustment is folded into `points`, never double-counted by the UI.
    expect(docked.every((row) => row.points_adjustment === 0)).toBe(true);
  });

  it("keeps positions per group when groups are in play", () => {
    const rows = computeStandings(
      [
        { team_id: "a1", match_id: "m1", outcome: "win" },
        { team_id: "a2", match_id: "m1", outcome: "loss" },
        { team_id: "b1", match_id: "m2", outcome: "win" },
        { team_id: "b2", match_id: "m2", outcome: "loss" },
      ],
      {
        teamNames: { a1: "A one", a2: "A two", b1: "B one", b2: "B two" },
        teamGroups: {
          a1: { id: "ga", name: "Group A" },
          a2: { id: "ga", name: "Group A" },
          b1: { id: "gb", name: "Group B" },
          b2: { id: "gb", name: "Group B" },
        },
      },
    );
    const positions = Object.fromEntries(rows.map((row) => [row.team_id, row.position]));
    expect(positions).toEqual({ a1: 1, a2: 2, b1: 1, b2: 2 });
  });
});
