/**
 * The browser engine, held to the same executable specification as the server.
 *
 * Every case in `spec/scoring-fixtures.json` runs here and in
 * `backend/tests/test_engine_fixtures.py`. If the two engines ever disagree about
 * a law of cricket, one of these suites goes red.
 */

import { describe, expect, it } from "vitest";

import type { BatterCard, BowlerCard, InningsState } from "@/lib/api/types";

import { buildInningsState, validateDelivery } from "./engine";
import { buildCandidate, caseSetup, replayCase, spec } from "./fixtures";
import { RuleViolationError, makeDelivery } from "./types";

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag {
  return value as Bag;
}

/** Subset-compare, exactly like the Python harness does. */
function expectMatches(state: InningsState, expected: Bag, label: string): void {
  const actual = asBag(state);
  const nested = ["batting", "bowling", "extras", "fall_of_wickets", "partnerships"];

  for (const [key, want] of Object.entries(expected)) {
    if (nested.includes(key)) continue;
    expect(actual[key], `${label}: ${key}`).toEqual(want);
  }

  if (expected.extras) {
    for (const [key, want] of Object.entries(asBag(expected.extras))) {
      expect(asBag(state.extras)[key], `${label}: extras.${key}`).toEqual(want);
    }
  }

  if (expected.batting) {
    const byId = new Map<string, BatterCard>(state.batting.map((row) => [row.player_id, row]));
    for (const [playerId, fields] of Object.entries(asBag(expected.batting))) {
      const row = byId.get(playerId);
      expect(row, `${label}: batter ${playerId} missing from the card`).toBeDefined();
      for (const [key, want] of Object.entries(asBag(fields))) {
        expect(asBag(row)[key], `${label}: batting[${playerId}].${key}`).toEqual(want);
      }
    }
  }

  if (expected.bowling) {
    const byId = new Map<string, BowlerCard>(state.bowling.map((row) => [row.player_id, row]));
    const wanted = asBag(expected.bowling);
    if (Object.keys(wanted).length === 0) {
      expect(state.bowling, `${label}: expected no bowling figures`).toEqual([]);
    }
    for (const [playerId, fields] of Object.entries(wanted)) {
      const row = byId.get(playerId);
      expect(row, `${label}: bowler ${playerId} missing from the card`).toBeDefined();
      for (const [key, want] of Object.entries(asBag(fields))) {
        expect(asBag(row)[key], `${label}: bowling[${playerId}].${key}`).toEqual(want);
      }
    }
  }

  for (const listKey of ["fall_of_wickets", "partnerships"] as const) {
    if (!expected[listKey]) continue;
    const wantRows = expected[listKey] as Bag[];
    const gotRows = state[listKey] as unknown as Bag[];
    expect(gotRows.length, `${label}: ${listKey} row count`).toBe(wantRows.length);
    wantRows.forEach((wantRow, index) => {
      for (const [key, want] of Object.entries(wantRow)) {
        expect(asBag(gotRows[index])[key], `${label}: ${listKey}[${index}].${key}`).toEqual(
          want,
        );
      }
    });
  }
}

