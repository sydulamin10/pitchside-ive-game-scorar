"""ORM model registry.

Importing this package registers every mapper on ``Base.metadata``, which is what
Alembic autogenerate relies on. Import models from here, not from the individual
modules, so the registry is always complete.
"""

from app.db.base import Base
from app.models.audit import AuditLog
from app.models.awards import PlayerAward
from app.models.match import (
    Delivery,
    DeliveryRevision,
    Innings,
    InningsSummary,
    Match,
    MatchCollaborator,
    MatchPlayer,
)
from app.models.membership import TeamMembership
from app.models.stream import StreamSession
from app.models.team import Player, Team
from app.models.tournament import (
    BracketMatch,
    Tournament,
    TournamentGroup,
    TournamentStandingSnapshot,
    TournamentTeam,
)
from app.models.user import RefreshToken, User

__all__ = [
    "AuditLog",
    "Base",
    "BracketMatch",
    "Delivery",
    "DeliveryRevision",
    "Innings",
    "InningsSummary",
    "Match",
    "MatchCollaborator",
    "MatchPlayer",
    "Player",
    "PlayerAward",
    "RefreshToken",
    "StreamSession",
    "Team",
    "TeamMembership",
    "Tournament",
    "TournamentGroup",
    "TournamentStandingSnapshot",
    "TournamentTeam",
    "User",
]
