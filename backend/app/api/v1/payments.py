import logging
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.payment import Payment
from app.models.credit import CreditPackage, CreditBalance, CreditTransaction
from app.config import get_settings
from app.schemas.payment import (
    StripeCheckoutRequest,
    StripeCheckoutResponse,
    BankTransferRequest,
    PaymentResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _credit_tenant(
    db: AsyncSession,
    tenant_id,
    user_id,
    package: CreditPackage,
    payment_id,
    description: str,
):
    """Add credits to a tenant's balance and create a transaction record."""
    credits_to_add = package.credits + package.bonus_credits
    if credits_to_add <= 0:
        return 0

    balance_result = await db.execute(
        select(CreditBalance).where(CreditBalance.tenant_id == tenant_id)
    )
    balance = balance_result.scalar_one_or_none()

    if balance:
        balance.balance += credits_to_add
        balance.lifetime_purchased += credits_to_add

        transaction = CreditTransaction(
            tenant_id=tenant_id,
            user_id=user_id,
            type="purchase",
            amount=credits_to_add,
            balance_after=balance.balance,
            description=description,
            reference_type="payment",
            reference_id=payment_id,
        )
        db.add(transaction)

    return credits_to_add


@router.post("/stripe/checkout", response_model=StripeCheckoutResponse)
async def create_stripe_checkout(
    data: StripeCheckoutRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Get package
    result = await db.execute(
        select(CreditPackage).where(CreditPackage.id == data.package_id, CreditPackage.is_active == True)
    )
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    # Create payment record
    payment = Payment(
        tenant_id=user.tenant_id,
        user_id=user.id,
        credit_package_id=package.id,
        amount_cents=package.price_cents,
        currency=package.currency,
        method="stripe",
        status="pending",
    )
    db.add(payment)
    await db.flush()

    # Create Stripe Checkout Session
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key

    if not package.stripe_price_id:
        raise HTTPException(status_code=400, detail="This package is not available for Stripe payments")

    # Determine mode based on billing interval
    is_subscription = package.billing_interval in ("monthly", "annual")
    checkout_mode = "subscription" if is_subscription else "payment"

    session = stripe.checkout.Session.create(
        mode=checkout_mode,
        payment_method_types=["card"],
        line_items=[{"price": package.stripe_price_id, "quantity": 1}],
        metadata={
            "payment_id": str(payment.id),
            "tenant_id": str(user.tenant_id),
            "user_id": str(user.id),
            "package_id": str(package.id),
        },
        success_url=f"{settings.frontend_url}/credits?payment=success",
        cancel_url=f"{settings.frontend_url}/credits?payment=cancelled",
    )

    payment.stripe_checkout_session_id = session.id
    await db.flush()

    return StripeCheckoutResponse(
        checkout_url=session.url,
        session_id=session.id,
    )


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key

    # 1. Verify webhook signature
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing Stripe signature header")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_type = event["type"]

    # ── checkout.session.completed ──────────────────────────────────
    if event_type == "checkout.session.completed":
        session_data = event["data"]["object"]
        metadata = session_data.get("metadata", {})
        payment_id = metadata.get("payment_id")

        if not payment_id:
            logger.warning("Stripe webhook: no payment_id in metadata")
            return {"status": "ignored"}

        result = await db.execute(select(Payment).where(Payment.id == payment_id))
        payment = result.scalar_one_or_none()
        if not payment:
            logger.warning(f"Stripe webhook: payment {payment_id} not found")
            return {"status": "ignored"}

        # Idempotency: skip if already completed
        if payment.status == "completed":
            return {"status": "already_processed"}

        payment.status = "completed"
        payment.completed_at = datetime.now(timezone.utc)
        payment.stripe_payment_intent_id = session_data.get("payment_intent")

        # Store subscription ID if this is a subscription checkout
        subscription_id = session_data.get("subscription")
        if subscription_id:
            payment.stripe_subscription_id = subscription_id

        # Credit tenant account
        credits_added = 0
        if payment.credit_package_id:
            pkg_result = await db.execute(
                select(CreditPackage).where(CreditPackage.id == payment.credit_package_id)
            )
            package = pkg_result.scalar_one_or_none()
            if package:
                credits_added = await _credit_tenant(
                    db, payment.tenant_id, payment.user_id, package, payment.id,
                    "Stripe payment completed",
                )

        await db.flush()
        logger.info(f"Stripe webhook: payment {payment_id} completed, {credits_added} credits added")
        return {"status": "completed", "payment_id": payment_id}

    # ── invoice.paid — subscription renewal ─────────────────────────
    if event_type == "invoice.paid":
        invoice = event["data"]["object"]
        subscription_id = invoice.get("subscription")
        billing_reason = invoice.get("billing_reason")

        # Skip the first invoice — already handled by checkout.session.completed
        if billing_reason == "subscription_create":
            return {"status": "ignored", "reason": "initial invoice handled by checkout"}

        if not subscription_id:
            return {"status": "ignored"}

        # Find the original payment for this subscription
        result = await db.execute(
            select(Payment)
            .where(Payment.stripe_subscription_id == subscription_id, Payment.status == "completed")
            .order_by(Payment.created_at.desc())
            .limit(1)
        )
        original_payment = result.scalar_one_or_none()
        if not original_payment:
            logger.warning(f"Stripe webhook: no payment for subscription {subscription_id}")
            return {"status": "ignored"}

        # Create a new payment record for the renewal
        renewal = Payment(
            tenant_id=original_payment.tenant_id,
            user_id=original_payment.user_id,
            credit_package_id=original_payment.credit_package_id,
            amount_cents=invoice.get("amount_paid", 0),
            currency=(invoice.get("currency") or "usd").upper(),
            method="stripe",
            status="completed",
            completed_at=datetime.now(timezone.utc),
            stripe_payment_intent_id=invoice.get("payment_intent"),
            stripe_subscription_id=subscription_id,
        )
        db.add(renewal)
        await db.flush()

        # Credit tenant
        credits_added = 0
        if renewal.credit_package_id:
            pkg_result = await db.execute(
                select(CreditPackage).where(CreditPackage.id == renewal.credit_package_id)
            )
            package = pkg_result.scalar_one_or_none()
            if package:
                credits_added = await _credit_tenant(
                    db, renewal.tenant_id, renewal.user_id, package, renewal.id,
                    "Subscription renewal",
                )

        await db.flush()
        logger.info(f"Stripe webhook: subscription {subscription_id} renewed, {credits_added} credits added")
        return {"status": "renewal_processed", "subscription_id": subscription_id}

    # ── customer.subscription.deleted — cancellation ────────────────
    if event_type == "customer.subscription.deleted":
        sub_data = event["data"]["object"]
        subscription_id = sub_data.get("id")
        logger.info(f"Stripe webhook: subscription {subscription_id} cancelled")
        # No credits to deduct — user keeps remaining credits until they run out
        return {"status": "subscription_cancelled", "subscription_id": subscription_id}

    # ── charge.refunded — Stripe-initiated refund ───────────────────
    if event_type == "charge.refunded":
        charge = event["data"]["object"]
        payment_intent_id = charge.get("payment_intent")
        if payment_intent_id:
            result = await db.execute(
                select(Payment).where(
                    Payment.stripe_payment_intent_id == payment_intent_id,
                    Payment.status == "completed",
                )
            )
            payment = result.scalar_one_or_none()
            if payment:
                payment.status = "refunded"
                payment.refunded_at = datetime.now(timezone.utc)
                await db.flush()
                logger.info(f"Stripe webhook: payment {payment.id} refunded via Stripe dashboard")
        return {"status": "refund_processed"}

    return {"status": "received", "type": event_type}


@router.post("/bank-transfer", response_model=PaymentResponse)
async def submit_bank_transfer(
    data: BankTransferRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Get package
    result = await db.execute(
        select(CreditPackage).where(CreditPackage.id == data.package_id, CreditPackage.is_active == True)
    )
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    payment = Payment(
        tenant_id=user.tenant_id,
        user_id=user.id,
        credit_package_id=package.id,
        amount_cents=package.price_cents,
        currency=package.currency,
        method="bank_transfer",
        status="pending",
        bank_transfer_reference=data.reference,
        bank_transfer_proof_url=data.proof_url,
    )
    db.add(payment)
    await db.flush()

    return payment


@router.post("/stripe/cancel-subscription")
async def cancel_subscription(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel the user's active Stripe subscription."""
    # Find the most recent subscription payment for this tenant
    result = await db.execute(
        select(Payment)
        .where(
            Payment.tenant_id == user.tenant_id,
            Payment.stripe_subscription_id.isnot(None),
            Payment.status == "completed",
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )
    payment = result.scalar_one_or_none()
    if not payment or not payment.stripe_subscription_id:
        raise HTTPException(status_code=404, detail="No active subscription found")

    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key

    try:
        stripe.Subscription.cancel(payment.stripe_subscription_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to cancel subscription: {str(e)}")

    return {"status": "cancelled", "subscription_id": payment.stripe_subscription_id}


@router.get("/subscription-status")
async def get_subscription_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current subscription status for the tenant."""
    result = await db.execute(
        select(Payment)
        .where(
            Payment.tenant_id == user.tenant_id,
            Payment.stripe_subscription_id.isnot(None),
            Payment.status == "completed",
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )
    payment = result.scalar_one_or_none()
    if not payment or not payment.stripe_subscription_id:
        return {"has_subscription": False}

    # Fetch subscription status from Stripe
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key

    try:
        sub = stripe.Subscription.retrieve(payment.stripe_subscription_id)
        return {
            "has_subscription": True,
            "subscription_id": sub.id,
            "status": sub.status,  # active, past_due, canceled, etc.
            "current_period_end": sub.current_period_end,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "package_id": str(payment.credit_package_id) if payment.credit_package_id else None,
        }
    except Exception:
        return {"has_subscription": False}


@router.get("/history", response_model=list[PaymentResponse])
async def payment_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    result = await db.execute(
        select(Payment)
        .where(Payment.tenant_id == user.tenant_id)
        .order_by(Payment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()