describe(`scoring fixtures v${spec.version}`, () => {
  it.each(spec.cases.map((c) => [c.name, c] as const))("replays: %s", (name, testCase) => {
    const { state } = replayCase(testCase);
    expectMatches(state, testCase.expect, name);
  });

  it.each(spec.validation_cases.map((c) => [c.name, c] as const))(
    "rejects: %s",
    (name, testCase) => {
      const { state, setup } = replayCase(testCase);
      const candidate = buildCandidate(testCase, state, setup);
      let thrown: unknown;
      try {
        validateDelivery(state, candidate, setup.rules, setup.batting, setup.bowling);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${name}: expected ${testCase.expect_error}`).toBeInstanceOf(
        RuleViolationError,
      );
      expect((thrown as RuleViolationError).code, name).toBe(testCase.expect_error);
    },
  );

  it("accepts the next legal ball in every replay case", () => {
    for (const testCase of spec.cases) {
      const { state, setup } = replayCase(testCase);
      if (state.is_complete || state.next_action === "select_batter") continue;
      const striker = state.striker_id;
      const nonStriker = state.non_striker_id;
      if (!striker || !nonStriker) continue;
      const bowler =
        state.current_bowler_id ??
        setup.bowling.find((p) => !state.ineligible_bowler_ids.includes(p.id))?.id;
      expect(bowler, testCase.name).toBeTruthy();
      const ball = makeDelivery({
        id: "next",
        sequence: testCase.deliveries.length + 1,
        striker_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler!,
        batter_runs: 1,
      });
      expect(() =>
        validateDelivery(state, ball, setup.rules, setup.batting, setup.bowling),
      ).not.toThrow();
    }
  });
});

describe("the engine before a ball is bowled", () => {
  it("asks for openers and reports an empty card", () => {
    const { rules, batting, bowling } = caseSetup(spec.cases[0]!);
    const state = buildInningsState(rules, batting, bowling, []);
    expect(state.next_action).toBe("select_openers");
    expect(state.total_runs).toBe(0);
    expect(state.overs_text).toBe("0.0");
    expect(state.run_rate).toBe(0);
    expect(state.bowling).toEqual([]);
    expect(state.batting).toHaveLength(batting.length);
    expect(state.batting.every((b) => b.status === "did_not_bat")).toBe(true);
    expect(state.available_batter_ids).toHaveLength(batting.length);
  });

  it("is deterministic: the same log always yields the same state", () => {
    for (const testCase of spec.cases) {
      const first = replayCase(testCase);
      const second = buildInningsState(
        first.setup.rules,
        first.setup.batting,
        first.setup.bowling,
        first.events,
      );
      expect(second, testCase.name).toEqual(first.state);
    }
  });

  it("keeps the total equal to runs off the bat plus extras", () => {
    for (const testCase of spec.cases) {
      const { state } = replayCase(testCase);
      const batRuns = state.batting.reduce((sum, b) => sum + b.runs, 0);
      expect(batRuns + state.extras.total, testCase.name).toBe(state.total_runs);
    }
  });

  it("counts legal balls consistently with the over breakdown", () => {
    for (const testCase of spec.cases) {
      const { state } = replayCase(testCase);
      const legalInTimeline = (state.timeline ?? []).filter((b) => b.is_legal).length;
      expect(legalInTimeline, testCase.name).toBe(state.legal_balls);
      const bowlerBalls = state.bowling.reduce((sum, b) => sum + b.balls_bowled, 0);
      expect(bowlerBalls, testCase.name).toBe(state.legal_balls);
    }
  });
});

describe("mid-over bowler change and crease override", () => {
  it("allows a new bowler to finish an over without resetting ball count", () => {
    const { rules, batting, bowling } = caseSetup(spec.cases[0]!);
    const events = [0, 1, 2, 3].map((i) =>
      makeDelivery({
        id: `d${i + 1}`,
        sequence: i + 1,
        striker_id: "a1",
        non_striker_id: "a2",
        bowler_id: "p1",
        batter_runs: 0,
      }),
    );
    const mid = buildInningsState(rules, batting, bowling, events);
    expect(mid.overs_text).toBe("0.4");
    expect(mid.current_bowler_id).toBe("p1");

    const next = makeDelivery({
      id: "d5",
      sequence: 5,
      striker_id: "a1",
      non_striker_id: "a2",
      bowler_id: "p2",
      batter_runs: 1,
    });
    expect(() => validateDelivery(mid, next, rules, batting, bowling)).not.toThrow();

    const final = buildInningsState(rules, batting, bowling, [
      ...events,
      next,
      makeDelivery({
        id: "d6",
        sequence: 6,
        striker_id: "a2",
        non_striker_id: "a1",
        bowler_id: "p2",
        batter_runs: 0,
      }),
    ]);
    expect(final.overs_text).toBe("1.0");
    expect(final.bowling.find((b) => b.player_id === "p1")?.balls_bowled).toBe(4);
    expect(final.bowling.find((b) => b.player_id === "p2")?.balls_bowled).toBe(2);
  });

  it("applies a crease swap after a checkpoint without changing prior deliveries", () => {
    const { rules, batting, bowling } = caseSetup(spec.cases[0]!);
    const events = [
      makeDelivery({
        id: "d1",
        sequence: 1,
        striker_id: "a1",
        non_striker_id: "a2",
        bowler_id: "p1",
        batter_runs: 1,
      }),
      makeDelivery({
        id: "d2",
        sequence: 2,
        striker_id: "a2",
        non_striker_id: "a1",
        bowler_id: "p1",
        batter_runs: 0,
      }),
    ];
    const swapped = buildInningsState(rules, batting, bowling, events, {
      after_sequence: 2,
      striker_id: "a1",
      non_striker_id: "a2",
    });
    expect(swapped.striker_id).toBe("a1");
    expect(swapped.non_striker_id).toBe("a2");
    expect(events[0]!.striker_id).toBe("a1");
    expect(events[1]!.striker_id).toBe("a2");
  });
});
