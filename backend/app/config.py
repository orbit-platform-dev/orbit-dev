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

    # --- Google Calendar + Zoom OAuth -----------------------------------------
    # Where the Next.js app lives — the post-OAuth redirect target.
    frontend_url: str = "http://localhost:3000"
    # Google OAuth client (create one at https://console.cloud.google.com →
    # APIs & Services → Credentials → OAuth client ID, type "Web application").
    # Authorized redirect URI must exactly match GOOGLE_REDIRECT_URI below.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8000/calendar/oauth/callback"
    # Google Meet reuses the same OAuth client with its own callback + scopes;
    # this URI must also be authorized on the client, and the 'Google Meet REST
    # API' must be enabled in the Cloud project.
    meet_redirect_uri: str = "http://localhost:8000/meet/oauth/callback"
    # Zoom OAuth app (create one at https://marketplace.zoom.us → Develop →
    # Build App → General App). Redirect URL must match ZOOM_REDIRECT_URI.
    zoom_client_id: str | None = None
    zoom_client_secret: str | None = None
    zoom_redirect_uri: str = "http://localhost:8000/zoom/oauth/callback"

    # --- Linear OAuth (optional; the personal API key remains a supported path) -
    # Create an OAuth app at https://linear.app/settings/api/applications/new.
    # The redirect URL there must exactly match LINEAR_REDIRECT_URI. Linear
    # access tokens are long-lived and it issues no refresh token, so none is
    # stored. When these are unset, "Connect with Linear" is hidden and only the
    # API-key path is offered (the app degrades honestly).
    linear_client_id: str | None = None
    linear_client_secret: str | None = None
    linear_redirect_uri: str = "http://localhost:8000/integrations/linear/oauth/callback"

    # --- Slack OAuth ("Connect Slack"). Create an app at https://api.slack.com/apps,
    #     add the callback below under OAuth & Permissions, and the bot scopes
    #     channels:history, channels:read, groups:history, users:read. When unset,
    #     Slack shows as coming-soon (degrades honestly). ---
    slack_client_id: str | None = None
    slack_client_secret: str | None = None
    slack_redirect_uri: str = "http://localhost:8000/integrations/slack/oauth/callback"

    # --- AI / LLM provider (provider-agnostic via PydanticAI) ----------------
    # The agent pipeline only calls a live model when ENABLE_AI=true; otherwise
    # it uses deterministic, transcript-derived fallbacks so the whole product
    # runs offline. The provider is chosen entirely by DEFAULT_MODEL's
    # "provider:name" prefix, so switching providers is an env change, not code.
    #
    #   Free dev (Gemini):   DEFAULT_MODEL=google-gla:gemini-2.0-flash  LLM_API_KEY=...
    #   Free dev (Ollama):   DEFAULT_MODEL=ollama:llama3.2              (no key; local)
    #   Production (Claude): DEFAULT_MODEL=anthropic:claude-opus-4-8    LLM_API_KEY=sk-ant-...
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
