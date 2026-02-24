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

    session = stripe.checkout.Session.create(
        mode="payment",
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

    # 2. Handle checkout.session.completed event
    if event["type"] == "checkout.session.completed":
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

        # 3. Credit tenant account
        credits_to_add = 0
        if payment.credit_package_id:
            pkg_result = await db.execute(
                select(CreditPackage).where(CreditPackage.id == payment.credit_package_id)
            )
            package = pkg_result.scalar_one_or_none()
            if package:
                credits_to_add = package.credits + package.bonus_credits

        if credits_to_add > 0:
            balance_result = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == payment.tenant_id)
            )
            balance = balance_result.scalar_one_or_none()

            if balance:
                balance.balance += credits_to_add
                balance.lifetime_purchased += credits_to_add

                transaction = CreditTransaction(
                    tenant_id=payment.tenant_id,
                    user_id=payment.user_id,
                    type="purchase",
                    amount=credits_to_add,
                    balance_after=balance.balance,
                    description="Stripe payment completed",
                    reference_type="payment",
                    reference_id=payment.id,
                )
                db.add(transaction)

        await db.flush()
        logger.info(f"Stripe webhook: payment {payment_id} completed, {credits_to_add} credits added")
        return {"status": "completed", "payment_id": payment_id}

    return {"status": "received", "type": event["type"]}


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
