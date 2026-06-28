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
    ollama_base_url: str | None = None  # defaults to http://localhost:11434/v1

    # Back-compat: a bare ANTHROPIC_API_KEY is still accepted as the LLM key.
    anthropic_api_key: str | None = None

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
