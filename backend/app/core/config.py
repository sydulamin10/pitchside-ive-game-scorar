"""Application settings.

All configuration is environment-driven (12-factor). Nothing secret is ever
hard-coded; production start-up fails loudly if a required secret is missing or
left at an insecure default.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import (
    AnyHttpUrl,
    BeforeValidator,
    Field,
    PostgresDsn,
    SecretStr,
    ValidationInfo,
    computed_field,
    field_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]

INSECURE_PLACEHOLDERS = {
    "",
    "change-me",
    "changeme",
    "secret",
    "please-change-me",
    "dev-secret-key-do-not-use-in-production",
}


def _split_csv(value: object) -> object:
    """Allow list-valued env vars to be provided as comma-separated strings."""
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):  # JSON array — let pydantic parse it
            return value
        return [item.strip() for item in stripped.split(",") if item.strip()]
    return value


CsvList = Annotated[list[str], BeforeValidator(_split_csv)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # Without this, pydantic-settings insists that list-valued variables are
        # JSON. Operators write `CORS_ORIGINS=https://a.com,https://b.com`, so the
        # decoding is left to the validators below.
        enable_decoding=False,
    )

    # ------------------------------------------------------------------ app
    ENV: Environment = "development"
    DEBUG: bool = False
    PROJECT_NAME: str = "Pitchside"
    API_V1_PREFIX: str = "/api/v1"
    #: Public origin of the *frontend*, used to build shareable links.
    PUBLIC_WEB_URL: str = "http://localhost:5173"
    #: Public origin of *this API*, used in OpenAPI servers + emails.
    PUBLIC_API_URL: str = "http://localhost:8000"

    # ------------------------------------------------------------- security
    SECRET_KEY: SecretStr = SecretStr("dev-secret-key-do-not-use-in-production")
    JWT_ALGORITHM: Literal["HS256", "HS384", "HS512"] = "HS256"
    ACCESS_TOKEN_TTL_SECONDS: int = Field(default=900, ge=60, le=86_400)  # 15 min
    REFRESH_TOKEN_TTL_SECONDS: int = Field(default=2_592_000, ge=3_600)  # 30 days
    #: Emit/accept the refresh token as an httpOnly cookie. Only enable when the
    #: web app and API share a registrable domain (avoids 3rd-party cookie loss).
    AUTH_REFRESH_COOKIE_ENABLED: bool = False
    AUTH_REFRESH_COOKIE_NAME: str = "pitchside_rt"
    AUTH_REFRESH_COOKIE_DOMAIN: str | None = None
    PASSWORD_MIN_LENGTH: int = Field(default=10, ge=8)
    ARGON2_TIME_COST: int = Field(default=3, ge=1)
    ARGON2_MEMORY_COST_KIB: int = Field(default=65_536, ge=8_192)
    ARGON2_PARALLELISM: int = Field(default=2, ge=1)
    #: Registration can be closed (invite-only deployments).
    ALLOW_REGISTRATION: bool = True

    CORS_ORIGINS: CsvList = Field(default_factory=lambda: ["http://localhost:5173"])
    #: Hosts accepted in the Host header. "*" is refused in production.
    ALLOWED_HOSTS: CsvList = Field(default_factory=lambda: ["*"])
    MAX_REQUEST_BODY_BYTES: int = Field(default=1_048_576, ge=4_096)  # 1 MiB

    # ------------------------------------------------------------- database
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/pitchside"
    DB_POOL_SIZE: int = Field(default=5, ge=1)
    DB_MAX_OVERFLOW: int = Field(default=10, ge=0)
    DB_POOL_RECYCLE_SECONDS: int = Field(default=1_800, ge=60)
    DB_POOL_PRE_PING: bool = True
    DB_STATEMENT_TIMEOUT_MS: int = Field(default=15_000, ge=1_000)
    DB_ECHO: bool = False

    # ---------------------------------------------------------------- redis
    #: Upstash: rediss://default:<password>@<host>:<port>
    REDIS_URL: str | None = None
    REDIS_KEY_PREFIX: str = "pitchside"
    REDIS_SOCKET_TIMEOUT_SECONDS: float = Field(default=5.0, gt=0)
    STATE_CACHE_TTL_SECONDS: int = Field(default=900, ge=30)

    # ----------------------------------------------------------- rate limit
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_ANON_PER_MINUTE: int = Field(default=120, ge=1)
    RATE_LIMIT_USER_PER_MINUTE: int = Field(default=600, ge=1)
    RATE_LIMIT_AUTH_PER_15MIN: int = Field(default=20, ge=1)
    RATE_LIMIT_WRITE_PER_MINUTE: int = Field(default=300, ge=1)

    # ---------------------------------------------------------- realtime/sse
    SSE_KEEPALIVE_SECONDS: int = Field(default=15, ge=5)
    SSE_MAX_CONNECTION_SECONDS: int = Field(default=3_600, ge=60)
    SSE_MAX_CONNECTIONS_PER_MATCH: int = Field(default=2_000, ge=1)

    # -------------------------------------------------------------- streaming
    #: MediaMTX WHIP publish base (browser camera → MediaMTX).
    MEDIAMTX_WHIP_BASE_URL: str = "http://localhost:8889"
    #: MediaMTX RTMP ingest base (optional restream destination).
    MEDIAMTX_RTMP_BASE_URL: str = "rtmp://localhost:1935"
    #: Legacy aliases (prefer *_BASE_URL).
    MEDIAMTX_WHIP_URL: str | None = None
    MEDIAMTX_HLS_URL: str | None = None

    # -------------------------------------------------------------- media
    #: local = store under MEDIA_LOCAL_DIR and serve in development;
    #: r2 = Cloudflare R2 / S3-compatible signed PUT uploads.
    MEDIA_BACKEND: Literal["local", "r2"] = "local"
    MEDIA_LOCAL_DIR: str = "media"
    MEDIA_PUBLIC_BASE_URL: str | None = None
    MEDIA_MAX_BYTES: int = Field(default=5_242_880, ge=65_536, le=20_971_520)  # 5 MiB
    MEDIA_UPLOAD_TTL_SECONDS: int = Field(default=900, ge=60, le=3_600)
    R2_ACCOUNT_ID: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: SecretStr | None = None
    R2_BUCKET: str | None = None
    R2_PUBLIC_BASE_URL: str | None = None
    R2_ENDPOINT_URL: str | None = None

    # ------------------------------------------------------- observability
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LOG_JSON: bool = True
    METRICS_ENABLED: bool = True
    SENTRY_DSN: str | None = None
    OPENAPI_ENABLED: bool = True

    # ------------------------------------------------------------ validators
    @field_validator("SECRET_KEY")
    @classmethod
    def _validate_secret(cls, value: SecretStr, info: ValidationInfo) -> SecretStr:
        env = (info.data or {}).get("ENV", "development")
        raw = value.get_secret_value()
        if env in ("production", "staging"):
            if raw.strip().lower() in INSECURE_PLACEHOLDERS:
                raise ValueError(
                    "SECRET_KEY must be set to a strong random value outside development. "
                    'Generate one with: python -c "import secrets;print(secrets.token_urlsafe(48))"'
                )
            if len(raw) < 32:
                raise ValueError("SECRET_KEY must be at least 32 characters in production.")
        return value

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        """Accept the URL shape Neon hands out and coerce it to psycopg3 async."""
        parts = urlsplit(value)
        scheme = parts.scheme
        if scheme in ("postgres", "postgresql", "postgresql+psycopg2"):
            scheme = "postgresql+psycopg"
        if scheme not in ("postgresql+psycopg", "postgresql+asyncpg"):
            raise ValueError(f"Unsupported database scheme: {parts.scheme!r}")
        # Validate the rest of the DSN shape with pydantic's parser.
        PostgresDsn(urlunsplit(("postgresql", parts.netloc, parts.path, parts.query, "")))
        return urlunsplit((scheme, parts.netloc, parts.path, parts.query, parts.fragment))

    @field_validator("REDIS_URL")
    @classmethod
    def _validate_redis_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("redis", "rediss"):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return value

    @field_validator("ALLOWED_HOSTS")
    @classmethod
    def _validate_hosts(cls, value: list[str], info: ValidationInfo) -> list[str]:
        env = (info.data or {}).get("ENV", "development")
        if env == "production" and ("*" in value or not value):
            raise ValueError("ALLOWED_HOSTS must be an explicit list in production.")
        return value

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _validate_cors(cls, value: list[str], info: ValidationInfo) -> list[str]:
        env = (info.data or {}).get("ENV", "development")
        if "*" in value and env in ("production", "staging"):
            raise ValueError(
                "CORS_ORIGINS cannot be '*' when credentials are allowed. "
                "List the exact web origins instead."
            )
        for origin in value:
            if origin == "*":
                continue
            AnyHttpUrl(origin)  # raises on malformed origins
        return [o.rstrip("/") for o in value]

    # ------------------------------------------------------------ computed
    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.ENV in ("production", "staging")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cookie_secure(self) -> bool:
        return self.is_production

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cookie_samesite(self) -> Literal["lax", "none"]:
        return "none" if self.is_production else "lax"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sync_database_url(self) -> str:
        """Alembic/one-off tooling variant of :attr:`DATABASE_URL`.

        psycopg3 drives both the async app and the synchronous tooling, so the
        only change is dropping an ``+asyncpg`` driver if one was configured.
        """
        return self.DATABASE_URL.replace("+asyncpg", "+psycopg")

    def redis_key(self, *parts: str) -> str:
        return ":".join((self.REDIS_KEY_PREFIX, *parts))

    def public_match_url(self, slug: str) -> str:
        return f"{self.PUBLIC_WEB_URL.rstrip('/')}/s/{slug}"

    def public_tournament_url(self, slug: str) -> str:
        return f"{self.PUBLIC_WEB_URL.rstrip('/')}/t/{slug}"

    def public_player_url(self, slug: str) -> str:
        return f"{self.PUBLIC_WEB_URL.rstrip('/')}/p/{slug}"

    def public_club_url(self, slug: str) -> str:
        return f"{self.PUBLIC_WEB_URL.rstrip('/')}/club/{slug}"

    def public_camera_url(self, match_slug: str, token: str) -> str:
        return f"{self.PUBLIC_WEB_URL.rstrip('/')}/s/{match_slug}/camera/{token}"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def media_public_base(self) -> str:
        if self.MEDIA_PUBLIC_BASE_URL:
            return self.MEDIA_PUBLIC_BASE_URL.rstrip("/")
        if self.MEDIA_BACKEND == "r2" and self.R2_PUBLIC_BASE_URL:
            return self.R2_PUBLIC_BASE_URL.rstrip("/")
        return f"{self.PUBLIC_API_URL.rstrip('/')}/media"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def generate_secret_key() -> str:
    return secrets.token_urlsafe(48)
