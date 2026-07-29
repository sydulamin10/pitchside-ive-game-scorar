/**
 * The scoring engine, in the browser.
 *
 * This is a line-for-line port of `backend/app/scoring/engine.py`, and both are
 * held to `spec/scoring-fixtures.json` by their own test suites. The port exists
 * so a scorer with no signal gets the same numbers, the same validation errors
 * and the same "what do I need next" prompts as a scorer who is online — the
 * server stays authoritative, but the console never has to wait for it.
 *
 * Read the Python module for the reasoning behind each law; the comments here
 * are limited to what a TypeScript reader needs on top of that.
 */

import type {
  BallSummary,
  BatterCard,
  BatterStatus,
  BowlerCard,
  Extras,
  FallOfWicket,
  InningsEndReason,
  InningsState,
  NextAction,
  OverSummary,
  Partnership,
  WicketType,
} from "@/lib/api/types";

import {
  BOWLER_CREDITED_WICKETS,
  NON_DISMISSAL_WICKETS,
  RuleViolationError,
  WICKETS_ALLOWED_ON_NO_BALL,
  WICKETS_ALLOWED_ON_WIDE,
  isBallEvent,
  isBallFaced,
  isLegal,
  maxLegalBalls,
  maxWickets,
  pyRound,
  type EngineDelivery,
  type EngineRules,
  type PlayerRef,
} from "./types";

const MAX_BATTER_RUNS = 12;

/** A stored delivery whose recorded ends no longer match the replay. */
export interface StrikeRepair {
  delivery_id: string;
  striker_id: string;
  non_striker_id: string;
}

export interface ReplayResult {
  state: InningsState;
  repairs: StrikeRepair[];
}

// ------------------------------------------------------------------ public API

export function buildInningsState(
  rules: EngineRules,
  battingSquad: readonly PlayerRef[],
  bowlingSquad: readonly PlayerRef[],
  deliveries: readonly EngineDelivery[],
): InningsState {
  return replay(rules, battingSquad, bowlingSquad, deliveries).state;
}

export function replay(
  rules: EngineRules,
  battingSquad: readonly PlayerRef[],
  bowlingSquad: readonly PlayerRef[],
  deliveries: readonly EngineDelivery[],
  options: { strict?: boolean } = {},
): ReplayResult {
  return new Replayer(rules, battingSquad, bowlingSquad, options.strict ?? false).run(
    deliveries,
  );
}

/**
 * Reject a delivery that is illegal given the current state.
 *
 * The console calls this before it queues a ball, so an impossible tap is
 * refused in place — no round trip, no optimistic row to roll back later.
 */
