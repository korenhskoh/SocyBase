"""SocyBase Telegram Bot — remote job management and notifications."""

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
from sqlalchemy import select

from app.config import get_settings
from app.database import async_session
from app.models.user import User
from app.models.job import ScrapingJob
from app.models.credit import CreditBalance
from app.models.platform import Platform
from app.utils.security import decode_token

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_user_by_chat_id(chat_id: str) -> User | None:
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.telegram_chat_id == str(chat_id))
        )
        return result.scalar_one_or_none()


# ── /start ───────────────────────────────────────────────────────────────


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Link Telegram account to SocyBase via deep link token."""
    chat_id = str(update.effective_chat.id)

    # Check if already linked
    user = await _get_user_by_chat_id(chat_id)
    if user:
        await update.message.reply_text(
            f"Already linked to {user.email}.\n\n"
            "Commands:\n"
            "/jobs — List recent jobs\n"
            "/newjob — Create a scraping job\n"
            "/credits — Check credit balance\n"
            "/status <job_id> — Check job status"
        )
        return

    # Expect a linking token: /start <token>
    if context.args:
        token = context.args[0]
        payload = decode_token(token)
        if payload and payload.get("type") == "telegram_link":
            user_id = payload.get("sub")
            async with async_session() as db:
                result = await db.execute(
                    select(User).where(User.id == user_id)
                )
                user = result.scalar_one_or_none()
                if user:
                    user.telegram_chat_id = chat_id
                    await db.commit()
                    await update.message.reply_text(
                        f"Account linked to {user.email}!\n\n"
                        "Commands:\n"
                        "/jobs — List recent jobs\n"
                        "/newjob — Create a scraping job\n"
                        "/credits — Check credit balance\n"
                        "/status <job_id> — Check job status"
                    )
                    return
        await update.message.reply_text("Invalid or expired link token. Please try again from Settings.")
    else:
        await update.message.reply_text(
            "Welcome to SocyBase Bot!\n\n"
            "To link your account, go to Settings in the SocyBase dashboard "
            "and click 'Link Telegram'.\n\n"
            "Once linked, you can manage scraping jobs and check credits "
            "directly from Telegram."
        )


# ── /jobs ────────────────────────────────────────────────────────────────


async def jobs_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List recent scraping jobs."""
    user = await _get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await update.message.reply_text("Please link your account first. See /start")
        return

    async with async_session() as db:
        result = await db.execute(
            select(ScrapingJob)
            .where(ScrapingJob.user_id == user.id)
            .order_by(ScrapingJob.created_at.desc())
            .limit(5)
        )
        jobs = result.scalars().all()

    if not jobs:
        await update.message.reply_text("No jobs found. Use /newjob to create one.")
        return

    status_icons = {
        "completed": "\u2705",
        "running": "\U0001F504",
        "failed": "\u274C",
        "queued": "\u23F3",
        "pending": "\u23F3",
        "scheduled": "\U0001F4C5",
        "cancelled": "\u26D4",
    }

    lines = ["<b>Recent Jobs:</b>\n"]
    buttons = []
    for job in jobs:
        icon = status_icons.get(job.status, "\u26AA")
        short_id = str(job.id)[:8]
        lines.append(
            f"{icon} <code>{short_id}</code> — {job.status} "
            f"({job.processed_items or 0}/{job.total_items or '?'})"
        )
        buttons.append([
            InlineKeyboardButton(
                f"Details: {short_id}...",
                callback_data=f"job:{job.id}",
            )
        ])

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ── /credits ─────────────────────────────────────────────────────────────


async def credits_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check credit balance."""
    user = await _get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await update.message.reply_text("Please link your account first. See /start")
        return

    async with async_session() as db:
        result = await db.execute(
            select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
        )
        balance = result.scalar_one_or_none()

    if balance:
        await update.message.reply_text(
            f"<b>Credit Balance</b>\n\n"
            f"Available: <b>{balance.balance:,}</b>\n"
            f"Lifetime purchased: {balance.lifetime_purchased:,}\n"
            f"Lifetime used: {balance.lifetime_used:,}",
            parse_mode="HTML",
        )
    else:
        await update.message.reply_text("No credit balance found.")


# ── /status <job_id> ─────────────────────────────────────────────────────


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check status of a specific job."""
    user = await _get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await update.message.reply_text("Please link your account first. See /start")
        return

    if not context.args:
        await update.message.reply_text("Usage: /status <job_id>")
        return

    job_id = context.args[0]
    async with async_session() as db:
        result = await db.execute(
            select(ScrapingJob).where(
                ScrapingJob.id == job_id,
                ScrapingJob.user_id == user.id,
            )
        )
        job = result.scalar_one_or_none()

    if not job:
        await update.message.reply_text("Job not found.")
        return

    await update.message.reply_text(
        f"<b>Job {str(job.id)[:8]}...</b>\n\n"
        f"Status: <b>{job.status}</b>\n"
        f"Progress: {job.processed_items or 0}/{job.total_items or '?'} "
        f"({job.progress_pct or 0}%)\n"
        f"Credits used: {job.credits_used or 0}\n"
        f"Results: {job.result_row_count or 0} profiles",
        parse_mode="HTML",
    )


