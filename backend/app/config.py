"""Application settings, loaded from environment / .env."""
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_DEFAULT_MODEL = "google-gla:gemini-3.5-flash-lite"
_PROD_DEFAULT_MODEL = "google-gla:gemini-3.6-flash"
_DEV_EMBEDDING_MODEL = "gemini-embedding-001"
_PROD_EMBEDDING_MODEL = "gemini-embedding-2"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.local"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Orbit API"
    environment: str = "development"

    database_url: str = "sqlite+aiosqlite:///./orbit.db"
    db_password: str | None = None
    redis_url: str | None = None

    seed_demo: bool = True

    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    cors_origin_regex: str | None = None

    clerk_jwks_url: str | None = None
    clerk_issuer: str | None = None


    frontend_url: str = "http://localhost:3000"
    public_api_url: str | None = None

    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8000/calendar/oauth/callback"
    gdrive_redirect_uri: str = "http://localhost:8000/integrations/google-drive/oauth/callback"

    meet_redirect_uri: str = "http://localhost:8000/meet/oauth/callback"

    zoom_client_id: str | None = None
    zoom_client_secret: str | None = None
    zoom_redirect_uri: str = "http://localhost:8000/zoom/oauth/callback"


    linear_client_id: str | None = None
    linear_client_secret: str | None = None
    linear_redirect_uri: str = "http://localhost:8000/integrations/linear/oauth/callback"


    slack_client_id: str | None = None
    slack_client_secret: str | None = None
    slack_redirect_uri: str = "http://localhost:8000/integrations/slack/oauth/callback"

    github_client_id: str | None = None
    github_client_secret: str | None = None
    github_redirect_uri: str = "http://localhost:8000/integrations/github/oauth/callback"

    orbit_linear_api_key: str | None = None
    orbit_linear_team_id: str | None = None          
    orbit_linear_label: str = "MVP Requests"

    enable_ai: bool = False
    # None → filled by _environment_model_defaults below (dev vs production).
    default_model: str | None = None

    extractor_model: str | None = None
    agent_model: str | None = None
    llm_api_key: str | None = None

    embedding_model: str | None = None
    ollama_base_url: str | None = None  

    anthropic_api_key: str | None = None

    # --- Heartbeat (the OS loop) ----------------------------------------------
    # Orbit scans for gaps and refreshes the brief on its own schedule; nothing
    # here EXECUTES actions — detection and briefs are read + insight writes only.
    # OFF by default: no automatic scanning (= no background LLM/embedding charges).
    # Opt in explicitly — HEARTBEAT_ENABLED=true for the in-process loop, or drive
    # POST /internal/heartbeat from Cloud Scheduler. Manual "Scan now" always works.
    heartbeat_enabled: bool = False
    heartbeat_interval_minutes: int = 30
    brief_max_age_days: int = 7

    heartbeat_token: str | None = None

    @model_validator(mode="after")
    def _environment_model_defaults(self) -> "Settings":
        """Dev runs free-tier models, production runs the refined ones — same
        code, switched by ENVIRONMENT=production. Explicit env vars still win."""
        if not self.default_model:
            self.default_model = _PROD_DEFAULT_MODEL if self.is_production else _DEV_DEFAULT_MODEL
        if not self.embedding_model:
            self.embedding_model = _PROD_EMBEDDING_MODEL if self.is_production else _DEV_EMBEDDING_MODEL
        return self

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in ("production", "prod")

    @property
    def resolved_api_key(self) -> str | None:
        """The API key handed to the configured provider (None for local/Ollama)."""
        return self.llm_api_key or self.anthropic_api_key

    @property
    def resolved_agent_model(self) -> str:
        return self.agent_model or self.default_model

    @property
    def cors_allow_origins(self) -> list[str]:
        """Configured origins plus the deployed frontend URL, so a correct
        FRONTEND_URL alone unblocks CORS in production (no double-config)."""
        origins = list(self.cors_origins)
        if self.frontend_url and self.frontend_url not in origins:
            origins.append(self.frontend_url.rstrip("/"))
        return origins

    @property
    def ai_enabled(self) -> bool:
        return self.enable_ai


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