export function validateDelivery(
  state: InningsState,
  event: EngineDelivery,
  rules: EngineRules,
  battingSquad: readonly PlayerRef[],
  bowlingSquad: readonly PlayerRef[],
): void {
  const batters = new Set(battingSquad.filter((p) => p.is_playing !== false).map((p) => p.id));
  const bowlers = new Set(bowlingSquad.filter((p) => p.is_playing !== false).map((p) => p.id));

  if (state.is_complete) {
    throw new RuleViolationError("This innings is already complete.", "innings_complete", {
      end_reason: state.end_reason,
    });
  }

  // --------------------------------------------------------------- personnel
  if (event.striker_id === event.non_striker_id) {
    throw new RuleViolationError(
      "The striker and non-striker must be different players.",
      "batters_identical",
    );
  }
  for (const [fieldName, playerId] of [
    ["striker_id", event.striker_id],
    ["non_striker_id", event.non_striker_id],
  ] as const) {
    if (!batters.has(playerId)) {
      throw new RuleViolationError(
        "That batter is not in the batting side for this match.",
        "unknown_batter",
        { field: fieldName, player_id: playerId },
      );
    }
  }
  if (!bowlers.has(event.bowler_id)) {
    throw new RuleViolationError(
      "That bowler is not in the fielding side for this match.",
      "unknown_bowler",
      { player_id: event.bowler_id },
    );
  }

  const dismissed = new Set(
    state.batting.filter((b) => b.status === "out").map((b) => b.player_id),
  );
  for (const playerId of [event.striker_id, event.non_striker_id]) {
    if (dismissed.has(playerId)) {
      throw new RuleViolationError("That batter is already out.", "batter_already_out", {
        player_id: playerId,
      });
    }
  }

  const atCrease = [state.striker_id, state.non_striker_id].filter((id): id is string =>
    Boolean(id),
  );
  const incoming = [event.striker_id, event.non_striker_id].filter(
    (id) => !atCrease.includes(id),
  );
  if (atCrease.length === 2 && incoming.length > 0) {
    throw new RuleViolationError(
      "Those batters are not at the crease. Reload the live state and retry.",
      "batters_not_at_crease",
      {
        expected: [...atCrease].sort(),
        received: [event.striker_id, event.non_striker_id].sort(),
      },
    );
  }
  // Two batters walk out together only at the very start of an innings.
  if (atCrease.length > 0 && incoming.length > 1) {
    throw new RuleViolationError(
      "Only one new batter can come in at a time.",
      "too_many_new_batters",
    );
  }
  if (incoming.length > 0 && state.available_batter_ids.length > 0) {
    for (const newBatter of [...incoming].sort()) {
      if (!state.available_batter_ids.includes(newBatter)) {
        throw new RuleViolationError(
          "That batter is not available to come in.",
          "batter_unavailable",
          { player_id: newBatter },
        );
      }
    }
  }

  // ------------------------------------------------------------------ bowler
  if (isBallEvent(event)) {
    if (state.next_action === "select_bowler") {
      if (state.ineligible_bowler_ids.includes(event.bowler_id)) {
        const consecutive = event.bowler_id === state.previous_over_bowler_id;
        throw new RuleViolationError(
          consecutive
            ? "That bowler cannot bowl this over."
            : "That bowler has already bowled their maximum overs.",
          consecutive ? "consecutive_overs" : "over_quota_reached",
          { player_id: event.bowler_id },
        );
      }
    } else if (state.current_bowler_id && event.bowler_id !== state.current_bowler_id) {
      throw new RuleViolationError(
        "The over is not finished — the same bowler must complete it.",
        "bowler_changed_mid_over",
        { expected_bowler_id: state.current_bowler_id },
      );
    }
  }

  // ----------------------------------------------------------------- scoring
  if (
    !Number.isInteger(event.batter_runs) ||
    event.batter_runs < 0 ||
    event.batter_runs > MAX_BATTER_RUNS
  ) {
    throw new RuleViolationError(
      `Runs off the bat must be between 0 and ${MAX_BATTER_RUNS}.`,
      "invalid_batter_runs",
    );
  }
  if (event.extra_runs < 0) {
    throw new RuleViolationError("Extra runs cannot be negative.", "invalid_extra_runs");
  }

  const extra = event.extra_type;
  if (extra === null && event.extra_runs) {
    throw new RuleViolationError(
      "Extra runs require an extra type (wide, no-ball, bye, leg-bye or penalty).",
      "extras_without_type",
    );
  }
  if ((extra === "wide" || extra === "bye" || extra === "leg_bye") && event.batter_runs) {
    throw new RuleViolationError(
      "Runs off the bat cannot be combined with a wide, bye or leg-bye. " +
        "If the batter hit it, record it as runs (or a no-ball).",
      "bat_runs_with_extra",
      { extra_type: extra },
    );
  }
  if (extra === "penalty") {
    if (event.batter_runs) {
      throw new RuleViolationError(
        "A penalty award is not attached to a shot.",
        "bat_runs_with_penalty",
      );
    }
    if (event.extra_runs <= 0) {
      throw new RuleViolationError("A penalty award must be at least 1 run.", "empty_penalty");
    }
    if (event.is_wicket) {
      throw new RuleViolationError(
        "A penalty award cannot include a wicket.",
        "wicket_on_penalty",
      );
    }
  }
  if (!rules.allow_boundaries && event.batter_runs >= 4) {
    throw new RuleViolationError(
      "Boundaries are disabled for this match's rules.",
      "boundaries_disabled",
      { batter_runs: event.batter_runs },
    );
  }

  // ----------------------------------------------------------------- wickets
  if (event.is_wicket) {
    if (event.wicket_type === null) {
      throw new RuleViolationError(
        "Select how the batter was dismissed.",
        "missing_wicket_type",
      );
    }
    const wicketType = event.wicket_type;
    const dismissedId = event.dismissed_player_id ?? event.striker_id;
    if (dismissedId !== event.striker_id && dismissedId !== event.non_striker_id) {
      throw new RuleViolationError(
        "Only a batter at the crease can be dismissed.",
        "invalid_dismissed_player",
        { player_id: dismissedId },
      );
    }
    if (extra === "no_ball" && !WICKETS_ALLOWED_ON_NO_BALL.includes(wicketType)) {
      throw new RuleViolationError(
        `A batter cannot be ${wicketType.replace(/_/g, " ")} off a no-ball.`,
        "wicket_illegal_on_no_ball",
        { wicket_type: wicketType },
      );
    }
    if (extra === "wide" && !WICKETS_ALLOWED_ON_WIDE.includes(wicketType)) {
      throw new RuleViolationError(
        `A batter cannot be ${wicketType.replace(/_/g, " ")} off a wide.`,
        "wicket_illegal_on_wide",
        { wicket_type: wicketType },
      );
    }
    if (state.is_free_hit && !WICKETS_ALLOWED_ON_NO_BALL.includes(wicketType)) {
      throw new RuleViolationError(
        "It is a free hit — only a run-out style dismissal is possible.",
        "wicket_illegal_on_free_hit",
        { wicket_type: wicketType },
      );
    }
    if ((wicketType === "caught" || wicketType === "stumped") && !event.fielder_id) {
      throw new RuleViolationError(
        "Select the fielder who completed the dismissal.",
        "missing_fielder",
        { wicket_type: wicketType },
      );
    }
    if (event.fielder_id && !bowlers.has(event.fielder_id)) {
      throw new RuleViolationError(
        "That fielder is not in the fielding side.",
        "unknown_fielder",
        { player_id: event.fielder_id },
      );
    }
    if (
      wicketType === "caught_and_bowled" &&
      event.fielder_id !== null &&
      event.fielder_id !== event.bowler_id
    ) {
      throw new RuleViolationError(
        "Caught and bowled means the bowler took the catch.",
        "invalid_fielder_for_wicket",
      );
    }
    const replacement = event.replacement_batter_id;
    if (replacement) {
      if (replacement === event.striker_id || replacement === event.non_striker_id) {
        throw new RuleViolationError(
          "The incoming batter is already at the crease.",
          "replacement_at_crease",
        );
      }
      if (!batters.has(replacement)) {
        throw new RuleViolationError(
          "That batter is not in the batting side.",
          "unknown_batter",
          {
            player_id: replacement,
          },
        );
      }
      if (dismissed.has(replacement)) {
        throw new RuleViolationError("That batter is already out.", "batter_already_out", {
          player_id: replacement,
        });
      }
    }
  } else if (event.wicket_type !== null || event.dismissed_player_id !== null) {
    throw new RuleViolationError(
      "Dismissal details were supplied but the delivery is not marked as a wicket.",
      "wicket_flag_missing",
    );
  }
}

