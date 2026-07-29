"""Points table and Net Run Rate.

    NRR = (runs scored / overs faced) − (runs conceded / overs bowled)

aggregated across every completed match a team played in the tournament.

Two details that are easy to get wrong and are handled explicitly here:

* A side **bowled out** is charged its full quota of overs, not the overs it
  actually used. Otherwise being dismissed for 40 in 8 overs would *help* a
  team's run rate.
* Abandoned / no-result matches contribute **points but not run-rate data**,
  because there is no meaningful rate to aggregate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class PointsConfig:
    win: int = 2
    tie: int = 1
    loss: int = 0
    no_result: int = 1
    use_net_run_rate: bool = True


@dataclass(frozen=True, slots=True)
class TeamMatchRecord:
    """One team's contribution from one completed match."""

    team_id: str
    match_id: str
    outcome: str  # win | loss | tie | no_result
    runs_scored: int = 0
    overs_faced: float = 0.0
    runs_conceded: int = 0
    overs_bowled: float = 0.0
    counts_for_run_rate: bool = True


@dataclass(slots=True)
class StandingRow:
    team_id: str
    team_name: str = ""
    group_id: str | None = None
    group_name: str | None = None
    played: int = 0
    won: int = 0
    lost: int = 0
    tied: int = 0
    no_result: int = 0
    points: int = 0
    runs_scored: int = 0
    overs_faced: float = 0.0
    runs_conceded: int = 0
    overs_bowled: float = 0.0
    points_adjustment: int = 0
    position: int = 0
    form: list[str] = field(default_factory=list)

    @property
    def net_run_rate(self) -> float:
        scored_rate = self.runs_scored / self.overs_faced if self.overs_faced > 0 else 0.0
        conceded_rate = self.runs_conceded / self.overs_bowled if self.overs_bowled > 0 else 0.0
        if self.overs_faced <= 0 and self.overs_bowled <= 0:
            return 0.0
        return round(scored_rate - conceded_rate, 3)

    @property
    def run_rate_for(self) -> float:
        return round(self.runs_scored / self.overs_faced, 3) if self.overs_faced > 0 else 0.0

    @property
    def run_rate_against(self) -> float:
        return round(self.runs_conceded / self.overs_bowled, 3) if self.overs_bowled > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "team_id": self.team_id,
            "team_name": self.team_name,
            "group_id": self.group_id,
            "group_name": self.group_name,
            "position": self.position,
            "played": self.played,
            "won": self.won,
            "lost": self.lost,
            "tied": self.tied,
            "no_result": self.no_result,
            "points": self.points,
            "points_adjustment": self.points_adjustment,
            "runs_scored": self.runs_scored,
            "overs_faced": round(self.overs_faced, 3),
            "runs_conceded": self.runs_conceded,
            "overs_bowled": round(self.overs_bowled, 3),
            "run_rate_for": self.run_rate_for,
            "run_rate_against": self.run_rate_against,
            "net_run_rate": self.net_run_rate,
            "form": self.form[-5:],
        }


def compute_standings(
    records: list[TeamMatchRecord],
    *,
    config: PointsConfig,
    team_names: dict[str, str] | None = None,
    team_groups: dict[str, tuple[str | None, str | None]] | None = None,
    points_adjustments: dict[str, int] | None = None,
) -> list[StandingRow]:
    """Aggregate per-match records into a sorted points table.

    Teams are ranked by points, then Net Run Rate, then wins, then name — the
    convention used by virtually every domestic league.
    """
    names = team_names or {}
    groups = team_groups or {}
    adjustments = points_adjustments or {}

    rows: dict[str, StandingRow] = {}
    for team_id in {r.team_id for r in records} | set(names) | set(groups):
        group_id, group_name = groups.get(team_id, (None, None))
        rows[team_id] = StandingRow(
            team_id=team_id,
            team_name=names.get(team_id, ""),
            group_id=group_id,
            group_name=group_name,
            points_adjustment=adjustments.get(team_id, 0),
        )

    for record in records:
        row = rows.setdefault(record.team_id, StandingRow(team_id=record.team_id))
        row.played += 1
        match record.outcome:
            case "win":
                row.won += 1
                row.points += config.win
                row.form.append("W")
            case "loss":
                row.lost += 1
                row.points += config.loss
                row.form.append("L")
            case "tie":
                row.tied += 1
                row.points += config.tie
                row.form.append("T")
            case _:
                row.no_result += 1
                row.points += config.no_result
                row.form.append("N")
        if record.counts_for_run_rate:
            row.runs_scored += record.runs_scored
            row.overs_faced += record.overs_faced
            row.runs_conceded += record.runs_conceded
            row.overs_bowled += record.overs_bowled

    ordered = sorted(
        rows.values(),
        key=lambda r: (
            -(r.points + r.points_adjustment),
            -(r.net_run_rate if config.use_net_run_rate else 0.0),
            -r.won,
            r.team_name.lower() or r.team_id,
        ),
    )
    for row in ordered:
        row.points += row.points_adjustment
        row.points_adjustment = 0

    # Position is per-group when groups are in play, otherwise overall.
    counters: dict[str | None, int] = {}
    for row in ordered:
        key = row.group_id
        counters[key] = counters.get(key, 0) + 1
        row.position = counters[key]
    return ordered


def qualifiers(standings: list[StandingRow], *, per_group: int) -> list[StandingRow]:
    """Teams advancing to the knockout stage, in seeding order."""
    advancing = [row for row in standings if row.position <= per_group]
    return sorted(
        advancing,
        key=lambda r: (r.position, -(r.points), -r.net_run_rate, r.team_name.lower()),
    )
