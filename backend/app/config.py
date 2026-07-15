"""Application settings, loaded from environment / .env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Orbit API"
    environment: str = "development"

    # Zero-config dev default = SQLite. docker-compose overrides with PostgreSQL.
    database_url: str = "sqlite+aiosqlite:///./orbit.db"
    redis_url: str | None = None

    # Seed the demo dataset on first boot. Set SEED_DEMO=false to start with an empty DB.
    seed_demo: bool = True

    # CORS — the Next.js frontend origin(s).
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Auth (Clerk). When unset, auth is disabled and the API runs open (dev/demo).
    clerk_jwks_url: str | None = None
    clerk_issuer: str | None = None


    frontend_url: str = "http://localhost:3000"

    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8000/calendar/oauth/callback"

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

    enable_ai: bool = False
    default_model: str = "google-gla:gemini-2.0-flash"
    llm_api_key: str | None = None
    # Embedding model for the Context Engine's semantic retrieval (uses the
    # same LLM_API_KEY). Output is requested at models.EMBEDDING_DIM dimensions.
    embedding_model: str = "gemini-embedding-001"
    ollama_base_url: str | None = None  # defaults to http://localhost:11434/v1

    # Back-compat: a bare ANTHROPIC_API_KEY is still accepted as the LLM key.
    anthropic_api_key: str | None = None

    # --- Heartbeat (the OS loop) ----------------------------------------------
    # Orbit scans for gaps and refreshes the brief on its own schedule; nothing
    # here EXECUTES actions — detection and briefs are read + insight writes only.
    heartbeat_enabled: bool = True
    heartbeat_interval_minutes: int = 30
    brief_max_age_days: int = 7

    @property
    def resolved_api_key(self) -> str | None:
        """The API key handed to the configured provider (None for local/Ollama)."""
        return self.llm_api_key or self.anthropic_api_key

    @property
    def ai_enabled(self) -> bool:
        return self.enable_ai


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
