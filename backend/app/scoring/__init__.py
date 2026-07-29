"""Pure cricket-scoring domain logic.

Nothing in this package touches the database, the network, or FastAPI. Everything
here is a deterministic function of its inputs, which is what lets us test the
laws of cricket exhaustively and share the exact same fixtures with the
TypeScript port used for offline scoring in the browser.
"""

from app.scoring.engine import (
    ReplayResult,
    StrikeRepair,
    build_innings_state,
    describe_dismissal,
    format_ball,
    replay,
    validate_delivery,
)
from app.scoring.match_state import (
    InningsView,
    MatchOutcome,
    compute_target,
    determine_outcome,
)
from app.scoring.standings import (
    PointsConfig,
    StandingRow,
    TeamMatchRecord,
    compute_standings,
    qualifiers,
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

__all__ = [
    "BallSummary",
    "BatterInnings",
    "BatterStatus",
    "BowlerInnings",
    "DeliveryEvent",
    "Extras",
    "FallOfWicket",
    "InningsRules",
    "InningsState",
    "InningsView",
    "MatchOutcome",
    "NextAction",
    "OverSummary",
    "Partnership",
    "PlayerRef",
    "PointsConfig",
    "ReplayResult",
    "StandingRow",
    "StrikeRepair",
    "TeamMatchRecord",
    "build_innings_state",
    "compute_standings",
    "compute_target",
    "describe_dismissal",
    "determine_outcome",
    "format_ball",
    "qualifiers",
    "replay",
    "validate_delivery",
]