# ── /newjob ──────────────────────────────────────────────────────────────


async def newjob_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start creating a new scraping job."""
    user = await _get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await update.message.reply_text("Please link your account first. See /start")
        return

    # Fetch available platforms
    async with async_session() as db:
        result = await db.execute(
            select(Platform).where(Platform.is_enabled == True)
        )
        platforms = result.scalars().all()

    if not platforms:
        await update.message.reply_text("No platforms available right now.")
        return

    keyboard = []
    for p in platforms:
        keyboard.append([
            InlineKeyboardButton(
                p.display_name,
                callback_data=f"newjob:{p.name}",
            )
        ])

    await update.message.reply_text(
        "Select a platform for your scraping job:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── Callback Handler ─────────────────────────────────────────────────────


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline keyboard button presses."""
    query = update.callback_query
    await query.answer()
    data = query.data

    if data.startswith("job:"):
        # Show job details
        job_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            await query.edit_message_text("Please link your account first.")
            return

        async with async_session() as db:
            result = await db.execute(
                select(ScrapingJob).where(
                    ScrapingJob.id == job_id,
                    ScrapingJob.user_id == user.id,
                )
            )
            job = result.scalar_one_or_none()

        if not job:
            await query.edit_message_text("Job not found.")
            return

        await query.edit_message_text(
            f"<b>Job {str(job.id)[:8]}...</b>\n\n"
            f"Status: <b>{job.status}</b>\n"
            f"Progress: {job.processed_items or 0}/{job.total_items or '?'} "
            f"({job.progress_pct or 0}%)\n"
            f"Credits used: {job.credits_used or 0}\n"
            f"Results: {job.result_row_count or 0} profiles\n"
            f"Created: {job.created_at.strftime('%Y-%m-%d %H:%M') if job.created_at else '-'}",
            parse_mode="HTML",
        )

    elif data.startswith("newjob:"):
        # User selected a platform — ask for URL
        platform = data.split(":", 1)[1]
        context.user_data["new_job_platform"] = platform
        await query.edit_message_text(
            f"Platform: <b>{platform}</b>\n\n"
            "Now send me the post URL to scrape comments from:",
            parse_mode="HTML",
        )


# ── Message Handler (for URL input) ──────────────────────────────────────


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages — used for URL input during /newjob flow."""
    platform = context.user_data.get("new_job_platform")
    if not platform:
        await update.message.reply_text(
            "Use /newjob to start a scraping job, or /jobs to see existing ones."
        )
        return

    user = await _get_user_by_chat_id(str(update.effective_chat.id))
    if not user:
        await update.message.reply_text("Please link your account first.")
        return

    url = update.message.text.strip()
    if not url.startswith("http"):
        await update.message.reply_text("Please send a valid URL starting with http:// or https://")
        return

    # Create the job
    async with async_session() as db:
        # Find platform
        result = await db.execute(
            select(Platform).where(Platform.name == platform)
        )
        plat = result.scalar_one_or_none()
        if not plat:
            await update.message.reply_text("Platform not found.")
            context.user_data.pop("new_job_platform", None)
            return

        job = ScrapingJob(
            tenant_id=user.tenant_id,
            user_id=user.id,
            platform_id=plat.id,
            job_type="comment_scrape",
            status="queued",
            input_type="url",
            input_value=url,
        )
        db.add(job)
        await db.commit()

        # Dispatch Celery task
        from app.scraping.pipeline import run_scraping_pipeline
        task = run_scraping_pipeline.delay(str(job.id))
        job.celery_task_id = task.id
        await db.commit()

        await update.message.reply_text(
            f"<b>Job created!</b>\n\n"
            f"ID: <code>{str(job.id)[:8]}...</code>\n"
            f"Platform: {platform}\n"
            f"URL: {url}\n\n"
            f"Use /status {job.id} to track progress.\n"
            f"You'll get a notification when it's done.",
            parse_mode="HTML",
        )

    context.user_data.pop("new_job_platform", None)


# ── Bot Application Builder ──────────────────────────────────────────────


def create_bot_app() -> Application:
    """Build and configure the Telegram bot application."""
    settings = get_settings()
    if not settings.telegram_bot_token:
        raise ValueError("TELEGRAM_BOT_TOKEN is not set")

    app = Application.builder().token(settings.telegram_bot_token).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("jobs", jobs_command))
    app.add_handler(CommandHandler("credits", credits_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("newjob", newjob_command))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    return app
