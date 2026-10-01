"""
Runturfing Backend – Stripe and RevenueCat Webhook Handlers
POST /webhooks/stripe, POST /webhooks/revenuecat
Handles: payment_intent.succeeded, payment_intent.payment_failed,
         transfer.created, transfer.failed
"""

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import text
import hmac
import hashlib
import json
import logging

from api.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # Verify webhook signature
    if settings.stripe_webhook_secret:
        if not _verify_stripe_signature(payload, sig_header, settings.stripe_webhook_secret):
            raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("type")
    data = event.get("data", {}).get("object", {})

    logger.info(f"[Stripe] Received event: {event_type}")

    if event_type == "payment_intent.succeeded":
        await _handle_payment_succeeded(data)
    elif event_type == "payment_intent.payment_failed":
        await _handle_payment_failed(data)
    elif event_type == "transfer.created":
        await _handle_transfer_created(data)
    elif event_type == "transfer.failed":
        await _handle_transfer_failed(data)
    elif event_type == "account.updated":
        await _handle_account_updated(data)
    else:
        logger.info(f"[Stripe] Unhandled event type: {event_type}")

    return {"received": True}


def _verify_stripe_signature(payload: bytes, sig_header: str, secret: str) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in sig_header.split(","))
        timestamp = parts.get("t", "")
        signatures = [v for k, v in parts.items() if k == "v1"]
        signed_payload = f"{timestamp}.".encode() + payload
        expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
        return any(hmac.compare_digest(expected, sig) for sig in signatures)
    except Exception:
        return False


async def _handle_payment_succeeded(data: dict):
    """
    The only place a season pool grows.

    Stripe redelivers webhooks, so everything here has to survive being run
    twice on the same event. The unique index on wallet_transactions.stripe_id
    (migration 003) makes the insert the idempotency gate: if it reports no
    rows inserted, this event has already been processed and the pool must not
    be credited again.
    """
    stripe_id = data.get("id")
    amount = data.get("amount", 0)
    metadata = data.get("metadata", {})
    user_id = metadata.get("user_id")
    season_id = metadata.get("season_id")
    tx_type = metadata.get("type", "entry_fee")

    if not user_id:
        logger.warning("[Stripe] payment_intent.succeeded missing user_id in metadata")
        return
    if amount <= 0:
        logger.warning(f"[Stripe] payment_intent {stripe_id} had non-positive amount {amount}")
        return

    from api.database import AsyncSessionLocal
    import uuid
    async with AsyncSessionLocal() as db:
        inserted = await db.execute(
            text("""
                INSERT INTO wallet_transactions
                    (id, user_id, season_id, type, amount_cents, status, stripe_id, description)
                VALUES (:id, :uid, :sid, :type, :amount, 'completed', :stripe_id, 'Stripe payment')
                ON CONFLICT (stripe_id) WHERE stripe_id IS NOT NULL DO NOTHING
                RETURNING id
            """).bindparams(
                id=str(uuid.uuid4()), uid=user_id, sid=season_id, type=tx_type,
                amount=amount, stripe_id=stripe_id,
            )
        )
        if inserted.fetchone() is None:
            logger.info(f"[Stripe] {stripe_id} already recorded; skipping")
            await db.rollback()
            return

        if tx_type == "entry_fee" and season_id:
            # Legacy path. Nothing creates an entry_fee PaymentIntent any more:
            # entering a season is free, and entries are settled at insert by
            # SeasonService.enter_season. This is kept so a payment that was
            # already in flight when entry went free still lands somewhere
            # rather than being dropped on the floor.
            #
            # Stamp the entry paid, and only count it toward the pool if this
            # is the transition — a second payment for an already-paid entry
            # funds nothing.
            claimed = await db.execute(
                text("""
                    UPDATE season_entries
                    SET paid_at = NOW()
                    WHERE user_id = :uid AND season_id = :sid AND paid_at IS NULL
                    RETURNING id
                """).bindparams(uid=user_id, sid=season_id)
            )
            if claimed.fetchone() is not None:
                await db.execute(
                    text("""
                        UPDATE seasons
                        SET pool_amount_cents = pool_amount_cents + :amount,
                            participant_count = participant_count + 1
                        WHERE id = :sid
                    """).bindparams(amount=amount, sid=season_id)
                )
            else:
                logger.warning(
                    f"[Stripe] entry_fee {stripe_id} for user {user_id} season {season_id} "
                    "matched no unpaid entry; pool not credited"
                )

        await db.commit()


