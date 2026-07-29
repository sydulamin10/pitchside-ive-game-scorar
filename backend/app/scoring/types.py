"""Value types for the scoring engine.

Deliberately free of SQLAlchemy, FastAPI, and database identifiers: the engine
takes plain strings and primitives so it can be unit-tested exhaustively, run in
a worker, or replayed against a JSON fixture with no infrastructure at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.models.enums import ExtraType, InningsEndReason, WicketType

# --------------------------------------------------------------------- inputs


@dataclass(frozen=True, slots=True)
class PlayerRef:
    """A member of the batting or bowling side for one match."""

    id: str
    name: str
    batting_order: int = 0
    is_playing: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "batting_order": self.batting_order,
            "is_playing": self.is_playing,
        }


@dataclass(frozen=True, slots=True)
class InningsRules:
    """Everything the engine needs to know about how this innings is played."""

    balls_per_over: int = 6
    overs_limit: int | None = 20
    players_per_side: int = 11
    max_overs_per_bowler: int | None = None
    wide_penalty_runs: int = 1
    no_ball_penalty_runs: int = 1
    free_hit_after_no_ball: bool = True
    allow_boundaries: bool = True
    #: Some gully/box formats let the final batter continue alone.
    last_batter_can_bat_alone: bool = False
    #: Runs required to win this innings (first-innings total + 1), if chasing.
    target_runs: int | None = None
    #: Runs awarded to the batting side outside of any delivery (e.g. 5 penalty
    #: runs for a fielding infraction recorded at innings level).
    innings_penalty_runs: int = 0
    #: A bowler may not bowl consecutive overs.
    forbid_consecutive_overs: bool = True

    @property
    def max_legal_balls(self) -> int | None:
        if self.overs_limit is None:
            return None
        return self.overs_limit * self.balls_per_over

    @property
    def max_wickets(self) -> int:
        """Wickets that end the innings."""
        if self.last_batter_can_bat_alone:
            return self.players_per_side
        return max(1, self.players_per_side - 1)


@dataclass(frozen=True, slots=True)
class DeliveryEvent:
    """One recorded ball, or a non-ball event such as a 5-run penalty.

    ``batters_crossed`` means *"did the batters finish at opposite ends to where
    they started"* — the parity of every crossing, including an incomplete one
    during a run-out. It is the only reliable primitive for deciding who is on
    strike next, so the UI asks for it whenever runs alone can't imply it
    (catches, run-outs, boundary wides).
    """

    id: str
    sequence: int
    striker_id: str
    non_striker_id: str
    bowler_id: str
    batter_runs: int = 0
    extra_type: ExtraType | None = None
    extra_runs: int = 0
    is_boundary: bool = False
    batters_crossed: bool | None = None
    is_wicket: bool = False
    wicket_type: WicketType | None = None
    dismissed_player_id: str | None = None
    fielder_id: str | None = None
    replacement_batter_id: str | None = None
    commentary: str | None = None

    # ---------------------------------------------------------- derived facts
    @property
    def is_legal(self) -> bool:
        """Does this delivery advance the over count?"""
        return self.extra_type not in (ExtraType.WIDE, ExtraType.NO_BALL, ExtraType.PENALTY)

    @property
    def is_ball_faced(self) -> bool:
        """A wide is not a ball faced; a no-ball is."""
        return self.extra_type not in (ExtraType.WIDE, ExtraType.PENALTY)

    @property
    def is_ball_event(self) -> bool:
        """False only for innings-level penalty awards."""
        return self.extra_type is not ExtraType.PENALTY


class NextAction(StrEnum):
    """What the scoring UI must collect before the next ball can be recorded."""

    SELECT_OPENERS = "select_openers"
    SELECT_BOWLER = "select_bowler"
    SELECT_BATTER = "select_batter"
    RECORD_DELIVERY = "record_delivery"
    INNINGS_COMPLETE = "innings_complete"


class BatterStatus(StrEnum):
    NOT_OUT = "not_out"
    OUT = "out"
    RETIRED_HURT = "retired_hurt"
    DID_NOT_BAT = "did_not_bat"


# -------------------------------------------------------------------- outputs


@dataclass(slots=True)
class BatterInnings:
    player_id: str
    name: str
    batting_position: int = 0
    runs: int = 0
    balls_faced: int = 0
    fours: int = 0
    sixes: int = 0
    dots: int = 0
    status: BatterStatus = BatterStatus.DID_NOT_BAT
    wicket_type: WicketType | None = None
    dismissed_by_bowler_id: str | None = None
    dismissed_by_bowler_name: str | None = None
    fielder_id: str | None = None
    fielder_name: str | None = None
    dismissal_text: str | None = None
    is_striker: bool = False
    is_non_striker: bool = False

    @property
    def strike_rate(self) -> float:
        if self.balls_faced == 0:
            return 0.0
        return round(self.runs * 100 / self.balls_faced, 2)

    @property
    def is_out(self) -> bool:
        return self.status is BatterStatus.OUT

    @property
    def has_batted(self) -> bool:
        return self.status is not BatterStatus.DID_NOT_BAT

    def to_dict(self) -> dict[str, Any]:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "batting_position": self.batting_position,
            "runs": self.runs,
            "balls_faced": self.balls_faced,
            "fours": self.fours,
            "sixes": self.sixes,
            "dots": self.dots,
            "strike_rate": self.strike_rate,
            "status": self.status.value,
            "is_out": self.is_out,
            "has_batted": self.has_batted,
            "wicket_type": self.wicket_type.value if self.wicket_type else None,
            "dismissal_text": self.dismissal_text,
            "dismissed_by_bowler_id": self.dismissed_by_bowler_id,
            "fielder_id": self.fielder_id,
            "is_striker": self.is_striker,
            "is_non_striker": self.is_non_striker,
        }


@dataclass(slots=True)
class BowlerInnings:
    player_id: str
    name: str
    balls_bowled: int = 0
    runs_conceded: int = 0
    wickets: int = 0
    maidens: int = 0
    wides: int = 0
    no_balls: int = 0
    dots: int = 0
    fours_conceded: int = 0
    sixes_conceded: int = 0
    is_current_bowler: bool = False
    balls_per_over: int = 6

    @property
    def overs_text(self) -> str:
        completed, remainder = divmod(self.balls_bowled, self.balls_per_over)
        return f"{completed}.{remainder}"

    @property
    def overs_decimal(self) -> float:
        return round(self.balls_bowled / self.balls_per_over, 3)

    @property
    def economy(self) -> float:
        if self.balls_bowled == 0:
            return 0.0
        return round(self.runs_conceded * self.balls_per_over / self.balls_bowled, 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "balls_bowled": self.balls_bowled,
            "overs_text": self.overs_text,
            "overs_decimal": self.overs_decimal,
            "runs_conceded": self.runs_conceded,
            "wickets": self.wickets,
            "maidens": self.maidens,
            "wides": self.wides,
            "no_balls": self.no_balls,
            "dots": self.dots,
            "fours_conceded": self.fours_conceded,
            "sixes_conceded": self.sixes_conceded,
            "economy": self.economy,
            "is_current_bowler": self.is_current_bowler,
        }


@dataclass(slots=True)
class Partnership:
    wicket_number: int
    batter_a_id: str
    batter_a_name: str
    batter_b_id: str | None
    batter_b_name: str | None
    runs: int = 0
    balls: int = 0
    batter_a_runs: int = 0
    batter_b_runs: int = 0
    is_current: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "wicket_number": self.wicket_number,
            "batter_a_id": self.batter_a_id,
            "batter_a_name": self.batter_a_name,
            "batter_a_runs": self.batter_a_runs,
            "batter_b_id": self.batter_b_id,
            "batter_b_name": self.batter_b_name,
            "batter_b_runs": self.batter_b_runs,
            "runs": self.runs,
            "balls": self.balls,
            "is_current": self.is_current,
        }


@dataclass(frozen=True, slots=True)
class FallOfWicket:
    wicket_number: int
    runs_at_fall: int
    overs_text: str
    batter_id: str
    batter_name: str
    dismissal_text: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "wicket_number": self.wicket_number,
            "runs_at_fall": self.runs_at_fall,
            "overs_text": self.overs_text,
            "batter_id": self.batter_id,
            "batter_name": self.batter_name,
            "dismissal_text": self.dismissal_text,
        }


@dataclass(slots=True)
class Extras:
    wide: int = 0
    no_ball: int = 0
    bye: int = 0
    leg_bye: int = 0
    penalty: int = 0

    @property
    def total(self) -> int:
        return self.wide + self.no_ball + self.bye + self.leg_bye + self.penalty

    def to_dict(self) -> dict[str, Any]:
        return {
            "wide": self.wide,
            "no_ball": self.no_ball,
            "bye": self.bye,
            "leg_bye": self.leg_bye,
            "penalty": self.penalty,
            "total": self.total,
        }


@dataclass(slots=True)
class BallSummary:
    """One entry in the ball-by-ball timeline, ready for display."""

    delivery_id: str
    sequence: int
    over_number: int
    ball_in_over: int
    display: str
    over_ball_text: str
    runs_total: int
    batter_runs: int
    extra_type: str | None
    extra_runs: int
    is_wicket: bool
    is_legal: bool
    is_free_hit: bool
    striker_id: str
    striker_name: str
    bowler_id: str
    bowler_name: str
    commentary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "delivery_id": self.delivery_id,
            "sequence": self.sequence,
            "over_number": self.over_number,
            "ball_in_over": self.ball_in_over,
            "over_ball_text": self.over_ball_text,
            "display": self.display,
            "runs_total": self.runs_total,
            "batter_runs": self.batter_runs,
            "extra_type": self.extra_type,
            "extra_runs": self.extra_runs,
            "is_wicket": self.is_wicket,
            "is_legal": self.is_legal,
            "is_free_hit": self.is_free_hit,
            "striker_id": self.striker_id,
            "striker_name": self.striker_name,
            "bowler_id": self.bowler_id,
            "bowler_name": self.bowler_name,
            "commentary": self.commentary,
        }


@dataclass(slots=True)
class OverSummary:
    over_number: int
    bowler_id: str
    bowler_name: str
    runs: int = 0
    wickets: int = 0
    is_maiden: bool = False
    is_complete: bool = False
    balls: list[BallSummary] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "over_number": self.over_number,
            "bowler_id": self.bowler_id,
            "bowler_name": self.bowler_name,
            "runs": self.runs,
            "wickets": self.wickets,
            "is_maiden": self.is_maiden,
            "is_complete": self.is_complete,
            "balls": [b.to_dict() for b in self.balls],
        }


@dataclass(slots=True)
class InningsState:
    """The complete derived state of one innings."""

    total_runs: int = 0
    wickets: int = 0
    legal_balls: int = 0
    balls_per_over: int = 6
    extras: Extras = field(default_factory=Extras)
    batting: list[BatterInnings] = field(default_factory=list)
    bowling: list[BowlerInnings] = field(default_factory=list)
    partnerships: list[Partnership] = field(default_factory=list)
    fall_of_wickets: list[FallOfWicket] = field(default_factory=list)
    overs: list[OverSummary] = field(default_factory=list)
    timeline: list[BallSummary] = field(default_factory=list)

    striker_id: str | None = None
    non_striker_id: str | None = None
    current_bowler_id: str | None = None
    previous_over_bowler_id: str | None = None
    is_free_hit: bool = False

    next_action: NextAction = NextAction.SELECT_OPENERS
    is_complete: bool = False
    end_reason: InningsEndReason | None = None

    target_runs: int | None = None
    overs_limit: int | None = None
    max_wickets: int = 10
    available_batter_ids: list[str] = field(default_factory=list)
    #: Bowlers who have reached their over quota, or bowled the previous over.
    ineligible_bowler_ids: list[str] = field(default_factory=list)
    #: Non-fatal inconsistencies found while replaying an edited log.
    warnings: list[str] = field(default_factory=list)

    # ------------------------------------------------------------ derivations
    @property
    def overs_text(self) -> str:
        completed, remainder = divmod(self.legal_balls, self.balls_per_over)
        return f"{completed}.{remainder}"

    @property
    def overs_decimal(self) -> float:
        return round(self.legal_balls / self.balls_per_over, 3)

    @property
    def run_rate(self) -> float:
        if self.legal_balls == 0:
            return 0.0
        return round(self.total_runs * self.balls_per_over / self.legal_balls, 2)

    @property
    def balls_remaining(self) -> int | None:
        if self.overs_limit is None:
            return None
        return max(0, self.overs_limit * self.balls_per_over - self.legal_balls)

    @property
    def wickets_remaining(self) -> int:
        return max(0, self.max_wickets - self.wickets)

    @property
    def runs_needed(self) -> int | None:
        if self.target_runs is None:
            return None
        return max(0, self.target_runs - self.total_runs)

    @property
    def required_run_rate(self) -> float | None:
        needed = self.runs_needed
        remaining = self.balls_remaining
        if needed is None or remaining is None or remaining <= 0 or needed <= 0:
            return None
        return round(needed * self.balls_per_over / remaining, 2)

    @property
    def projected_score(self) -> int | None:
        """Score if the current run rate holds for the remaining overs."""
        if self.overs_limit is None or self.legal_balls == 0:
            return None
        total_balls = self.overs_limit * self.balls_per_over
        return int(round(self.total_runs * total_balls / self.legal_balls))

    @property
    def is_all_out(self) -> bool:
        return self.wickets >= self.max_wickets

    @property
    def current_partnership(self) -> Partnership | None:
        for partnership in reversed(self.partnerships):
            if partnership.is_current:
                return partnership
        return None

    @property
    def last_over(self) -> OverSummary | None:
        return self.overs[-1] if self.overs else None

    def batter(self, player_id: str) -> BatterInnings | None:
        return next((b for b in self.batting if b.player_id == player_id), None)

    def bowler(self, player_id: str) -> BowlerInnings | None:
        return next((b for b in self.bowling if b.player_id == player_id), None)

    def nrr_overs(self) -> float:
        """Overs charged for Net Run Rate.

        A side that is bowled out is charged its **full quota** of overs, not the
        overs it actually used — the standard ICC treatment.
        """
        if self.is_all_out and self.overs_limit is not None:
            return float(self.overs_limit)
        return self.overs_decimal

    def to_dict(self, *, include_timeline: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "total_runs": self.total_runs,
            "wickets": self.wickets,
            "legal_balls": self.legal_balls,
            "balls_per_over": self.balls_per_over,
            "overs_text": self.overs_text,
            "overs_decimal": self.overs_decimal,
            "run_rate": self.run_rate,
            "required_run_rate": self.required_run_rate,
            "projected_score": self.projected_score,
            "balls_remaining": self.balls_remaining,
            "wickets_remaining": self.wickets_remaining,
            "runs_needed": self.runs_needed,
            "target_runs": self.target_runs,
            "overs_limit": self.overs_limit,
            "max_wickets": self.max_wickets,
            "is_all_out": self.is_all_out,
            "is_complete": self.is_complete,
            "end_reason": self.end_reason.value if self.end_reason else None,
            "next_action": self.next_action.value,
            "is_free_hit": self.is_free_hit,
            "striker_id": self.striker_id,
            "non_striker_id": self.non_striker_id,
            "current_bowler_id": self.current_bowler_id,
            "previous_over_bowler_id": self.previous_over_bowler_id,
            "extras": self.extras.to_dict(),
            "batting": [b.to_dict() for b in self.batting],
            "bowling": [b.to_dict() for b in self.bowling],
            "partnerships": [p.to_dict() for p in self.partnerships],
            "current_partnership": (
                self.current_partnership.to_dict() if self.current_partnership else None
            ),
            "fall_of_wickets": [f.to_dict() for f in self.fall_of_wickets],
            "available_batter_ids": self.available_batter_ids,
            "ineligible_bowler_ids": self.ineligible_bowler_ids,
            "warnings": self.warnings,
        }
        if include_timeline:
            payload["overs"] = [o.to_dict() for o in self.overs]
            payload["timeline"] = [b.to_dict() for b in self.timeline]
        else:
            payload["recent_balls"] = [b.to_dict() for b in self.timeline[-12:]]
            payload["overs"] = [o.to_dict() for o in self.overs[-2:]]
        return payload
