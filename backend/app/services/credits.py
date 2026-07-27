"""Chat credits — the beta cost ceiling.

One credit buys one answered question. ONLY chat is metered: it is the only surface
that runs the reasoning agent. Ingestion, webhooks and MCP retrieval keep running
for everyone, because stale memory makes answers wrong, not merely rationed.

The grant lives in the DB (a new member starts at their workspace's
`credit_default`), so raising someone's allowance never needs a deploy.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from ..models import UserCredit, Workspace
from . import feedback, mailer
from .memory import aware

DEFAULT_GRANT = 5
_REQUEST_COOLDOWN = timedelta(hours=12)


class OutOfCredits(Exception):
    """Raised when the caller has no chat credits left."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _row(db, ws: str, uid: str) -> UserCredit:
    """This person's credit row, created at the workspace's default on first use."""
    row = await db.get(UserCredit, (ws, uid))
    if row:
        return row
    grant = (await db.execute(select(Workspace.credit_default).where(Workspace.id == ws))).scalar_one_or_none()
    row = UserCredit(
        workspace_id=ws,
        user_id=uid,
        granted=DEFAULT_GRANT if grant is None else grant,
        used=0,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(row)
    await db.flush()
    return row


def _shape(row: UserCredit) -> dict:
    balance = max(0, row.granted - row.used)
    return {
        "balance": balance,
        "granted": row.granted,
        "used": row.used,
        "exhausted": balance <= 0,
        "requested_at": row.requested_at,
    }


async def status(db, ws: str, uid: str) -> dict:
    return _shape(await _row(db, ws, uid))


async def check(db, ws: str, uid: str) -> None:
    """Gate an answer. Raises OutOfCredits with the message the user will read."""
    row = await _row(db, ws, uid)
    if row.granted - row.used <= 0:
        raise OutOfCredits("You're out of chat credits. Request more to keep asking Orbit.")


async def consume(db, ws: str, uid: str) -> dict:
    """Charge one credit for an answer that was produced. The caller commits.

    The increment is done in SQL, not `row.used += 1`: two chats in flight for the
    same person read the same value, and a Python-side bump would silently lose one
    of the charges."""
    row = await _row(db, ws, uid)
    await db.execute(
        update(UserCredit)
        .where(UserCredit.workspace_id == ws, UserCredit.user_id == uid)
        .values(used=UserCredit.used + 1, updated_at=_now())
    )
    await db.refresh(row)
    return _shape(row)


def can_request() -> bool:
    """A request needs somewhere to land: email, or our Linear as the fallback."""
    return mailer.configured() or feedback.configured()


async def request_more(db, ws: str, uid: str, *, email: str, name: str = "") -> dict:
    """Ask us for a top-up: an email if mail is configured, otherwise an issue in
    our own Linear. Raises if neither channel accepts it, so the caller can tell
    the user the truth instead of pretending the request was sent."""
    row = await _row(db, ws, uid)
    if row.requested_at and _now() - aware(row.requested_at) < _REQUEST_COOLDOWN:
        raise PermissionError("You've already requested credits. We'll get back to you shortly.")

    who = name or email
    body = (
        f"{who} has run out of Orbit chat credits and is requesting more.\n\n"
        f"Workspace: {ws}\nUser: {uid}\nEmail: {email}\n"
        f"Used: {row.used} of {row.granted}\n\n"
        f"To top them up, raise `granted` on user_credits ({ws}, {uid}); "
        f"raise workspaces.credit_default to lift the whole workspace."
    )

    delivered: dict = {"channel": "email"}
    if not await mailer.alert(f"[Orbit] {who} is out of chat credits", body, reply_to=email):
        if not feedback.configured():
            raise RuntimeError("no notification channel is available right now.")
        issue = await feedback.submit(category="credits", description=body, email=email)
        delivered = {"channel": "linear", **issue}

    row.requested_at = _now()
    row.updated_at = _now()
    return delivered
