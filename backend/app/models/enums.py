"""Domain enumerations.

These values are part of the public API contract and are persisted as strings,
so they must only ever be *added to*, never renamed.
"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class PlayerRole(StrEnum):
    BATTER = "batter"
    BOWLER = "bowler"
    ALLROUNDER = "allrounder"
    WICKET_KEEPER = "wicket_keeper"
    UNKNOWN = "unknown"


class BattingHand(StrEnum):
    RIGHT = "right"
    LEFT = "left"


class BowlingStyle(StrEnum):
    RIGHT_ARM_FAST = "right_arm_fast"
    RIGHT_ARM_MEDIUM = "right_arm_medium"
    RIGHT_ARM_OFF_SPIN = "right_arm_off_spin"
    RIGHT_ARM_LEG_SPIN = "right_arm_leg_spin"
    LEFT_ARM_FAST = "left_arm_fast"
    LEFT_ARM_MEDIUM = "left_arm_medium"
    LEFT_ARM_ORTHODOX = "left_arm_orthodox"
    LEFT_ARM_CHINAMAN = "left_arm_chinaman"
    UNKNOWN = "unknown"


class MatchFormat(StrEnum):
    T20 = "t20"
    T10 = "t10"
    ODI = "odi"
    TEST = "test"
    BOX = "box"
    TURF = "turf"
    GULLY = "gully"
    TAPE_BALL = "tape_ball"
    TENNIS_BALL = "tennis_ball"
    CUSTOM = "custom"


class MatchStatus(StrEnum):
    SETUP = "setup"
    LIVE = "live"
    INNINGS_BREAK = "innings_break"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class TossDecision(StrEnum):
    BAT = "bat"
    BOWL = "bowl"


class InningsStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class InningsEndReason(StrEnum):
    OVERS_COMPLETE = "overs_complete"
    ALL_OUT = "all_out"
    TARGET_REACHED = "target_reached"
    DECLARED = "declared"
    RAIN = "rain"
    FORFEIT = "forfeit"
    OTHER = "other"


class ExtraType(StrEnum):
    """Kind of extra attached to a delivery.

    ``WIDE`` / ``NO_BALL`` are illegal deliveries (they do not advance the over);
    ``BYE`` / ``LEG_BYE`` happen off a legal delivery; ``PENALTY`` is a 5-run
    award that is not attached to a ball at all.
    """

    WIDE = "wide"
    NO_BALL = "no_ball"
    BYE = "bye"
    LEG_BYE = "leg_bye"
    PENALTY = "penalty"


class WicketType(StrEnum):
    BOWLED = "bowled"
    CAUGHT = "caught"
    CAUGHT_AND_BOWLED = "caught_and_bowled"
    LBW = "lbw"
    STUMPED = "stumped"
    HIT_WICKET = "hit_wicket"
    RUN_OUT = "run_out"
    OBSTRUCTING_THE_FIELD = "obstructing_the_field"
    HIT_BALL_TWICE = "hit_ball_twice"
    TIMED_OUT = "timed_out"
    RETIRED_OUT = "retired_out"
    RETIRED_HURT = "retired_hurt"


#: Dismissals credited to the bowler's wicket column.
BOWLER_CREDITED_WICKETS: frozenset[WicketType] = frozenset(
    {
        WicketType.BOWLED,
        WicketType.CAUGHT,
        WicketType.CAUGHT_AND_BOWLED,
        WicketType.LBW,
        WicketType.STUMPED,
        WicketType.HIT_WICKET,
    }
)

#: ``retired_hurt`` is *not* a dismissal: the batter may resume, and the team's
#: wicket count is unchanged.
NON_DISMISSAL_WICKETS: frozenset[WicketType] = frozenset({WicketType.RETIRED_HURT})

#: Dismissals that can legitimately occur on a no-ball or wide.
WICKETS_ALLOWED_ON_NO_BALL: frozenset[WicketType] = frozenset(
    {
        WicketType.RUN_OUT,
        WicketType.OBSTRUCTING_THE_FIELD,
        WicketType.HIT_BALL_TWICE,
        WicketType.RETIRED_OUT,
        WicketType.RETIRED_HURT,
    }
)
WICKETS_ALLOWED_ON_WIDE: frozenset[WicketType] = frozenset(
    {
        WicketType.RUN_OUT,
        WicketType.STUMPED,
        WicketType.HIT_WICKET,
        WicketType.OBSTRUCTING_THE_FIELD,
        WicketType.RETIRED_OUT,
        WicketType.RETIRED_HURT,
    }
)


class MatchResultType(StrEnum):
    WIN = "win"
    TIE = "tie"
    DRAW = "draw"
    NO_RESULT = "no_result"
    ABANDONED = "abandoned"
    FORFEIT = "forfeit"
    SUPER_OVER = "super_over"


class TournamentFormat(StrEnum):
    LEAGUE = "league"
    GROUP_KNOCKOUT = "group_knockout"
    KNOCKOUT = "knockout"


class TournamentStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class BracketRound(StrEnum):
    ROUND_OF_16 = "round_of_16"
    QUARTER_FINAL = "quarter_final"
    SEMI_FINAL = "semi_final"
    THIRD_PLACE = "third_place"
    FINAL = "final"


class CollaboratorRole(StrEnum):
    OWNER = "owner"
    SCORER = "scorer"
    VIEWER = "viewer"


class AwardKind(StrEnum):
    TROPHY = "trophy"
    CERTIFICATE = "certificate"
    ACHIEVEMENT = "achievement"


class TeamMembershipRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    COACH = "coach"
    CAPTAIN = "captain"
    VICE_CAPTAIN = "vice_captain"
    PLAYER = "player"


#: Alias used by older slice drafts — prefer TeamMembershipRole.
TeamMemberRole = TeamMembershipRole


#: Roles that may manage roster, awards, and membership invites.
TEAM_MANAGE_ROLES: frozenset[TeamMembershipRole] = frozenset(
    {TeamMembershipRole.OWNER, TeamMembershipRole.MANAGER}
)


class MembershipStatus(StrEnum):
    ACTIVE = "active"
    INVITED = "invited"
    REQUESTED = "requested"
    REJECTED = "rejected"
    LEFT = "left"


#: Alias used by older slice drafts — prefer MembershipStatus.
TeamMembershipStatus = MembershipStatus


class StreamSessionStatus(StrEnum):
    IDLE = "idle"
    PREVIEW = "preview"
    LIVE = "live"
    ENDED = "ended"
    ERROR = "error"


class AuditAction(StrEnum):
    USER_REGISTERED = "user.registered"
    USER_LOGIN = "user.login"
    USER_LOGIN_FAILED = "user.login_failed"
    USER_LOGOUT = "user.logout"
    USER_PASSWORD_CHANGED = "user.password_changed"
    TOKEN_REUSE_DETECTED = "auth.token_reuse_detected"
    MATCH_CREATED = "match.created"
    MATCH_UPDATED = "match.updated"
    MATCH_DELETED = "match.deleted"
    MATCH_COMPLETED = "match.completed"
    DELIVERY_RECORDED = "delivery.recorded"
    DELIVERY_EDITED = "delivery.edited"
    DELIVERY_DELETED = "delivery.deleted"
    INNINGS_STARTED = "innings.started"
    INNINGS_CLOSED = "innings.closed"
    CREASE_UPDATED = "crease.updated"
    TOURNAMENT_CREATED = "tournament.created"
    TOURNAMENT_UPDATED = "tournament.updated"
