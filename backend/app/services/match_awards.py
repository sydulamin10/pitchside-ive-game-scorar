"""Derive match awards / MVP ratings from a completed MatchSnapshot.

Delivery log remains source of truth — this is a pure projection over batting,
bowling and fielding figures already computed by the scoring engine.
"""

from __future__ import annotations

from typing import Any

from app.services.match_query import MatchSnapshot

# Weights for a simple 0–10 style MVP score (documented for UI copy).
_W_RUNS = 0.04
_W_SR = 0.01
_W_WICKETS = 1.2
_W_ECONOMY_INV = 0.15  # lower economy → higher via (12 - econ)
_W_CATCH = 0.8
_W_STUMP = 1.0
_W_RUNOUT = 0.7


def compute_match_awards(snapshot: MatchSnapshot) -> dict[str, Any]:
    """Best batter / bowler / fielder, MOTM, and per-player MVP ratings."""
    batting_agg: dict[str, dict[str, Any]] = {}
    bowling_agg: dict[str, dict[str, Any]] = {}
    fielding_agg: dict[str, dict[str, Any]] = {}
    names: dict[str, str] = {}
    photos: dict[str, str | None] = {}
    teams: dict[str, str] = {}

    for members in snapshot.squads.values():
        for member in members:
            mid = str(member.id)
            names[mid] = member.name
            photos[mid] = member.player.photo_url if member.player is not None else None
            teams[mid] = str(member.team_id)

    for inn in snapshot.innings:
        state = inn.state
        for batter in state.batting:
            pid = batter.player_id
            row = batting_agg.setdefault(
                pid,
                {
                    "player_id": pid,
                    "name": batter.name,
                    "runs": 0,
                    "balls": 0,
                    "fours": 0,
                    "sixes": 0,
                    "dismissals": 0,
                },
            )
            row["runs"] += batter.runs
            row["balls"] += batter.balls_faced
            row["fours"] += batter.fours
            row["sixes"] += batter.sixes
            if batter.is_out:
                row["dismissals"] += 1
            names[pid] = batter.name

            if batter.fielder_id:
                fid = batter.fielder_id
                frow = fielding_agg.setdefault(
                    fid,
                    {
                        "player_id": fid,
                        "name": batter.fielder_name or names.get(fid, "—"),
                        "catches": 0,
                        "stumpings": 0,
                        "run_outs": 0,
                    },
                )
                wt = batter.wicket_type.value if batter.wicket_type else ""
                if "stump" in wt:
                    frow["stumpings"] += 1
                elif "run_out" in wt:
                    frow["run_outs"] += 1
                elif "caught" in wt:
                    frow["catches"] += 1
                if batter.fielder_name:
                    names[fid] = batter.fielder_name

        for bowler in state.bowling:
            pid = bowler.player_id
            row = bowling_agg.setdefault(
                pid,
                {
                    "player_id": pid,
                    "name": bowler.name,
                    "wickets": 0,
                    "runs": 0,
                    "balls": 0,
                    "maidens": 0,
                },
            )
            row["wickets"] += bowler.wickets
            row["runs"] += bowler.runs_conceded
            row["balls"] += bowler.balls_bowled
            row["maidens"] += bowler.maidens
            names[pid] = bowler.name

    def bat_score(row: dict[str, Any]) -> float:
        sr = (row["runs"] / row["balls"] * 100) if row["balls"] else 0.0
        return row["runs"] * _W_RUNS + sr * _W_SR + row["sixes"] * 0.15 + row["fours"] * 0.05

    def bowl_score(row: dict[str, Any]) -> float:
        overs = row["balls"] / 6 if row["balls"] else 0
        econ = (row["runs"] / overs) if overs else 99.0
        return row["wickets"] * _W_WICKETS + max(0.0, 12.0 - econ) * _W_ECONOMY_INV

    def field_score(row: dict[str, Any]) -> float:
        return (
            row["catches"] * _W_CATCH
            + row["stumpings"] * _W_STUMP
            + row["run_outs"] * _W_RUNOUT
        )

    best_batter = max(batting_agg.values(), key=bat_score, default=None)
    best_bowler = max(bowling_agg.values(), key=bowl_score, default=None)
    best_fielder = max(fielding_agg.values(), key=field_score, default=None)

    mvp_rows: list[dict[str, Any]] = []
    all_ids = set(batting_agg) | set(bowling_agg) | set(fielding_agg)
    for pid in all_ids:
        bat = batting_agg.get(pid, {"runs": 0, "balls": 0, "fours": 0, "sixes": 0})
        bowl = bowling_agg.get(pid, {"wickets": 0, "runs": 0, "balls": 0, "maidens": 0})
        field = fielding_agg.get(pid, {"catches": 0, "stumpings": 0, "run_outs": 0})
        raw = bat_score(bat) + bowl_score(bowl) + field_score(field)
        mvp_rows.append(
            {
                "player_id": pid,
                "name": names.get(pid, "—"),
                "photo_url": photos.get(pid),
                "team_id": teams.get(pid),
                "rating": round(min(10.0, raw), 1),
                "batting": {
                    "runs": bat.get("runs", 0),
                    "balls": bat.get("balls", 0),
                    "fours": bat.get("fours", 0),
                    "sixes": bat.get("sixes", 0),
                },
                "bowling": {
                    "wickets": bowl.get("wickets", 0),
                    "runs": bowl.get("runs", 0),
                    "balls": bowl.get("balls", 0),
                },
                "fielding": {
                    "catches": field.get("catches", 0),
                    "stumpings": field.get("stumpings", 0),
                    "run_outs": field.get("run_outs", 0),
                },
            }
        )
    mvp_rows.sort(key=lambda r: r["rating"], reverse=True)

    motm = mvp_rows[0] if mvp_rows else None

    def _pick(row: dict[str, Any] | None, kind: str) -> dict[str, Any] | None:
        if row is None:
            return None
        out = {
            "player_id": row["player_id"],
            "name": row.get("name") or names.get(row["player_id"], "—"),
            "photo_url": photos.get(row["player_id"]),
            "kind": kind,
        }
        if kind == "batter":
            out["stat"] = f"{row['runs']} ({row['balls']})"
        elif kind == "bowler":
            out["stat"] = f"{row['wickets']}/{row['runs']}"
        else:
            out["stat"] = (
                f"{row.get('catches', 0)}c "
                f"{row.get('stumpings', 0)}st "
                f"{row.get('run_outs', 0)}ro"
            )
        return out

    return {
        "result_summary": snapshot.match.result_summary or snapshot.outcome.summary,
        "man_of_the_match": motm,
        "best_batter": _pick(best_batter, "batter"),
        "best_bowler": _pick(best_bowler, "bowler"),
        "best_fielder": _pick(best_fielder, "fielder"),
        "mvp_ratings": mvp_rows[:22],
        "innings": [
            {
                "sequence": s.innings.sequence,
                "batting_team": s.batting_team.name,
                "bowling_team": s.bowling_team.name,
                "score": f"{s.state.total_runs}/{s.state.wickets}",
                "overs_text": s.state.overs_text,
                "overs": [
                    {"over_number": o.over_number, "runs": o.runs, "wickets": o.wickets}
                    for o in s.state.overs
                ],
            }
            for s in snapshot.innings
        ],
    }
