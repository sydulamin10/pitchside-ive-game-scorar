"""ORM model registry.

Importing this package registers every mapper on ``Base.metadata``, which is what
Alembic autogenerate relies on. Import models from here, not from the individual
modules, so the registry is always complete.
"""

from app.db.base import Base
from app.models.account import (
    CouponRequest,
    SiteContent,
    SupportRequest,
    TutorialVideo,
    WalletAccount,
    WalletTopup,
    WalletTransaction,
)
from app.models.audit import AuditLog
from app.models.awards import PlayerAward
from app.models.billing import Coupon, LiveUsage, Payment
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
from app.models.setting import AppSetting
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
    "AppSetting",
    "AuditLog",
    "Base",
    "Coupon",
    "CouponRequest",
    "LiveUsage",
    "Payment",
    "SiteContent",
    "SupportRequest",
    "TutorialVideo",
    "WalletAccount",
    "WalletTopup",
    "WalletTransaction",
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