// ------------------------------------------------------------------ internals

interface BatterAcc {
  player_id: string;
  name: string;
  batting_position: number;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  dots: number;
  status: BatterStatus;
  wicket_type: WicketType | null;
  dismissed_by_bowler_id: string | null;
  fielder_id: string | null;
  fielder_name: string | null;
  dismissal_text: string | null;
}

interface BowlerAcc {
  player_id: string;
  name: string;
  balls_bowled: number;
  runs_conceded: number;
  wickets: number;
  maidens: number;
  wides: number;
  no_balls: number;
  dots: number;
  fours_conceded: number;
  sixes_conceded: number;
}

function newBatter(playerId: string, name: string): BatterAcc {
  return {
    player_id: playerId,
    name,
    batting_position: 0,
    runs: 0,
    balls_faced: 0,
    fours: 0,
    sixes: 0,
    dots: 0,
    status: "did_not_bat",
    wicket_type: null,
    dismissed_by_bowler_id: null,
    fielder_id: null,
    fielder_name: null,
    dismissal_text: null,
  };
}

function newBowler(playerId: string, name: string): BowlerAcc {
  return {
    player_id: playerId,
    name,
    balls_bowled: 0,
    runs_conceded: 0,
    wickets: 0,
    maidens: 0,
    wides: 0,
    no_balls: 0,
    dots: 0,
    fours_conceded: 0,
    sixes_conceded: 0,
  };
}

class Replayer {
  private readonly rules: EngineRules;
  private readonly strict: boolean;
  private readonly battingSquad: PlayerRef[];
  private readonly battingNames = new Map<string, string>();
  private readonly bowlingNames = new Map<string, string>();

  private readonly batters = new Map<string, BatterAcc>();
  private readonly bowlers = new Map<string, BowlerAcc>();

  private totalRuns: number;
  private wickets = 0;
  private legalBalls = 0;
  private readonly extras: Extras;

  private striker: string | null = null;
  private nonStriker: string | null = null;
  private nextPosition = 1;

  private readonly partnerships: Partnership[] = [];
  private readonly fallOfWickets: FallOfWicket[] = [];
  private readonly oversList: OverSummary[] = [];
  private readonly timeline: BallSummary[] = [];
  private readonly warnings: string[] = [];
  private readonly repairs: StrikeRepair[] = [];

  private legalInOver = 0;
  private overIndex = 0;
  private currentOver: OverSummary | null = null;
  private overRunsCharged = 0;
  private previousOverBowler: string | null = null;
  private freeHit = false;
  private isComplete = false;
  private endReason: InningsEndReason | null = null;

  constructor(
    rules: EngineRules,
    battingSquad: readonly PlayerRef[],
    bowlingSquad: readonly PlayerRef[],
    strict: boolean,
  ) {
    this.rules = rules;
    this.strict = strict;
    this.battingSquad = battingSquad.filter((p) => p.is_playing !== false);
    for (const p of battingSquad) this.battingNames.set(p.id, p.name);
    for (const p of bowlingSquad) this.bowlingNames.set(p.id, p.name);
    for (const p of this.battingSquad) this.batters.set(p.id, newBatter(p.id, p.name));

    this.totalRuns = rules.innings_penalty_runs;
    this.extras = {
      wide: 0,
      no_ball: 0,
      bye: 0,
      leg_bye: 0,
      penalty: rules.innings_penalty_runs,
      total: 0,
    };
  }