async def _handle_payment_failed(data: dict):
    stripe_id = data.get("id")
    logger.warning(f"[Stripe] Payment failed: {stripe_id}")


async def _handle_account_updated(data: dict):
    """
    Connect Express onboarding progress. `payouts_enabled` flips true only once
    Stripe has verified the person behind the account, so it is the flag payout
    eligibility reads — never a self-reported profile field.

    It can also flip back to false if Stripe later needs more information, so
    this writes whatever Stripe currently says rather than latching true.
    """
    account_id = data.get("id")
    if not account_id:
        return

    payouts_enabled = bool(data.get("payouts_enabled"))
    requirements = data.get("requirements") or {}
    outstanding = requirements.get("currently_due") or []

    from api.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        updated = await db.execute(
            text("""
                UPDATE users
                SET stripe_payouts_enabled = :enabled
                WHERE stripe_account_id = :acct
                RETURNING id
            """).bindparams(enabled=payouts_enabled, acct=account_id)
        )
        if updated.fetchone() is None:
            logger.warning(f"[Stripe] account.updated for unknown account {account_id}")
            await db.rollback()
            return
        await db.commit()

    logger.info(
        f"[Stripe] {account_id} payouts_enabled={payouts_enabled}"
        + (f", still due: {', '.join(outstanding)}" if outstanding else "")
    )


