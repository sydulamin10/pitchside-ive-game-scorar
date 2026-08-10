"""Career batting / bowling / fielding derived from the delivery log.

Nothing here is stored as a counter — every figure is recomputed from MatchPlayer
+ Delivery (+ Innings + Match). Results are cached briefly in Redis.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import BOWLER_CREDITED_WICKETS, ExtraType, NON_DISMISSAL_WICKETS, WicketType
from app.models.match import Delivery, Innings, Match, MatchPlayer
from app.services import state_cache

CAREER_CACHE_TTL_SECONDS = 60
DEFAULT_LAST_N = 10
DEFAULT_WIDE_PENALTY = 1
DEFAULT_NO_BALL_PENALTY = 1


@dataclass
class _BatBucket:
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    dismissals: int = 0
    innings_ids: set[str] = field(default_factory=set)


@dataclass
class _BowlBucket:
    balls: int = 0
    runs: int = 0
    wickets: int = 0
    dots: int = 0
    wides: int = 0
    no_balls: int = 0
    maidens: int = 0
    over_runs: int = 0
    over_legal: int = 0


@dataclass
class _FieldBucket:
    catches: int = 0
    stumpings: int = 0
    run_outs: int = 0


def _is_ball_faced(extra: ExtraType | None) -> bool:
    return extra not in (ExtraType.WIDE, ExtraType.PENALTY)


def _is_legal(extra: ExtraType | None) -> bool:
    return extra not in (ExtraType.WIDE, ExtraType.NO_BALL, ExtraType.PENALTY)


def _bowler_charge(delivery: Delivery) -> int:
    extra = delivery.extra_type
    if extra is ExtraType.WIDE:
        return DEFAULT_WIDE_PENALTY + delivery.extra_runs
    if extra is ExtraType.NO_BALL:
        return DEFAULT_NO_BALL_PENALTY + delivery.extra_runs + delivery.batter_runs
    if extra in (ExtraType.BYE, ExtraType.LEG_BYE, ExtraType.PENALTY):
        return 0
    return delivery.batter_runs


def _is_boundary_four_or_six(delivery: Delivery) -> tuple[bool, bool]:
    if delivery.extra_type not in (None, ExtraType.NO_BALL):
        return False, False
    runs = delivery.batter_runs
    if delivery.is_boundary or runs in (4, 6):
        return runs == 4, runs == 6
    return False, False


def aggregate_from_deliveries(
    *,
    match_player_ids: set[uuid.UUID],
    deliveries: list[Delivery],
    innings_by_id: dict[uuid.UUID, Innings],
    matches_by_id: dict[uuid.UUID, Match],
    last_n: int = DEFAULT_LAST_N,
) -> dict[str, Any]:
    """Pure aggregation — safe to unit-test without a database."""
    by_match_bat: dict[uuid.UUID, _BatBucket] = defaultdict(_BatBucket)
    by_match_bowl: dict[uuid.UUID, _BowlBucket] = defaultdict(_BowlBucket)
    by_match_field: dict[uuid.UUID, _FieldBucket] = defaultdict(_FieldBucket)

    career_bat = _BatBucket()
    career_bowl = _BowlBucket()
    career_field = _FieldBucket()

    # Track maiden overs per (match, bowler-over) via legal-ball counters.
    over_keys: dict[tuple[uuid.UUID, uuid.UUID], tuple[int, int]] = {}

    for delivery in deliveries:
        innings = innings_by_id.get(delivery.innings_id)
        if innings is None:
            continue
        match_id = innings.match_id

        if delivery.striker_id in match_player_ids:
            bat = by_match_bat[match_id]
            bat.innings_ids.add(str(delivery.innings_id))
            if _is_ball_faced(delivery.extra_type):
                bat.balls += 1
                career_bat.balls += 1
            bat.runs += delivery.batter_runs
            career_bat.runs += delivery.batter_runs
            is_four, is_six = _is_boundary_four_or_six(delivery)
            if is_four:
                bat.fours += 1
                career_bat.fours += 1
            if is_six:
                bat.sixes += 1
                career_bat.sixes += 1
            career_bat.innings_ids.add(str(delivery.innings_id))

        if (
            delivery.is_wicket
            and delivery.dismissed_player_id in match_player_ids
            and delivery.wicket_type is not None
            and delivery.wicket_type not in NON_DISMISSAL_WICKETS
        ):
            by_match_bat[match_id].dismissals += 1
            career_bat.dismissals += 1
            by_match_bat[match_id].innings_ids.add(str(delivery.innings_id))
            career_bat.innings_ids.add(str(delivery.innings_id))

        if delivery.bowler_id in match_player_ids and delivery.extra_type is not ExtraType.PENALTY:
            bowl = by_match_bowl[match_id]
            charge = _bowler_charge(delivery)
            bowl.runs += charge
            career_bowl.runs += charge
            if delivery.extra_type is ExtraType.WIDE:
                bowl.wides += 1
                career_bowl.wides += 1
            elif delivery.extra_type is ExtraType.NO_BALL:
                bowl.no_balls += 1
                career_bowl.no_balls += 1
            if _is_legal(delivery.extra_type):
                bowl.balls += 1
                career_bowl.balls += 1
                if charge == 0 and delivery.batter_runs == 0:
                    bowl.dots += 1
                    career_bowl.dots += 1
                key = (match_id, delivery.bowler_id)
                overs_so_far, runs_so_far = over_keys.get(key, (0, 0))
                # Approximate maiden: every balls_per_over=6 legal balls.
                new_legal = overs_so_far + 1
                new_runs = runs_so_far + charge
                if new_legal % 6 == 0:
                    if new_runs == 0:
                        bowl.maidens += 1
                        career_bowl.maidens += 1
                    over_keys[key] = (0, 0)
                else:
                    over_keys[key] = (new_legal, new_runs)
            if (
                delivery.is_wicket
                and delivery.wicket_type in BOWLER_CREDITED_WICKETS
            ):
                bowl.wickets += 1
                career_bowl.wickets += 1

        if delivery.fielder_id in match_player_ids and delivery.is_wicket:
            field = by_match_field[match_id]
            if delivery.wicket_type in (WicketType.CAUGHT, WicketType.CAUGHT_AND_BOWLED):
                field.catches += 1
                career_field.catches += 1
            elif delivery.wicket_type is WicketType.STUMPED:
                field.stumpings += 1
                career_field.stumpings += 1
            elif delivery.wicket_type is WicketType.RUN_OUT:
                field.run_outs += 1
                career_field.run_outs += 1

    dismissals = career_bat.dismissals
    innings_count = len(career_bat.innings_ids)
    not_outs = max(0, innings_count - dismissals)
    average = round(career_bat.runs / dismissals, 2) if dismissals else None
    strike_rate = (
        round(career_bat.runs * 100 / career_bat.balls, 2) if career_bat.balls else None
    )
    overs_text = f"{career_bowl.balls // 6}.{career_bowl.balls % 6}"
    economy = (
        round(career_bowl.runs * 6 / career_bowl.balls, 2) if career_bowl.balls else None
    )
    bowling_avg = (
        round(career_bowl.runs / career_bowl.wickets, 2) if career_bowl.wickets else None
    )

    highest = 0
    highest_not_out = False
    fifties = 0
    hundreds = 0
    for bucket in by_match_bat.values():
        not_out = bucket.dismissals == 0
        if bucket.runs > highest or (bucket.runs == highest and not_out and not highest_not_out):
            highest = bucket.runs
            highest_not_out = not_out
        if bucket.runs >= 100:
            hundreds += 1
        elif bucket.runs >= 50:
            fifties += 1

    best_wickets = 0
    best_runs: int | None = None
    for bowl in by_match_bowl.values():
        if bowl.wickets > best_wickets or (
            bowl.wickets == best_wickets and (best_runs is None or bowl.runs < best_runs)
        ):
            best_wickets = bowl.wickets
            best_runs = bowl.runs
    best_figures = f"{best_wickets}/{best_runs}" if best_runs is not None else None

    def _match_sort_key(match_id: uuid.UUID) -> datetime:
        match = matches_by_id.get(match_id)
        if match is None:
            return datetime.min
        return match.completed_at or match.started_at or match.scheduled_at or match.created_at

    recent_ids = sorted(
        set(by_match_bat) | set(by_match_bowl) | set(by_match_field),
        key=_match_sort_key,
        reverse=True,
    )[:last_n]

    recent: list[dict[str, Any]] = []
    for mid in recent_ids:
        match = matches_by_id.get(mid)
        bat = by_match_bat.get(mid, _BatBucket())
        bowl = by_match_bowl.get(mid, _BowlBucket())
        field = by_match_field.get(mid, _FieldBucket())
        recent.append(
            {
                "match_id": str(mid),
                "slug": match.public_slug if match else None,
                "title": match.title if match else None,
                "status": match.status.value if match else None,
                "completed_at": (
                    (match.completed_at or match.started_at or match.created_at)
                    if match
                    else None
                ),
                "batting": {
                    "runs": bat.runs,
                    "balls": bat.balls,
                    "fours": bat.fours,
                    "sixes": bat.sixes,
                    "dismissed": bat.dismissals > 0,
                    "innings": len(bat.innings_ids),
                },
                "bowling": {
                    "balls": bowl.balls,
                    "overs_text": f"{bowl.balls // 6}.{bowl.balls % 6}",
                    "runs": bowl.runs,
                    "wickets": bowl.wickets,
                    "maidens": bowl.maidens,
                },
                "fielding": {
                    "catches": field.catches,
                    "stumpings": field.stumpings,
                    "run_outs": field.run_outs,
                },
            }
        )

    return {
        "batting": {
            "matches": len(by_match_bat),
            "innings": innings_count,
            "runs": career_bat.runs,
            "balls_faced": career_bat.balls,
            "fours": career_bat.fours,
            "sixes": career_bat.sixes,
            "dismissals": dismissals,
            "not_outs": not_outs,
            "highest": highest,
            "highest_not_out": highest_not_out,
            "fifties": fifties,
            "hundreds": hundreds,
            "average": average,
            "strike_rate": strike_rate,
        },
        "bowling": {
            "matches": len(by_match_bowl),
            "balls": career_bowl.balls,
            "overs_text": overs_text,
            "runs_conceded": career_bowl.runs,
            "wickets": career_bowl.wickets,
            "maidens": career_bowl.maidens,
            "wides": career_bowl.wides,
            "no_balls": career_bowl.no_balls,
            "economy": economy,
            "average": bowling_avg,
            "best_figures": best_figures,
        },
        "fielding": {
            "catches": career_field.catches,
            "stumpings": career_field.stumpings,
            "run_outs": career_field.run_outs,
        },
        "recent_matches": recent,
    }


async def compute_career_stats(
    session: AsyncSession,
    player_id: uuid.UUID,
    *,
    last_n: int = DEFAULT_LAST_N,
    use_cache: bool = True,
) -> dict[str, Any]:
    # Redis key shape: pitchside:cache:career:{player_id} (last_n applied after read).
    cache_key = str(player_id)
    cached: dict[str, Any] | None = None
    if use_cache:
        cached = await state_cache.get_json("career", cache_key)
        if cached is not None:
            recent = list(cached.get("recent_matches") or [])[:last_n]
            return {**cached, "recent_matches": recent}

    mp_rows = await session.execute(
        select(MatchPlayer).where(MatchPlayer.player_id == player_id)
    )
    match_players = list(mp_rows.scalars())
    if not match_players:
        payload = {
            "player_id": str(player_id),
            "batting": {
                "matches": 0,
                "innings": 0,
                "runs": 0,
                "balls_faced": 0,
                "fours": 0,
                "sixes": 0,
                "dismissals": 0,
                "not_outs": 0,
                "highest": 0,
                "highest_not_out": False,
                "fifties": 0,
                "hundreds": 0,
                "average": None,
                "strike_rate": None,
            },
            "bowling": {
                "matches": 0,
                "balls": 0,
                "overs_text": "0.0",
                "runs_conceded": 0,
                "wickets": 0,
                "maidens": 0,
                "wides": 0,
                "no_balls": 0,
                "economy": None,
                "average": None,
                "best_figures": None,
            },
            "fielding": {"catches": 0, "stumpings": 0, "run_outs": 0},
            "recent_matches": [],
        }
        if use_cache:
            await state_cache.set_json(
                "career", cache_key, payload, ttl_seconds=CAREER_CACHE_TTL_SECONDS
            )
        return payload

    mp_ids = {mp.id for mp in match_players}
    match_ids = {mp.match_id for mp in match_players}

    deliveries = list(
        (
            await session.execute(
                select(Delivery).where(
                    Delivery.striker_id.in_(mp_ids)
                    | Delivery.bowler_id.in_(mp_ids)
                    | Delivery.dismissed_player_id.in_(mp_ids)
                    | Delivery.fielder_id.in_(mp_ids)
                )
            )
        ).scalars()
    )

    innings_ids = {d.innings_id for d in deliveries}
    innings_rows = list(
        (
            await session.execute(select(Innings).where(Innings.id.in_(innings_ids)))
        ).scalars()
    ) if innings_ids else []
    innings_by_id = {i.id: i for i in innings_rows}

    matches = list(
        (
            await session.execute(
                select(Match)
                .where(Match.id.in_(match_ids), Match.deleted_at.is_(None))
                .options(selectinload(Match.tournament))
            )
        ).scalars()
    )
    matches_by_id = {m.id: m for m in matches}

    stats = aggregate_from_deliveries(
        match_player_ids=mp_ids,
        deliveries=deliveries,
        innings_by_id=innings_by_id,
        matches_by_id=matches_by_id,
        last_n=50,
    )
    payload = {"player_id": str(player_id), **stats}
    if use_cache:
        await state_cache.set_json(
            "career", cache_key, payload, ttl_seconds=CAREER_CACHE_TTL_SECONDS
        )
    recent = list(payload.get("recent_matches") or [])[:last_n]
    return {**payload, "recent_matches": recent}