  run(deliveries: readonly EngineDelivery[]): ReplayResult {
    const ordered = [...deliveries].sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      if (this.isComplete) {
        this.warnings.push(
          `Delivery ${event.sequence} was recorded after the innings ended ` +
            `(${this.endReason ?? "unknown"}). It is included in the totals — ` +
            "review and delete it if that is wrong.",
        );
        this.isComplete = false;
        this.endReason = null;
      }
      this.apply(event);
      this.evaluateCompletion();
    }
    return { state: this.finalise(), repairs: this.repairs };
  }

  // -------------------------------------------------------------- one ball
  private apply(event: EngineDelivery): void {
    if (!this.seatBatters(event)) return;
    const striker = this.striker;
    const nonStriker = this.nonStriker;
    if (striker === null) return;

    if (event.extra_type === "penalty") {
      this.applyPenalty(event, striker);
      return;
    }

    const bowler = this.resolveBowler(event);
    const { extraTotal, bowlerCharge, runsRun } = this.splitRuns(event);

    this.totalRuns += event.batter_runs + extraTotal;
    this.recordExtras(event, extraTotal);

    const batter = this.batters.get(striker)!;
    if (batter.status === "did_not_bat") batter.status = "not_out";
    batter.runs += event.batter_runs;
    if (isBallFaced(event)) {
      batter.balls_faced += 1;
      if (event.batter_runs === 0 && extraTotal === 0) batter.dots += 1;
    }
    if (
      this.isBoundary(event) &&
      (event.extra_type === null || event.extra_type === "no_ball")
    ) {
      if (event.batter_runs === 4) {
        batter.fours += 1;
        bowler.fours_conceded += 1;
      } else if (event.batter_runs === 6) {
        batter.sixes += 1;
        bowler.sixes_conceded += 1;
      }
    }

    bowler.runs_conceded += bowlerCharge;
    this.overRunsCharged += bowlerCharge;
    if (event.extra_type === "wide") bowler.wides += 1;
    else if (event.extra_type === "no_ball") bowler.no_balls += 1;
    if (isLegal(event)) {
      bowler.balls_bowled += 1;
      if (event.batter_runs + extraTotal === 0) bowler.dots += 1;
    }

    const partnership = this.partnerships.at(-1);
    if (partnership) {
      partnership.runs += event.batter_runs + extraTotal;
      if (isLegal(event)) partnership.balls += 1;
      if (partnership.batter_a_id === striker) partnership.batter_a_runs += event.batter_runs;
      else if (partnership.batter_b_id === striker)
        partnership.batter_b_runs += event.batter_runs;
    }

    let ballInOver = Math.min(this.legalInOver + 1, this.rules.balls_per_over);
    if (isLegal(event)) {
      this.legalBalls += 1;
      this.legalInOver += 1;
      ballInOver = this.legalInOver;
    }

    const summary = this.makeBallSummary(event, {
      striker,
      bowlerId: bowler.player_id,
      ballInOver,
      runsTotal: event.batter_runs + extraTotal,
    });
    this.timeline.push(summary);
    if (this.currentOver) {
      this.currentOver.balls.push(summary);
      this.currentOver.runs += event.batter_runs + extraTotal;
    }

    const crossed = this.crossed(event, runsRun);
    let endStriker: string | null = crossed && nonStriker ? nonStriker : striker;
    let endNonStriker: string | null = crossed && nonStriker ? striker : nonStriker;

    if (event.is_wicket && event.wicket_type !== null) {
      const ends = this.applyWicket(event, {
        bowler,
        deliveryStriker: striker,
        endStriker,
        endNonStriker,
        overBallText: summary.over_ball_text,
      });
      endStriker = ends[0];
      endNonStriker = ends[1];
    }

    this.striker = endStriker;
    this.nonStriker = endNonStriker;

    if (event.extra_type === "no_ball" && this.rules.free_hit_after_no_ball)
      this.freeHit = true;
    else if (isLegal(event)) this.freeHit = false;

    if (isLegal(event) && this.legalInOver >= this.rules.balls_per_over) this.closeOver(bowler);
  }

  // -------------------------------------------------------------- sub-steps
  private seatBatters(event: EngineDelivery): boolean {
    const atCrease = [this.striker, this.nonStriker].filter((id): id is string => id !== null);

    if (atCrease.length === 0) {
      this.introduce(event.striker_id);
      this.introduce(event.non_striker_id);
      this.striker = event.striker_id;
      this.nonStriker = event.non_striker_id;
      this.openPartnership();
      return true;
    }

    if (atCrease.length === 2) {
      const named = new Set([event.striker_id, event.non_striker_id]);
      const seated = new Set(atCrease);
      const samePair = named.size === seated.size && [...named].every((id) => seated.has(id));
      if (!samePair) {
        this.inconsistent(
          event,
          `Delivery ${event.sequence} names batters who are not at the crease; ` +
            "the replayed pair was used instead.",
        );
      } else if (event.striker_id !== this.striker) {
        this.repairs.push({
          delivery_id: event.id,
          striker_id: this.striker ?? event.striker_id,
          non_striker_id: this.nonStriker ?? event.non_striker_id,
        });
      }
      return true;
    }

    const surviving = atCrease[0] as string;
    const incoming = [event.striker_id, event.non_striker_id].filter((id) => id !== surviving);
    let newComer: string | null;
    if (incoming.length === 1) {
      newComer = incoming[0] as string;
    } else {
      this.inconsistent(
        event,
        `Delivery ${event.sequence} does not identify the incoming batter; ` +
          "the next available batter was used instead.",
      );
      newComer = this.nextAvailableBatter();
    }
    if (newComer === null) {
      this.isComplete = true;
      this.endReason = "all_out";
      this.warnings.push(
        `Delivery ${event.sequence} could not be applied: no batter is left to come in.`,
      );
      return false;
    }
    this.introduce(newComer);
    if (event.striker_id === surviving) {
      this.striker = surviving;
      this.nonStriker = newComer;
    } else {
      this.striker = newComer;
      this.nonStriker = surviving;
    }
    this.openPartnership();
    return true;
  }

  private applyPenalty(event: EngineDelivery, striker: string): void {
    this.totalRuns += event.extra_runs;
    this.extras.penalty += event.extra_runs;
    const partnership = this.partnerships.at(-1);
    if (partnership) partnership.runs += event.extra_runs;
    const summary = this.makeBallSummary(event, {
      striker,
      bowlerId: event.bowler_id,
      ballInOver: Math.min(this.legalInOver + 1, this.rules.balls_per_over),
      runsTotal: event.extra_runs,
    });
    this.timeline.push(summary);
    if (this.currentOver) {
      this.currentOver.balls.push(summary);
      this.currentOver.runs += event.extra_runs;
    }
  }

  private resolveBowler(event: EngineDelivery): BowlerAcc {
    if (this.currentOver === null) {
      const repeats =
        this.rules.forbid_consecutive_overs &&
        this.previousOverBowler !== null &&
        event.bowler_id === this.previousOverBowler;
      if (repeats && this.strict) {
        throw new RuleViolationError(
          "A bowler may not bowl consecutive overs.",
          "consecutive_overs",
          { player_id: event.bowler_id, over: this.overIndex + 1 },
        );
      }
      if (repeats) {
        this.warnings.push(
          `Over ${this.overIndex + 1} is bowled by the same bowler as the previous over. ` +
            "This usually means an earlier ball was edited — review the over.",
        );
      }
      this.currentOver = {
        over_number: this.overIndex + 1,
        bowler_id: event.bowler_id,
        bowler_name: this.bowlingNames.get(event.bowler_id) ?? "Unknown bowler",
        runs: 0,
        wickets: 0,
        is_maiden: false,
        is_complete: false,
        balls: [],
      };
      this.oversList.push(this.currentOver);
      this.overRunsCharged = 0;
    }

    let bowler = this.bowlers.get(event.bowler_id);
    if (!bowler) {
      bowler = newBowler(
        event.bowler_id,
        this.bowlingNames.get(event.bowler_id) ?? "Unknown bowler",
      );
      this.bowlers.set(event.bowler_id, bowler);
    }
    return bowler;
  }

  private splitRuns(event: EngineDelivery): {
    extraTotal: number;
    bowlerCharge: number;
    runsRun: number;
  } {
    let extraTotal: number;
    let bowlerCharge: number;
    let runsRun: number;
    switch (event.extra_type) {
      case "wide":
        extraTotal = this.rules.wide_penalty_runs + event.extra_runs;
        bowlerCharge = extraTotal;
        runsRun = event.extra_runs;
        break;
      case "no_ball":
        extraTotal = this.rules.no_ball_penalty_runs + event.extra_runs;
        bowlerCharge = extraTotal + event.batter_runs;
        runsRun = event.batter_runs + event.extra_runs;
        break;
      case "bye":
      case "leg_bye":
        extraTotal = event.extra_runs;
        bowlerCharge = 0;
        runsRun = event.extra_runs;
        break;
      default:
        extraTotal = 0;
        bowlerCharge = event.batter_runs;
        runsRun = event.batter_runs;
        break;
    }
    if (this.isBoundary(event)) runsRun = 0;
    return { extraTotal, bowlerCharge, runsRun };
  }

  private recordExtras(event: EngineDelivery, extraTotal: number): void {
    switch (event.extra_type) {
      case "wide":
        this.extras.wide += extraTotal;
        break;
      case "no_ball":
        this.extras.no_ball += extraTotal;
        break;
      case "bye":
        this.extras.bye += extraTotal;
        break;
      case "leg_bye":
        this.extras.leg_bye += extraTotal;
        break;
      default:
        break;
    }
  }

  private isBoundary(event: EngineDelivery): boolean {
    if (event.is_boundary) return true;
    if (event.extra_type === null || event.extra_type === "no_ball") {
      return event.batter_runs === 4 || event.batter_runs === 6;
    }
    return false;
  }

  private crossed(event: EngineDelivery, runsRun: number): boolean {
    if (event.batters_crossed !== null && event.batters_crossed !== undefined) {
      return event.batters_crossed;
    }
    return runsRun % 2 === 1;
  }

  private applyWicket(
    event: EngineDelivery,
    ctx: {
      bowler: BowlerAcc;
      deliveryStriker: string;
      endStriker: string | null;
      endNonStriker: string | null;
      overBallText: string;
    },
  ): [string | null, string | null] {
    const wicketType = event.wicket_type!;
    let { endStriker, endNonStriker } = ctx;
    const bowler = ctx.bowler;
    const dismissedId = event.dismissed_player_id ?? ctx.deliveryStriker;
    const batter = this.batters.get(dismissedId);
    if (!batter) {
      this.warnings.push(
        `Delivery ${event.sequence} dismisses an unknown batter; the wicket was ignored.`,
      );
      return [endStriker, endNonStriker];
    }

    const isDismissal = !NON_DISMISSAL_WICKETS.includes(wicketType);
    if (BOWLER_CREDITED_WICKETS.includes(wicketType)) bowler.wickets += 1;

    if (isDismissal) {
      this.wickets += 1;
      batter.status = "out";
    } else {
      batter.status = "retired_hurt";
    }
    batter.wicket_type = wicketType;
    batter.dismissed_by_bowler_id = bowler.player_id;
    batter.fielder_id = event.fielder_id;
    batter.fielder_name = event.fielder_id
      ? (this.bowlingNames.get(event.fielder_id) ?? null)
      : null;
    batter.dismissal_text = describeDismissal(wicketType, bowler.name, batter.fielder_name);

    if (isDismissal) {
      this.fallOfWickets.push({
        wicket_number: this.wickets,
        runs_at_fall: this.totalRuns,
        overs_text: ctx.overBallText,
        batter_id: dismissedId,
        batter_name: batter.name,
        dismissal_text: batter.dismissal_text ?? "",
      });
    }
    this.closePartnership();

    let replacement: string | null = event.replacement_batter_id ?? null;
    if (replacement !== null && this.batters.has(replacement)) this.introduce(replacement);
    else replacement = null;

    if (dismissedId === endStriker) {
      endStriker = replacement;
    } else if (dismissedId === endNonStriker) {
      endNonStriker = replacement;
    } else {
      this.warnings.push(
        `Delivery ${event.sequence} dismissed a batter who was not at the crease; ` +
          "the striker's end was vacated instead.",
      );
      endStriker = replacement;
    }

    if (replacement !== null) this.openPartnership(endStriker, endNonStriker);
    return [endStriker, endNonStriker];
  }

  private closeOver(bowler: BowlerAcc): void {
    if (this.currentOver) {
      this.currentOver.is_complete = true;
      this.currentOver.wickets = this.currentOver.balls.filter((b) => b.is_wicket).length;
      if (this.overRunsCharged === 0) {
        this.currentOver.is_maiden = true;
        bowler.maidens += 1;
      }
    }
    this.previousOverBowler = bowler.player_id;
    this.currentOver = null;
    this.legalInOver = 0;
    this.overIndex += 1;
    const swap = this.striker;
    this.striker = this.nonStriker;
    this.nonStriker = swap;
  }

  private introduce(playerId: string): void {
    let batter = this.batters.get(playerId);
    if (!batter) {
      this.warnings.push(`Unknown batter ${playerId} appeared in the log.`);
      batter = newBatter(playerId, this.battingNames.get(playerId) ?? "Unknown batter");
      this.batters.set(playerId, batter);
    }
    if (batter.status === "did_not_bat") batter.status = "not_out";
    if (batter.batting_position === 0) {
      batter.batting_position = this.nextPosition;
      this.nextPosition += 1;
    } else if (batter.status === "retired_hurt") {
      batter.status = "not_out";
    }
  }

  private openPartnership(striker?: string | null, nonStriker?: string | null): void {
    let a = striker !== undefined ? striker : this.striker;
    let b = nonStriker !== undefined ? nonStriker : this.nonStriker;
    if (a === null) {
      a = b;
      b = null;
    }
    if (a === null || a === undefined) return;
    this.partnerships.push({
      wicket_number: this.wickets,
      batter_a_id: a,
      batter_a_name: this.batters.get(a)?.name ?? "Unknown",
      batter_a_runs: 0,
      batter_b_id: b ?? null,
      batter_b_name: b ? (this.batters.get(b)?.name ?? null) : null,
      batter_b_runs: 0,
      runs: 0,
      balls: 0,
      is_current: true,
    });
  }

  private closePartnership(): void {
    const last = this.partnerships.at(-1);
    if (last) last.is_current = false;
  }

  private nextAvailableBatter(): string | null {
    const seated = new Set([this.striker, this.nonStriker]);
    const candidates = this.battingSquad
      .filter((p) => {
        if (seated.has(p.id)) return false;
        const status = this.batters.get(p.id)?.status;
        return status === "did_not_bat" || status === "retired_hurt";
      })
      .sort((x, y) => {
        const ox = x.batting_order || 99;
        const oy = y.batting_order || 99;
        if (ox !== oy) return ox - oy;
        return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
      });
    return candidates[0]?.id ?? null;
  }

  private makeBallSummary(
    event: EngineDelivery,
    ctx: { striker: string; bowlerId: string; ballInOver: number; runsTotal: number },
  ): BallSummary {
    return {
      delivery_id: event.id,
      sequence: event.sequence,
      over_number: this.overIndex + 1,
      ball_in_over: ctx.ballInOver,
      over_ball_text: `${this.overIndex}.${ctx.ballInOver}`,
      display: formatBall(event, ctx.runsTotal),
      runs_total: ctx.runsTotal,
      batter_runs: event.batter_runs,
      extra_type: event.extra_type,
      extra_runs: event.extra_runs,
      is_wicket:
        event.is_wicket &&
        (event.wicket_type === null || !NON_DISMISSAL_WICKETS.includes(event.wicket_type)),
      is_legal: isLegal(event),
      is_free_hit: this.freeHit,
      striker_id: ctx.striker,
      striker_name: this.battingNames.get(ctx.striker) ?? "Unknown",
      bowler_id: ctx.bowlerId,
      bowler_name: this.bowlingNames.get(ctx.bowlerId) ?? "Unknown",
      commentary: event.commentary,
    };
  }

  private inconsistent(event: EngineDelivery, message: string): void {
    if (this.strict) {
      throw new RuleViolationError(message, "log_inconsistent", { sequence: event.sequence });
    }
    this.warnings.push(message);
    if (this.striker !== null && this.nonStriker !== null) {
      this.repairs.push({
        delivery_id: event.id,
        striker_id: this.striker,
        non_striker_id: this.nonStriker,
      });
    }
  }

  // ------------------------------------------------------------- completion
  private evaluateCompletion(): void {
    const rules = this.rules;
    if (rules.target_runs !== null && this.totalRuns >= rules.target_runs) {
      this.isComplete = true;
      this.endReason = "target_reached";
      return;
    }
    if (this.wickets >= maxWickets(rules)) {
      this.isComplete = true;
      this.endReason = "all_out";
      return;
    }
    const maxBalls = maxLegalBalls(rules);
    if (maxBalls !== null && this.legalBalls >= maxBalls) {
      this.isComplete = true;
      this.endReason = "overs_complete";
    }
  }

  private finalise(): InningsState {
    const ordered = [...this.batters.values()].sort((a, b) => {
      const pa = a.batting_position || 99;
      const pb = b.batting_position || 99;
      if (pa !== pb) return pa - pb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    const batting: BatterCard[] = ordered.map((b) => ({
      player_id: b.player_id,
      name: b.name,
      batting_position: b.batting_position,
      runs: b.runs,
      balls_faced: b.balls_faced,
      fours: b.fours,
      sixes: b.sixes,
      dots: b.dots,
      strike_rate: b.balls_faced === 0 ? 0 : pyRound((b.runs * 100) / b.balls_faced, 2),
      status: b.status,
      is_out: b.status === "out",
      has_batted: b.status !== "did_not_bat",
      wicket_type: b.wicket_type,
      dismissal_text: b.dismissal_text,
      dismissed_by_bowler_id: b.dismissed_by_bowler_id,
      fielder_id: b.fielder_id,
      is_striker: b.player_id === this.striker,
      is_non_striker: b.player_id === this.nonStriker,
    }));

    const perOver = this.rules.balls_per_over;
    const currentBowler = this.currentOver ? this.currentOver.bowler_id : null;
    const bowling: BowlerCard[] = [...this.bowlers.values()].map((b) => ({
      player_id: b.player_id,
      name: b.name,
      balls_bowled: b.balls_bowled,
      overs_text: `${Math.floor(b.balls_bowled / perOver)}.${b.balls_bowled % perOver}`,
      overs_decimal: pyRound(b.balls_bowled / perOver, 3),
      runs_conceded: b.runs_conceded,
      wickets: b.wickets,
      maidens: b.maidens,
      wides: b.wides,
      no_balls: b.no_balls,
      dots: b.dots,
      fours_conceded: b.fours_conceded,
      sixes_conceded: b.sixes_conceded,
      economy:
        b.balls_bowled === 0 ? 0 : pyRound((b.runs_conceded * perOver) / b.balls_bowled, 2),
      is_current_bowler: currentBowler === b.player_id,
    }));

    const seated = new Set([this.striker, this.nonStriker]);
    const available = this.battingSquad
      .filter((p) => {
        if (seated.has(p.id)) return false;
        const status = this.batters.get(p.id)?.status;
        return status === "did_not_bat" || status === "retired_hurt";
      })
      .map((p) => p.id);

    const ineligible: string[] = [];
    if (currentBowler === null) {
      if (this.rules.forbid_consecutive_overs && this.previousOverBowler) {
        ineligible.push(this.previousOverBowler);
      }
      if (this.rules.max_overs_per_bowler !== null) {
        const quota = this.rules.max_overs_per_bowler * perOver;
        for (const b of bowling) {
          if (b.balls_bowled >= quota && !ineligible.includes(b.player_id)) {
            ineligible.push(b.player_id);
          }
        }
      }
    }

    const limit = this.rules.overs_limit;
    const ballsRemaining =
      limit === null ? null : Math.max(0, limit * perOver - this.legalBalls);
    const runsNeeded =
      this.rules.target_runs === null
        ? null
        : Math.max(0, this.rules.target_runs - this.totalRuns);
    const requiredRunRate =
      runsNeeded === null || ballsRemaining === null || ballsRemaining <= 0 || runsNeeded <= 0
        ? null
        : pyRound((runsNeeded * perOver) / ballsRemaining, 2);
    const projected =
      limit === null || this.legalBalls === 0
        ? null
        : Math.round((this.totalRuns * (limit * perOver)) / this.legalBalls);
    const currentPartnership =
      [...this.partnerships].reverse().find((p) => p.is_current) ?? null;

    this.extras.total =
      this.extras.wide +
      this.extras.no_ball +
      this.extras.bye +
      this.extras.leg_bye +
      this.extras.penalty;

    return {
      total_runs: this.totalRuns,
      wickets: this.wickets,
      legal_balls: this.legalBalls,
      balls_per_over: perOver,
      overs_text: `${Math.floor(this.legalBalls / perOver)}.${this.legalBalls % perOver}`,
      overs_decimal: pyRound(this.legalBalls / perOver, 3),
      run_rate:
        this.legalBalls === 0 ? 0 : pyRound((this.totalRuns * perOver) / this.legalBalls, 2),
      required_run_rate: requiredRunRate,
      projected_score: projected,
      balls_remaining: ballsRemaining,
      wickets_remaining: Math.max(0, maxWickets(this.rules) - this.wickets),
      runs_needed: runsNeeded,
      target_runs: this.rules.target_runs,
      overs_limit: limit,
      max_wickets: maxWickets(this.rules),
      is_all_out: this.wickets >= maxWickets(this.rules),
      is_complete: this.isComplete,
      end_reason: this.endReason,
      next_action: this.nextAction(available, currentBowler),
      is_free_hit: this.freeHit,
      striker_id: this.striker,
      non_striker_id: this.nonStriker,
      current_bowler_id: currentBowler,
      previous_over_bowler_id: this.previousOverBowler,
      extras: this.extras,
      batting,
      bowling,
      partnerships: this.partnerships,
      current_partnership: currentPartnership,
      fall_of_wickets: this.fallOfWickets,
      available_batter_ids: available,
      ineligible_bowler_ids: ineligible,
      warnings: this.warnings,
      overs: this.oversList,
      timeline: this.timeline,
    };
  }

  private nextAction(available: string[], currentBowler: string | null): NextAction {
    if (this.isComplete) return "innings_complete";
    if (this.striker === null && this.nonStriker === null) return "select_openers";
    if (this.striker === null || this.nonStriker === null) {
      return available.length > 0 ? "select_batter" : "innings_complete";
    }
    if (currentBowler === null) return "select_bowler";
    return "record_delivery";
  }
}

// -------------------------------------------------------------------- helpers

/** Render a dismissal the way a scorebook would. */
export function describeDismissal(
  wicketType: WicketType,
  bowlerName: string | null,
  fielderName: string | null = null,
): string {
  const bowler = bowlerName || "unknown";
  const fielder = fielderName || "unknown";
  switch (wicketType) {
    case "bowled":
      return `b ${bowler}`;
    case "caught":
      return `c ${fielder} b ${bowler}`;
    case "caught_and_bowled":
      return `c & b ${bowler}`;
    case "lbw":
      return `lbw b ${bowler}`;
    case "stumped":
      return `st ${fielder} b ${bowler}`;
    case "hit_wicket":
      return `hit wicket b ${bowler}`;
    case "run_out":
      return fielderName ? `run out (${fielder})` : "run out";
    case "obstructing_the_field":
      return "obstructing the field";
    case "hit_ball_twice":
      return "hit the ball twice";
    case "timed_out":
      return "timed out";
    case "retired_out":
      return "retired out";
    case "retired_hurt":
      return "retired hurt";
    default:
      return String(wicketType).replace(/_/g, " ");
  }
}

/** Compact scorebook token for one delivery, e.g. `•`, `4`, `2wd`, `W`. */
export function formatBall(event: EngineDelivery, runsTotal: number): string {
  let token: string;
  switch (event.extra_type) {
    case "wide":
      token = `${runsTotal}wd`;
      break;
    case "no_ball": {
      const scored = event.batter_runs + event.extra_runs;
      token = scored ? `nb+${scored}` : "nb";
      break;
    }
    case "bye":
      token = `${event.extra_runs}b`;
      break;
    case "leg_bye":
      token = `${event.extra_runs}lb`;
      break;
    case "penalty":
      token = `+${event.extra_runs}p`;
      break;
    default:
      token = event.batter_runs === 0 ? "•" : String(event.batter_runs);
      break;
  }

  const dismissal =
    event.is_wicket &&
    (event.wicket_type === null || !NON_DISMISSAL_WICKETS.includes(event.wicket_type));
  if (dismissal) return token === "•" || token === "0" ? "W" : `${token}+W`;
  if (event.is_wicket) return token === "•" || token === "0" ? "R" : `${token}+R`;
  return token;
}