async def _handle_transfer_created(data: dict):
    stripe_transfer_id = data.get("id")
    metadata = data.get("metadata", {})
    payout_id = metadata.get("payout_id")
    if not payout_id:
        return

    from api.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE payouts
                SET status = 'processing', stripe_transfer_id = :tid
                WHERE id = :pid
            """).bindparams(tid=stripe_transfer_id, pid=payout_id)
        )
        await db.commit()


async def _handle_transfer_failed(data: dict):
    stripe_transfer_id = data.get("id")
    metadata = data.get("metadata", {})
    payout_id = metadata.get("payout_id")
    if not payout_id:
        return

    from api.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE payouts SET status = 'failed' WHERE id = :pid").bindparams(pid=payout_id)
        )
        await db.commit()


# ---------------------------------------------------------------------------
# RevenueCat
# ---------------------------------------------------------------------------

# The bounty is a one-time product, so it arrives as NON_RENEWING_PURCHASE.
# A store refund arrives as CANCELLATION with cancel_reason CUSTOMER_SUPPORT.
RC_PURCHASE_EVENTS = {"NON_RENEWING_PURCHASE", "INITIAL_PURCHASE"}


@router.post("/revenuecat")
async def revenuecat_webhook(request: Request):
    """
    Records rundating bounties bought in the app through RevenueCat.

    RevenueCat has no payload signature; it sends back the Authorization header
    configured on the dashboard, so that is compared in constant time. With no
    secret configured the endpoint refuses everything rather than trusting it.
    """
    expected = settings.revenuecat_webhook_auth
    got = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="Invalid authorization")

    try:
        event = (await request.json()).get("event") or {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("type")
    logger.info(f"[RevenueCat] Received event: {event_type}")

    if event_type in RC_PURCHASE_EVENTS:
        await _handle_rc_bounty_purchase(event)
    elif event_type == "CANCELLATION" and event.get("cancel_reason") == "CUSTOMER_SUPPORT":
        await _handle_rc_bounty_refund(event)
    else:
        logger.info(f"[RevenueCat] Unhandled event type: {event_type}")

    # 200 for anything authenticated, so RevenueCat does not retry events we skip.
    return {"received": True}


def _rc_user_id(event: dict):
    """The app logs in with our user id; anonymous ($RCAnonymousID) buyers have none."""
    uid = event.get("app_user_id") or ""
    return None if uid.startswith("$RCAnonymousID") else uid


async def _handle_rc_bounty_purchase(event: dict):
    """
    Idempotent the same way the Stripe path is: the transaction id goes into
    wallet_transactions.stripe_id (prefixed rc:) under its unique index, so a
    redelivered event inserts nothing and changes nothing.

    The bounty attaches to whichever season is open when it was bought, and
    buying one enters the runner if they were not in yet. The full price is
    recorded on season_entries.bid_amount_cents. The pool is left alone: the
    half-and-half split belongs to the flat payout refactor (docs/RUNDATING.md),
    and crediting it here would trip the pool check in calculate_payouts.
    """
    from datetime import datetime, timezone
    from api.database import AsyncSessionLocal
    from api.services.season_service import SeasonService
    import uuid

    user_id = _rc_user_id(event)
    tx_id = event.get("transaction_id") or event.get("id")
    # `price` is USD, after conversion, before store fees.
    amount = int(round(float(event.get("price") or 0) * 100))
    if not user_id or not tx_id:
        logger.warning(f"[RevenueCat] purchase without user or transaction id: {event.get('id')}")
        return
    if amount <= 0:
        # Sandbox and Test Store purchases can report 0; still log them.
        logger.info(f"[RevenueCat] {tx_id} had price {event.get('price')}; recording as 0")

    purchased_ms = event.get("purchased_at_ms") or event.get("event_timestamp_ms")
    purchased_at = (
        datetime.fromtimestamp(purchased_ms / 1000, tz=timezone.utc)
        if purchased_ms else datetime.now(timezone.utc)
    )

    async with AsyncSessionLocal() as db:
        season_id = await SeasonService.auto_enter_for_run(db, user_id, purchased_at)

        inserted = await db.execute(
            text("""
                INSERT INTO wallet_transactions
                    (id, user_id, season_id, type, amount_cents, status, stripe_id, description)
                VALUES (:id, :uid, :sid, 'bid', :amount, 'completed', :ext, :desc)
                ON CONFLICT (stripe_id) WHERE stripe_id IS NOT NULL DO NOTHING
                RETURNING id
            """).bindparams(
                id=str(uuid.uuid4()), uid=user_id, sid=season_id, amount=amount,
                ext=f"rc:{tx_id}", desc=f"Rundating bounty ({event.get('product_id')})",
            )
        )
        if inserted.fetchone() is None:
            logger.info(f"[RevenueCat] {tx_id} already recorded; skipping")
            await db.rollback()
            return

        if season_id:
            await db.execute(
                text("""
                    UPDATE season_entries
                    SET bid_amount_cents = bid_amount_cents + :amount
                    WHERE user_id = :uid AND season_id = :sid
                """).bindparams(amount=amount, uid=user_id, sid=season_id)
            )
        else:
            logger.warning(
                f"[RevenueCat] bounty {tx_id} from {user_id} bought outside any open season; "
                "recorded with no season"
            )
        await db.commit()


async def _handle_rc_bounty_refund(event: dict):
    """Reverses a refunded bounty once, and takes it back off the entry."""
    from api.database import AsyncSessionLocal

    tx_id = event.get("transaction_id") or event.get("id")
    if not tx_id:
        return

    async with AsyncSessionLocal() as db:
        reversed_row = (await db.execute(
            text("""
                UPDATE wallet_transactions
                SET status = 'reversed'
                WHERE stripe_id = :ext AND status = 'completed'
                RETURNING user_id, season_id, amount_cents
            """).bindparams(ext=f"rc:{tx_id}")
        )).fetchone()
        if reversed_row is None:
            logger.info(f"[RevenueCat] refund for {tx_id} matched nothing open; skipping")
            await db.rollback()
            return

        uid, sid, amount = reversed_row
        if sid:
            await db.execute(
                text("""
                    UPDATE season_entries
                    SET bid_amount_cents = GREATEST(bid_amount_cents - :amount, 0)
                    WHERE user_id = :uid AND season_id = :sid
                """).bindparams(amount=amount, uid=uid, sid=sid)
            )
        await db.commit()
