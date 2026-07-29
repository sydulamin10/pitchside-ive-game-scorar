"""The scoring engine.

A pure, deterministic replay of a delivery log into a complete innings state.
No I/O, no globals, no database — feed it the same ordered list of deliveries and
it will always produce the same numbers. That property is what makes "edit any
past ball and every downstream figure fixes itself" possible: we never mutate a
stored aggregate, we simply replay.

Laws implemented (and where the interesting decisions live)
----------------------------------------------------------
* **Legal balls** — wides and no-balls do not advance the over; byes and leg-byes
  do, because they occur off a fair delivery.
* **Balls faced** — a no-ball *is* a ball faced by the batter, a wide is not.
* **Runs charged to the bowler** — runs off the bat, wides, and no-balls. Byes,
  leg-byes and penalty awards are the fielding side's fault, not the bowler's.
* **Maiden over** — an over in which the bowler is charged nothing. Byes and
  leg-byes therefore do not spoil a maiden; a single wide does.
* **Strike rotation** — driven by ``batters_crossed`` (the parity of crossings),
  defaulting to the parity of the runs actually run, then swapped again at the
  end of every over.
* **Free hit** — set by a no-ball and retained until the next *legal* delivery,
  during which only run-out style dismissals are possible.
* **Net run rate overs** — a side bowled out is charged its full quota.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from app.core.errors import RuleViolation
from app.models.enums import (
    BOWLER_CREDITED_WICKETS,
    NON_DISMISSAL_WICKETS,
    WICKETS_ALLOWED_ON_NO_BALL,
    WICKETS_ALLOWED_ON_WIDE,
    ExtraType,
    InningsEndReason,
    WicketType,
)
from app.scoring.types import (
    BallSummary,
    BatterInnings,
    BatterStatus,
    BowlerInnings,
    DeliveryEvent,
    Extras,
    FallOfWicket,
    InningsRules,
    InningsState,
    NextAction,
    OverSummary,
    Partnership,
    PlayerRef,
)

MAX_BATTER_RUNS = 12


@dataclass(slots=True)
class StrikeRepair:
    """A downstream delivery whose recorded batters no longer match the replay.

    Produced when an earlier ball is edited in a way that shifts strike rotation.
    The service layer persists these so the stored log stays self-consistent.
    """

    delivery_id: str
    striker_id: str
    non_striker_id: str


@dataclass(slots=True)
class ReplayResult:
    state: InningsState
    repairs: list[StrikeRepair] = field(default_factory=list)


# ---------------------------------------------------------------- public API


def build_innings_state(
    rules: InningsRules,
    batting_squad: Sequence[PlayerRef],
    bowling_squad: Sequence[PlayerRef],
    deliveries: Iterable[DeliveryEvent],
) -> InningsState:
    """Replay a delivery log into the full innings state."""
    return replay(rules, batting_squad, bowling_squad, deliveries).state


def replay(
    rules: InningsRules,
    batting_squad: Sequence[PlayerRef],
    bowling_squad: Sequence[PlayerRef],
    deliveries: Iterable[DeliveryEvent],
    *,
    strict: bool = False,
) -> ReplayResult:
    """Replay a delivery log, optionally refusing to tolerate inconsistencies.

    ``strict=True`` raises on a log that could not have happened (used when
    validating fixtures and imports). The default is forgiving: it repairs strike
    assignments and records human-readable warnings, which is what an edited log
    needs.
    """
    return _Replayer(rules, batting_squad, bowling_squad, strict=strict).run(deliveries)


def validate_delivery(
    state: InningsState,
    event: DeliveryEvent,
    rules: InningsRules,
    batting_squad: Sequence[PlayerRef],
    bowling_squad: Sequence[PlayerRef],
) -> None:
    """Reject a delivery that is illegal given the current state.

    Raised errors carry a machine-readable ``code`` so the scoring UI can point
    at the offending control instead of showing a generic toast.
    """
    batters = {p.id: p for p in batting_squad if p.is_playing}
    bowlers = {p.id: p for p in bowling_squad if p.is_playing}

    if state.is_complete:
        raise RuleViolation(
            "This innings is already complete.",
            code="innings_complete",
            details={"end_reason": state.end_reason.value if state.end_reason else None},
        )

    # ------------------------------------------------------------- personnel
    if event.striker_id == event.non_striker_id:
        raise RuleViolation(
            "The striker and non-striker must be different players.", code="batters_identical"
        )
    for field_name, player_id in (
        ("striker_id", event.striker_id),
        ("non_striker_id", event.non_striker_id),
    ):
        if player_id not in batters:
            raise RuleViolation(
                "That batter is not in the batting side for this match.",
                code="unknown_batter",
                details={"field": field_name, "player_id": player_id},
            )
    if event.bowler_id not in bowlers:
        raise RuleViolation(
            "That bowler is not in the fielding side for this match.",
            code="unknown_bowler",
            details={"player_id": event.bowler_id},
        )

    dismissed = {b.player_id for b in state.batting if b.status is BatterStatus.OUT}
    for player_id in (event.striker_id, event.non_striker_id):
        if player_id in dismissed:
            raise RuleViolation(
                "That batter is already out.",
                code="batter_already_out",
                details={"player_id": player_id},
            )

    at_crease = {i for i in (state.striker_id, state.non_striker_id) if i}
    incoming = {event.striker_id, event.non_striker_id} - at_crease
    if at_crease and len(at_crease) == 2 and incoming:
        raise RuleViolation(
            "Those batters are not at the crease. Reload the live state and retry.",
            code="batters_not_at_crease",
            details={
                "expected": sorted(at_crease),
                "received": sorted({event.striker_id, event.non_striker_id}),
            },
        )
    # Two batters walk out together only at the very start of an innings; after
    # that they arrive one at a time, as wickets fall.
    if at_crease and len(incoming) > 1:
        raise RuleViolation(
            "Only one new batter can come in at a time.",
            code="too_many_new_batters",
        )
    if incoming and state.available_batter_ids:
        for new_batter in sorted(incoming):
            if new_batter not in state.available_batter_ids:
                raise RuleViolation(
                    "That batter is not available to come in.",
                    code="batter_unavailable",
                    details={"player_id": new_batter},
                )

    # ---------------------------------------------------------------- bowler
    if event.is_ball_event:
        if state.next_action is NextAction.SELECT_BOWLER:
            if event.bowler_id in state.ineligible_bowler_ids:
                reason = (
                    "consecutive_overs"
                    if event.bowler_id == state.previous_over_bowler_id
                    else "over_quota_reached"
                )
                raise RuleViolation(
                    "That bowler cannot bowl this over."
                    if reason == "consecutive_overs"
                    else "That bowler has already bowled their maximum overs.",
                    code=reason,
                    details={"player_id": event.bowler_id},
                )
        elif state.current_bowler_id and event.bowler_id != state.current_bowler_id:
            raise RuleViolation(
                "The over is not finished — the same bowler must complete it.",
                code="bowler_changed_mid_over",
                details={"expected_bowler_id": state.current_bowler_id},
            )

    # ---------------------------------------------------------------- scoring
    if not 0 <= event.batter_runs <= MAX_BATTER_RUNS:
        raise RuleViolation(
            f"Runs off the bat must be between 0 and {MAX_BATTER_RUNS}.", code="invalid_batter_runs"
        )
    if event.extra_runs < 0:
        raise RuleViolation("Extra runs cannot be negative.", code="invalid_extra_runs")

    extra = event.extra_type
    if extra is None and event.extra_runs:
        raise RuleViolation(
            "Extra runs require an extra type (wide, no-ball, bye, leg-bye or penalty).",
            code="extras_without_type",
        )
    if extra in (ExtraType.WIDE, ExtraType.BYE, ExtraType.LEG_BYE) and event.batter_runs:
        raise RuleViolation(
            "Runs off the bat cannot be combined with a wide, bye or leg-bye. "
            "If the batter hit it, record it as runs (or a no-ball).",
            code="bat_runs_with_extra",
            details={"extra_type": extra.value},
        )
    if extra is ExtraType.PENALTY:
        if event.batter_runs:
            raise RuleViolation(
                "A penalty award is not attached to a shot.", code="bat_runs_with_penalty"
            )
        if event.extra_runs <= 0:
            raise RuleViolation("A penalty award must be at least 1 run.", code="empty_penalty")
        if event.is_wicket:
            raise RuleViolation(
                "A penalty award cannot include a wicket.", code="wicket_on_penalty"
            )
    if not rules.allow_boundaries and event.batter_runs >= 4:
        raise RuleViolation(
            "Boundaries are disabled for this match's rules.",
            code="boundaries_disabled",
            details={"batter_runs": event.batter_runs},
        )

    # ---------------------------------------------------------------- wickets
    if event.is_wicket:
        if event.wicket_type is None:
            raise RuleViolation("Select how the batter was dismissed.", code="missing_wicket_type")
        wicket_type = event.wicket_type
        dismissed_id = event.dismissed_player_id or event.striker_id
        if dismissed_id not in (event.striker_id, event.non_striker_id):
            raise RuleViolation(
                "Only a batter at the crease can be dismissed.",
                code="invalid_dismissed_player",
                details={"player_id": dismissed_id},
            )
        if extra is ExtraType.NO_BALL and wicket_type not in WICKETS_ALLOWED_ON_NO_BALL:
            raise RuleViolation(
                f"A batter cannot be {wicket_type.value.replace('_', ' ')} off a no-ball.",
                code="wicket_illegal_on_no_ball",
                details={"wicket_type": wicket_type.value},
            )
        if extra is ExtraType.WIDE and wicket_type not in WICKETS_ALLOWED_ON_WIDE:
            raise RuleViolation(
                f"A batter cannot be {wicket_type.value.replace('_', ' ')} off a wide.",
                code="wicket_illegal_on_wide",
                details={"wicket_type": wicket_type.value},
            )
        if state.is_free_hit and wicket_type not in WICKETS_ALLOWED_ON_NO_BALL:
            raise RuleViolation(
                "It is a free hit — only a run-out style dismissal is possible.",
                code="wicket_illegal_on_free_hit",
                details={"wicket_type": wicket_type.value},
            )
        if wicket_type in (WicketType.CAUGHT, WicketType.STUMPED) and not event.fielder_id:
            raise RuleViolation(
                "Select the fielder who completed the dismissal.",
                code="missing_fielder",
                details={"wicket_type": wicket_type.value},
            )
        if event.fielder_id and event.fielder_id not in bowlers:
            raise RuleViolation(
                "That fielder is not in the fielding side.",
                code="unknown_fielder",
                details={"player_id": event.fielder_id},
            )
        if wicket_type is WicketType.CAUGHT_AND_BOWLED and event.fielder_id not in (
            None,
            event.bowler_id,
        ):
            raise RuleViolation(
                "Caught and bowled means the bowler took the catch.",
                code="invalid_fielder_for_wicket",
            )
        if event.replacement_batter_id:
            replacement = event.replacement_batter_id
            if replacement in (event.striker_id, event.non_striker_id):
                raise RuleViolation(
                    "The incoming batter is already at the crease.",
                    code="replacement_at_crease",
                )
            if replacement not in batters:
                raise RuleViolation(
                    "That batter is not in the batting side.",
                    code="unknown_batter",
                    details={"player_id": replacement},
                )
            if replacement in dismissed:
                raise RuleViolation(
                    "That batter is already out.",
                    code="batter_already_out",
                    details={"player_id": replacement},
                )
    elif event.wicket_type is not None or event.dismissed_player_id is not None:
        raise RuleViolation(
            "Dismissal details were supplied but the delivery is not marked as a wicket.",
            code="wicket_flag_missing",
        )


# ------------------------------------------------------------------- internals


class _Replayer:
    """Mutable accumulator used for a single replay pass."""

    def __init__(
        self,
        rules: InningsRules,
        batting_squad: Sequence[PlayerRef],
        bowling_squad: Sequence[PlayerRef],
        *,
        strict: bool = False,
    ) -> None:
        self.rules = rules
        self.strict = strict
        self.batting_squad = [p for p in batting_squad if p.is_playing]
        self.bowling_squad = [p for p in bowling_squad if p.is_playing]
        self.batting_names = {p.id: p.name for p in batting_squad}
        self.bowling_names = {p.id: p.name for p in bowling_squad}

        self.batters: dict[str, BatterInnings] = {
            p.id: BatterInnings(player_id=p.id, name=p.name) for p in self.batting_squad
        }
        self.bowlers: dict[str, BowlerInnings] = {}

        self.total_runs = rules.innings_penalty_runs
        self.wickets = 0
        self.legal_balls = 0
        self.extras = Extras(penalty=rules.innings_penalty_runs)

        self.striker: str | None = None
        self.non_striker: str | None = None
        self.next_position = 1

        self.partnerships: list[Partnership] = []
        self.fall_of_wickets: list[FallOfWicket] = []
        self.overs: list[OverSummary] = []
        self.timeline: list[BallSummary] = []
        self.warnings: list[str] = []
        self.repairs: list[StrikeRepair] = []

        self.legal_in_over = 0
        self.over_index = 0
        self.current_over: OverSummary | None = None
        self.over_runs_charged = 0
        self.previous_over_bowler: str | None = None
        self.free_hit = False
        self.retired_hurt: set[str] = set()
        self.is_complete = False
        self.end_reason: InningsEndReason | None = None

    # ------------------------------------------------------------------- run
    def run(self, deliveries: Iterable[DeliveryEvent]) -> ReplayResult:
        ordered = sorted(deliveries, key=lambda d: d.sequence)
        for event in ordered:
            if self.is_complete:
                self.warnings.append(
                    f"Delivery {event.sequence} was recorded after the innings ended "
                    f"({self.end_reason.value if self.end_reason else 'unknown'}). It is included "
                    "in the totals — review and delete it if that is wrong."
                )
                self.is_complete = False
                self.end_reason = None
            self._apply(event)
            self._evaluate_completion()
        return ReplayResult(state=self._finalise(), repairs=self.repairs)

    # --------------------------------------------------------------- one ball
    def _apply(self, event: DeliveryEvent) -> None:
        if not self._seat_batters(event):
            return
        striker = self.striker
        non_striker = self.non_striker
        if striker is None:  # pragma: no cover - guarded by _seat_batters
            return

        if event.extra_type is ExtraType.PENALTY:
            self._apply_penalty(event, striker)
            return

        bowler = self._resolve_bowler(event)
        extra_total, bowler_charge, runs_run = self._split_runs(event)

        self.total_runs += event.batter_runs + extra_total
        self._record_extras(event, extra_total)

        batter = self.batters[striker]
        if batter.status is BatterStatus.DID_NOT_BAT:
            batter.status = BatterStatus.NOT_OUT
        batter.runs += event.batter_runs
        if event.is_ball_faced:
            batter.balls_faced += 1
            if event.batter_runs == 0 and extra_total == 0:
                batter.dots += 1
        if self._is_boundary(event) and event.extra_type in (None, ExtraType.NO_BALL):
            if event.batter_runs == 4:
                batter.fours += 1
                bowler.fours_conceded += 1
            elif event.batter_runs == 6:
                batter.sixes += 1
                bowler.sixes_conceded += 1

        bowler.runs_conceded += bowler_charge
        self.over_runs_charged += bowler_charge
        if event.extra_type is ExtraType.WIDE:
            bowler.wides += 1
        elif event.extra_type is ExtraType.NO_BALL:
            bowler.no_balls += 1
        if event.is_legal:
            bowler.balls_bowled += 1
            if event.batter_runs + extra_total == 0:
                bowler.dots += 1

        # Partnership accrues everything added while the pair is together.
        partnership = self.partnerships[-1] if self.partnerships else None
        if partnership is not None:
            partnership.runs += event.batter_runs + extra_total
            if event.is_legal:
                partnership.balls += 1
            if partnership.batter_a_id == striker:
                partnership.batter_a_runs += event.batter_runs
            elif partnership.batter_b_id == striker:
                partnership.batter_b_runs += event.batter_runs

        ball_in_over = min(self.legal_in_over + 1, self.rules.balls_per_over)
        if event.is_legal:
            self.legal_balls += 1
            self.legal_in_over += 1
            ball_in_over = self.legal_in_over

        summary = self._make_ball_summary(
            event,
            striker=striker,
            bowler_id=bowler.player_id,
            ball_in_over=ball_in_over,
            runs_total=event.batter_runs + extra_total,
        )
        self.timeline.append(summary)
        if self.current_over is not None:
            self.current_over.balls.append(summary)
            self.current_over.runs += event.batter_runs + extra_total

        crossed = self._crossed(event, runs_run)
        # Either end can become empty when a wicket falls and no replacement has
        # been named yet, so both are optional from here on.
        end_striker: str | None = non_striker if crossed and non_striker else striker
        end_non_striker: str | None = striker if crossed and non_striker else non_striker

        if event.is_wicket and event.wicket_type is not None:
            end_striker, end_non_striker = self._apply_wicket(
                event,
                bowler=bowler,
                delivery_striker=striker,
                end_striker=end_striker,
                end_non_striker=end_non_striker,
                over_ball_text=summary.over_ball_text,
            )

        self.striker = end_striker
        self.non_striker = end_non_striker

        # Free hit survives an illegal delivery and is cleared by a legal one.
        if event.extra_type is ExtraType.NO_BALL and self.rules.free_hit_after_no_ball:
            self.free_hit = True
        elif event.is_legal:
            self.free_hit = False

        if event.is_legal and self.legal_in_over >= self.rules.balls_per_over:
            self._close_over(bowler)

    # ------------------------------------------------------------- sub-steps
    def _seat_batters(self, event: DeliveryEvent) -> bool:
        """Establish who is at the crease, honouring a deliberate ends swap.

        Returns ``False`` when the delivery cannot be applied because nobody is
        left to bat.
        """
        at_crease = [i for i in (self.striker, self.non_striker) if i is not None]

        if not at_crease:
            self._introduce(event.striker_id)
            self._introduce(event.non_striker_id)
            self.striker, self.non_striker = event.striker_id, event.non_striker_id
            self._open_partnership()
            return True

        if len(at_crease) == 2:
            # Ends are a *consequence* of crossings, never an input, so the
            # replay wins. When an earlier ball is edited the rotation shifts and
            # the stored rows are repaired rather than trusted.
            if {event.striker_id, event.non_striker_id} != set(at_crease):
                self._inconsistent(
                    event,
                    f"Delivery {event.sequence} names batters who are not at the crease; "
                    "the replayed pair was used instead.",
                )
            elif event.striker_id != self.striker:
                self.repairs.append(
                    StrikeRepair(
                        delivery_id=event.id,
                        striker_id=self.striker or event.striker_id,
                        non_striker_id=self.non_striker or event.non_striker_id,
                    )
                )
            return True

        # Exactly one batter at the crease: a replacement is joining.
        surviving = at_crease[0]
        incoming = [pid for pid in (event.striker_id, event.non_striker_id) if pid != surviving]
        if len(incoming) != 1:
            self._inconsistent(
                event,
                f"Delivery {event.sequence} does not identify the incoming batter; "
                "the next available batter was used instead.",
            )
            new_batter = self._next_available_batter()
        else:
            new_batter = incoming[0]
        if new_batter is None:
            self.is_complete = True
            self.end_reason = InningsEndReason.ALL_OUT
            self.warnings.append(
                f"Delivery {event.sequence} could not be applied: no batter is left to come in."
            )
            return False
        self._introduce(new_batter)
        if event.striker_id == surviving:
            self.striker, self.non_striker = surviving, new_batter
        else:
            self.striker, self.non_striker = new_batter, surviving
        self._open_partnership()
        return True

    def _apply_penalty(self, event: DeliveryEvent, striker: str) -> None:
        """A penalty award: runs, but not a ball."""
        self.total_runs += event.extra_runs
        self.extras.penalty += event.extra_runs
        if self.partnerships:
            self.partnerships[-1].runs += event.extra_runs
        summary = self._make_ball_summary(
            event,
            striker=striker,
            bowler_id=event.bowler_id,
            ball_in_over=min(self.legal_in_over + 1, self.rules.balls_per_over),
            runs_total=event.extra_runs,
        )
        self.timeline.append(summary)
        if self.current_over is not None:
            self.current_over.balls.append(summary)
            self.current_over.runs += event.extra_runs

    def _resolve_bowler(self, event: DeliveryEvent) -> BowlerInnings:
        starting_new_over = self.current_over is None
        if starting_new_over:
            if (
                self.strict
                and self.rules.forbid_consecutive_overs
                and self.previous_over_bowler is not None
                and event.bowler_id == self.previous_over_bowler
            ):
                raise RuleViolation(
                    "A bowler may not bowl consecutive overs.",
                    code="consecutive_overs",
                    details={"player_id": event.bowler_id, "over": self.over_index + 1},
                )
            if (
                self.rules.forbid_consecutive_overs
                and self.previous_over_bowler is not None
                and event.bowler_id == self.previous_over_bowler
            ):
                self.warnings.append(
                    f"Over {self.over_index + 1} is bowled by the same bowler as the previous "
                    "over. This usually means an earlier ball was edited — review the over."
                )
            bowler_name = self.bowling_names.get(event.bowler_id, "Unknown bowler")
            self.current_over = OverSummary(
                over_number=self.over_index + 1,
                bowler_id=event.bowler_id,
                bowler_name=bowler_name,
            )
            self.overs.append(self.current_over)
            self.over_runs_charged = 0

        bowler = self.bowlers.get(event.bowler_id)
        if bowler is None:
            bowler = BowlerInnings(
                player_id=event.bowler_id,
                name=self.bowling_names.get(event.bowler_id, "Unknown bowler"),
                balls_per_over=self.rules.balls_per_over,
            )
            self.bowlers[event.bowler_id] = bowler
        return bowler

    def _split_runs(self, event: DeliveryEvent) -> tuple[int, int, int]:
        """Return ``(extra_runs_total, runs_charged_to_bowler, runs_physically_run)``."""
        extra = event.extra_type
        if extra is ExtraType.WIDE:
            extra_total = self.rules.wide_penalty_runs + event.extra_runs
            bowler_charge = extra_total
            runs_run = event.extra_runs
        elif extra is ExtraType.NO_BALL:
            extra_total = self.rules.no_ball_penalty_runs + event.extra_runs
            bowler_charge = extra_total + event.batter_runs
            runs_run = event.batter_runs + event.extra_runs
        elif extra in (ExtraType.BYE, ExtraType.LEG_BYE):
            extra_total = event.extra_runs
            bowler_charge = 0
            runs_run = event.extra_runs
        else:
            extra_total = 0
            bowler_charge = event.batter_runs
            runs_run = event.batter_runs
        if self._is_boundary(event):
            runs_run = 0
        return extra_total, bowler_charge, runs_run

    def _record_extras(self, event: DeliveryEvent, extra_total: int) -> None:
        match event.extra_type:
            case ExtraType.WIDE:
                self.extras.wide += extra_total
            case ExtraType.NO_BALL:
                self.extras.no_ball += extra_total
            case ExtraType.BYE:
                self.extras.bye += extra_total
            case ExtraType.LEG_BYE:
                self.extras.leg_bye += extra_total
            case _:
                pass

    def _is_boundary(self, event: DeliveryEvent) -> bool:
        """Did the ball reach the rope (so the batters never crossed)?

        For runs off the bat we infer it — running four is vanishingly rare and
        the flag only affects the boundary columns. For wides and byes the flag
        must be explicit, because "4 wides" and "wide plus three run" are
        genuinely different events.
        """
        if event.is_boundary:
            return True
        if event.extra_type in (None, ExtraType.NO_BALL):
            return event.batter_runs in (4, 6)
        return False

    def _crossed(self, event: DeliveryEvent, runs_run: int) -> bool:
        if event.batters_crossed is not None:
            return event.batters_crossed
        return runs_run % 2 == 1

    def _apply_wicket(
        self,
        event: DeliveryEvent,
        *,
        bowler: BowlerInnings,
        delivery_striker: str,
        end_striker: str | None,
        end_non_striker: str | None,
        over_ball_text: str,
    ) -> tuple[str | None, str | None]:
        wicket_type = event.wicket_type
        assert wicket_type is not None
        # Unless told otherwise the batter who faced the ball is the one out —
        # note this is the striker *before* any crossing, not after.
        dismissed_id = event.dismissed_player_id or delivery_striker
        batter = self.batters.get(dismissed_id)
        if batter is None:
            self.warnings.append(
                f"Delivery {event.sequence} dismisses an unknown batter; the wicket was ignored."
            )
            return end_striker, end_non_striker

        is_dismissal = wicket_type not in NON_DISMISSAL_WICKETS
        if wicket_type in BOWLER_CREDITED_WICKETS:
            bowler.wickets += 1

        if is_dismissal:
            self.wickets += 1
            batter.status = BatterStatus.OUT
        else:
            batter.status = BatterStatus.RETIRED_HURT
            self.retired_hurt.add(dismissed_id)
        batter.wicket_type = wicket_type
        batter.dismissed_by_bowler_id = bowler.player_id
        batter.dismissed_by_bowler_name = bowler.name
        batter.fielder_id = event.fielder_id
        batter.fielder_name = self.bowling_names.get(event.fielder_id or "")
        batter.dismissal_text = describe_dismissal(
            wicket_type,
            bowler_name=bowler.name,
            fielder_name=batter.fielder_name,
        )

        if is_dismissal:
            self.fall_of_wickets.append(
                FallOfWicket(
                    wicket_number=self.wickets,
                    runs_at_fall=self.total_runs,
                    overs_text=over_ball_text,
                    batter_id=dismissed_id,
                    batter_name=batter.name,
                    dismissal_text=batter.dismissal_text or "",
                )
            )
        self._close_partnership()

        # The incoming batter takes the vacated end.
        replacement = event.replacement_batter_id
        if replacement is not None and replacement in self.batters:
            self._introduce(replacement)
        else:
            replacement = None

        if dismissed_id == end_striker:
            end_striker = replacement
        elif dismissed_id == end_non_striker:
            end_non_striker = replacement
        else:
            self.warnings.append(
                f"Delivery {event.sequence} dismissed a batter who was not at the crease; "
                "the striker's end was vacated instead."
            )
            end_striker = replacement

        if replacement is not None:
            self._open_partnership(striker=end_striker, non_striker=end_non_striker)
        return end_striker, end_non_striker

    def _close_over(self, bowler: BowlerInnings) -> None:
        if self.current_over is not None:
            self.current_over.is_complete = True
            self.current_over.wickets = sum(1 for b in self.current_over.balls if b.is_wicket)
            if self.over_runs_charged == 0:
                self.current_over.is_maiden = True
                bowler.maidens += 1
        self.previous_over_bowler = bowler.player_id
        self.current_over = None
        self.legal_in_over = 0
        self.over_index += 1
        self.striker, self.non_striker = self.non_striker, self.striker

    def _introduce(self, player_id: str) -> None:
        batter = self.batters.get(player_id)
        if batter is None:
            self.warnings.append(f"Unknown batter {player_id} appeared in the log.")
            self.batters[player_id] = batter = BatterInnings(
                player_id=player_id, name=self.batting_names.get(player_id, "Unknown batter")
            )
        if batter.status is BatterStatus.DID_NOT_BAT:
            batter.status = BatterStatus.NOT_OUT
        if batter.batting_position == 0:
            batter.batting_position = self.next_position
            self.next_position += 1
        elif batter.status is BatterStatus.RETIRED_HURT:
            batter.status = BatterStatus.NOT_OUT
            self.retired_hurt.discard(player_id)

    def _open_partnership(self, striker: str | None = None, non_striker: str | None = None) -> None:
        a = striker if striker is not None else self.striker
        b = non_striker if non_striker is not None else self.non_striker
        if a is None:
            a, b = b, None
        if a is None:
            return
        self.partnerships.append(
            Partnership(
                wicket_number=self.wickets,
                batter_a_id=a,
                batter_a_name=self.batters[a].name if a in self.batters else "Unknown",
                batter_b_id=b,
                batter_b_name=self.batters[b].name if b and b in self.batters else None,
                is_current=True,
            )
        )

    def _close_partnership(self) -> None:
        if self.partnerships:
            self.partnerships[-1].is_current = False

    def _next_available_batter(self) -> str | None:
        seated = {self.striker, self.non_striker}
        candidates = [
            p
            for p in self.batting_squad
            if p.id not in seated
            and self.batters[p.id].status in (BatterStatus.DID_NOT_BAT, BatterStatus.RETIRED_HURT)
        ]
        candidates.sort(key=lambda p: (p.batting_order or 99, p.name))
        return candidates[0].id if candidates else None

    def _make_ball_summary(
        self,
        event: DeliveryEvent,
        *,
        striker: str,
        bowler_id: str,
        ball_in_over: int,
        runs_total: int,
    ) -> BallSummary:
        over_number = self.over_index + 1
        return BallSummary(
            delivery_id=event.id,
            sequence=event.sequence,
            over_number=over_number,
            ball_in_over=ball_in_over,
            over_ball_text=f"{self.over_index}.{ball_in_over}",
            display=format_ball(event, runs_total),
            runs_total=runs_total,
            batter_runs=event.batter_runs,
            extra_type=event.extra_type.value if event.extra_type else None,
            extra_runs=event.extra_runs,
            is_wicket=event.is_wicket and event.wicket_type not in NON_DISMISSAL_WICKETS,
            is_legal=event.is_legal,
            is_free_hit=self.free_hit,
            striker_id=striker,
            striker_name=self.batting_names.get(striker, "Unknown"),
            bowler_id=bowler_id,
            bowler_name=self.bowling_names.get(bowler_id, "Unknown"),
            commentary=event.commentary,
        )

    def _inconsistent(self, event: DeliveryEvent, message: str) -> None:
        if self.strict:
            raise RuleViolation(
                message, code="log_inconsistent", details={"sequence": event.sequence}
            )
        self.warnings.append(message)
        if self.striker is not None and self.non_striker is not None:
            self.repairs.append(
                StrikeRepair(
                    delivery_id=event.id,
                    striker_id=self.striker,
                    non_striker_id=self.non_striker,
                )
            )

    # ------------------------------------------------------------ completion
    def _evaluate_completion(self) -> None:
        rules = self.rules
        if rules.target_runs is not None and self.total_runs >= rules.target_runs:
            self.is_complete = True
            self.end_reason = InningsEndReason.TARGET_REACHED
            return
        if self.wickets >= rules.max_wickets:
            self.is_complete = True
            self.end_reason = InningsEndReason.ALL_OUT
            return
        max_balls = rules.max_legal_balls
        if max_balls is not None and self.legal_balls >= max_balls:
            self.is_complete = True
            self.end_reason = InningsEndReason.OVERS_COMPLETE

    def _finalise(self) -> InningsState:
        batting = sorted(
            self.batters.values(),
            key=lambda b: (
                b.batting_position if b.batting_position else 99,
                b.name,
            ),
        )
        for batter in batting:
            batter.is_striker = batter.player_id == self.striker
            batter.is_non_striker = batter.player_id == self.non_striker

        bowling = list(self.bowlers.values())
        for bowler in bowling:
            bowler.is_current_bowler = (
                self.current_over is not None and self.current_over.bowler_id == bowler.player_id
            )

        seated = {self.striker, self.non_striker}
        available = [
            p.id
            for p in self.batting_squad
            if p.id not in seated
            and self.batters[p.id].status in (BatterStatus.DID_NOT_BAT, BatterStatus.RETIRED_HURT)
        ]

        current_bowler = self.current_over.bowler_id if self.current_over else None
        ineligible: list[str] = []
        if current_bowler is None:
            if self.rules.forbid_consecutive_overs and self.previous_over_bowler:
                ineligible.append(self.previous_over_bowler)
            if self.rules.max_overs_per_bowler is not None:
                quota_balls = self.rules.max_overs_per_bowler * self.rules.balls_per_over
                ineligible.extend(
                    b.player_id
                    for b in bowling
                    if b.balls_bowled >= quota_balls and b.player_id not in ineligible
                )

        next_action = self._next_action(available, current_bowler)

        return InningsState(
            total_runs=self.total_runs,
            wickets=self.wickets,
            legal_balls=self.legal_balls,
            balls_per_over=self.rules.balls_per_over,
            extras=self.extras,
            batting=batting,
            bowling=bowling,
            partnerships=self.partnerships,
            fall_of_wickets=self.fall_of_wickets,
            overs=self.overs,
            timeline=self.timeline,
            striker_id=self.striker,
            non_striker_id=self.non_striker,
            current_bowler_id=current_bowler,
            previous_over_bowler_id=self.previous_over_bowler,
            is_free_hit=self.free_hit,
            next_action=next_action,
            is_complete=self.is_complete,
            end_reason=self.end_reason,
            target_runs=self.rules.target_runs,
            overs_limit=self.rules.overs_limit,
            max_wickets=self.rules.max_wickets,
            available_batter_ids=available,
            ineligible_bowler_ids=ineligible,
            warnings=self.warnings,
        )

    def _next_action(self, available: list[str], current_bowler: str | None) -> NextAction:
        if self.is_complete:
            return NextAction.INNINGS_COMPLETE
        if self.striker is None and self.non_striker is None:
            return NextAction.SELECT_OPENERS
        if self.striker is None or self.non_striker is None:
            return NextAction.SELECT_BATTER if available else NextAction.INNINGS_COMPLETE
        if current_bowler is None:
            return NextAction.SELECT_BOWLER
        return NextAction.RECORD_DELIVERY


# ------------------------------------------------------------------- helpers


def describe_dismissal(
    wicket_type: WicketType,
    *,
    bowler_name: str | None,
    fielder_name: str | None = None,
) -> str:
    """Render a dismissal the way a scorebook would."""
    bowler = bowler_name or "unknown"
    fielder = fielder_name or "unknown"
    match wicket_type:
        case WicketType.BOWLED:
            return f"b {bowler}"
        case WicketType.CAUGHT:
            return f"c {fielder} b {bowler}"
        case WicketType.CAUGHT_AND_BOWLED:
            return f"c & b {bowler}"
        case WicketType.LBW:
            return f"lbw b {bowler}"
        case WicketType.STUMPED:
            return f"st {fielder} b {bowler}"
        case WicketType.HIT_WICKET:
            return f"hit wicket b {bowler}"
        case WicketType.RUN_OUT:
            return f"run out ({fielder})" if fielder_name else "run out"
        case WicketType.OBSTRUCTING_THE_FIELD:
            return "obstructing the field"
        case WicketType.HIT_BALL_TWICE:
            return "hit the ball twice"
        case WicketType.TIMED_OUT:
            return "timed out"
        case WicketType.RETIRED_OUT:
            return "retired out"
        case WicketType.RETIRED_HURT:
            return "retired hurt"
    return wicket_type.value.replace("_", " ")  # pragma: no cover - exhaustive above


def format_ball(event: DeliveryEvent, runs_total: int) -> str:
    """Compact scorebook token for one delivery, e.g. ``•``, ``4``, ``2wd``, ``W``."""
    extra = event.extra_type
    if extra is ExtraType.WIDE:
        token = f"{runs_total}wd"
    elif extra is ExtraType.NO_BALL:
        scored = event.batter_runs + event.extra_runs
        token = f"nb+{scored}" if scored else "nb"
    elif extra is ExtraType.BYE:
        token = f"{event.extra_runs}b"
    elif extra is ExtraType.LEG_BYE:
        token = f"{event.extra_runs}lb"
    elif extra is ExtraType.PENALTY:
        token = f"+{event.extra_runs}p"
    else:
        token = "•" if event.batter_runs == 0 else str(event.batter_runs)

    if event.is_wicket and event.wicket_type not in NON_DISMISSAL_WICKETS:
        return "W" if token in ("•", "0") else f"{token}+W"
    if event.is_wicket:
        return f"{token}+R" if token not in ("•", "0") else "R"
    return token
