"""Quick LLM connectivity check — is the configured model actually answering?

Run from the backend/ dir (reads the same settings the app uses, incl. .env):
    ./.venv/bin/python check_llm.py            # local venv
    docker compose exec api python check_llm.py   # inside the container

It calls ONE agent directly, bypassing the pipeline's fallback, so you see the
REAL model output (✅) or the REAL error (❌) instead of a silent fallback.
"""
import asyncio

from app.agents.definitions import build_agent
from app.agents.schemas import MeetingSignals
from app.config import settings

PROMPT = (
    "Account: Acme Corp\n\nTranscript:\n"
    "Marcus: Honestly SSO is a hard blocker for our renewal — security won't sign off without SAML. "
    "Rachel: And we need SCIM to deprovision people, plus an audit log export."
)


async def main() -> None:
    key = settings.resolved_api_key
    print(f"enable_ai = {settings.ai_enabled}")
    print(f"model     = {settings.default_model}")
    print(f"api_key   = {'set (len %d, prefix %s…)' % (len(key), key[:3]) if key else 'NONE'}")

    if not settings.ai_enabled:
        print("\nENABLE_AI is false → the pipeline uses deterministic fallbacks, the model is never called.")
        return

    print("\nCalling the model directly (no fallback safety net)…\n")
    try:
        agent = build_agent("Extract decision-grade signals from this customer meeting.", MeetingSignals)
        out = (await agent.run(PROMPT)).output
        print("✅ MODEL IS WORKING — real structured output:\n")
        print("  summary          :", out.summary)
        print("  overall_sentiment:", out.overall_sentiment, f"({out.sentiment_score})")
        print("  urgency          :", out.urgency)
        print("  feature_requests :", [f.title for f in out.feature_requests])
        print("  pain_points      :", [p.title for p in out.pain_points])
    except Exception as e:  # noqa: BLE001 — we want to surface whatever the provider raised
        print("❌ MODEL CALL FAILED — this exact error is what makes each agent fall back:\n")
        print(f"  {type(e).__name__}: {str(e)[:400]}")


if __name__ == "__main__":
    asyncio.run(main())
