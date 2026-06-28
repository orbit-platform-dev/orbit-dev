"""Central model service.

Resolves the configured ``"provider:name"`` string (DEFAULT_MODEL) into a
PydanticAI model. Switching providers is config-only; adding one is a single
registry entry. Agents never reference a provider directly.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from ..config import settings
from pydantic_ai.models import infer_model

if TYPE_CHECKING:
    from pydantic_ai.models import Model


def _gemini(name: str) -> "Model":
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google import GoogleProvider

    return GoogleModel(name, provider=GoogleProvider(api_key=settings.resolved_api_key))


def _ollama(name: str) -> "Model":
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.ollama import OllamaProvider

    base_url = settings.ollama_base_url or "http://localhost:11434/v1"
    return OpenAIChatModel(name, provider=OllamaProvider(base_url=base_url))


def _anthropic(name: str) -> "Model":
    from pydantic_ai.models.anthropic import AnthropicModel
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return AnthropicModel(name, provider=AnthropicProvider(api_key=settings.resolved_api_key))


def _openai(name: str) -> "Model":
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIChatModel(name, provider=OpenAIProvider(api_key=settings.resolved_api_key))


PROVIDERS: dict[str, Callable[[str], "Model"]] = {
    "google-gla": _gemini,
    "google": _gemini,
    "ollama": _ollama,
    "anthropic": _anthropic,
    "openai": _openai,
}


def build_model(model_id: str | None = None) -> "Model":
    model_id = model_id or settings.default_model
    provider, _, name = model_id.partition(":")
    builder = PROVIDERS.get(provider)
    if builder is None or not name:

        return infer_model(model_id)
    return builder(name)
