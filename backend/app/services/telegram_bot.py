"""SocyBase Telegram Bot — remote job management and notifications.

Mirrors the webapp flow:
  /newjob → select platform → select scrape type → send input → job created
  /jobs   → list recent jobs with action buttons (details, cancel, pause, resume)
  /credits → credit balance
  /help   → command reference
"""

import logging
from datetime import datetime, timezone

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    KeyboardButton,
    BotCommand,
)
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
from sqlalchemy import select, func

from app.config import get_settings
from app.database import async_session
from app.models.user import User
from app.models.job import ScrapingJob
from app.models.credit import CreditBalance
from app.models.platform import Platform
from app.utils.security import decode_token

logger = logging.getLogger(__name__)

# Persistent reply keyboard shown to linked users
MAIN_KEYBOARD = ReplyKeyboardMarkup(
    [
        [KeyboardButton("\U0001F680 New Job"), KeyboardButton("\U0001F4CB My Jobs")],
        [KeyboardButton("\U0001F4B3 Credits"), KeyboardButton("\u2753 Help")],
    ],
    resize_keyboard=True,
    is_persistent=True,
)

STATUS_ICONS = {
    "completed": "\u2705",
    "running": "\U0001F504",
    "failed": "\u274C",
    "queued": "\u23F3",
    "pending": "\u23F3",
    "scheduled": "\U0001F4C5",
    "cancelled": "\u26D4",
    "paused": "\u23F8",
}

# ── Platform / scrape-type registry (mirrors frontend PLATFORMS) ─────────

SCRAPE_TYPES = {
    "facebook": [
        {
            "id": "comment_scraper",
            "label": "\U0001F4AC Comment Profile Scraper",
            "short": "Comment Scraper",
            "desc": "Extract commenter profiles from any post",
            "input_prompt": (
                "Send me the <b>post URL or ID</b> to scrape.\n\n"
                "<i>Supported: page posts, group posts, video posts, photo posts, reels</i>\n\n"
                "Example:\n<code>https://www.facebook.com/page/posts/123456789</code>"
            ),
            "job_type": "full_pipeline",
            "input_type": "post_url",
        },
        {
            "id": "post_discovery",
            "label": "\U0001F50D Page Post Discovery",
            "short": "Post Discovery",
            "desc": "Discover all posts from a page, group, or profile",
            "input_prompt": (
                "Send me the <b>Page ID, username, or URL</b>.\n\n"
                "<i>Supported: page IDs, usernames, @handles, group URLs, profile URLs</i>\n\n"
                "Example:\n<code>https://facebook.com/pagename</code>"
            ),
            "job_type": "post_discovery",
            "input_type": "page_id",
        },
    ],
}


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_user_by_chat_id(chat_id: str) -> User | None:
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.telegram_chat_id == str(chat_id))
        )
        return result.scalar_one_or_none()


async def _require_user(update: Update) -> User | None:
    """Get linked user or send auth prompt. Returns None if unlinked."""
    chat_id = str(update.effective_chat.id)
    user = await _get_user_by_chat_id(chat_id)
    if not user:
        msg = update.message or update.callback_query.message
        await msg.reply_text(
            "\u26A0\uFE0F Your Telegram account is not linked.\n\n"
            "Go to <b>Settings</b> in the SocyBase dashboard and click "
            "<b>Link Telegram</b> to get started.",
            parse_mode="HTML",
        )
    return user


def _progress_bar(pct: float, width: int = 10) -> str:
    filled = int(round(pct / 100 * width))
    return "\u2588" * filled + "\u2591" * (width - filled)


def _job_detail_text(job: ScrapingJob) -> str:
    """Build rich job detail text."""
    icon = STATUS_ICONS.get(job.status, "\u26AA")
    short_id = str(job.id)[:8]
    pct = float(job.progress_pct or 0)

    lines = [
        f"{icon} <b>Job {short_id}...</b>\n",
        f"<b>Type:</b> {job.job_type or 'full_pipeline'}",
        f"<b>Input:</b> <code>{(job.input_value or '')[:60]}</code>",
        f"<b>Status:</b> {job.status.upper()}",
    ]

    if job.status in ("running", "completed", "failed", "paused"):
        bar = _progress_bar(pct)
        lines.append(f"<b>Progress:</b> [{bar}] {pct:.0f}%")
        lines.append(
            f"<b>Items:</b> {job.processed_items or 0}/{job.total_items or '?'}"
            f" ({job.failed_items or 0} failed)"
        )

    if job.credits_used:
        lines.append(f"<b>Credits:</b> {job.credits_used:,}")
    if job.result_row_count:
        lines.append(f"<b>Results:</b> {job.result_row_count:,} profiles")
    if job.created_at:
        lines.append(f"<b>Created:</b> {job.created_at.strftime('%Y-%m-%d %H:%M')}")
    if job.error_message:
        lines.append(f"\n\u26A0\uFE0F <b>Error:</b> {job.error_message[:200]}")

    return "\n".join(lines)


def _job_action_buttons(job: ScrapingJob) -> InlineKeyboardMarkup:
    """Build action buttons based on current job status."""
    buttons = []
    jid = str(job.id)

    if job.status == "running":
        buttons.append([
            InlineKeyboardButton("\u23F8 Pause", callback_data=f"action:pause:{jid}"),
            InlineKeyboardButton("\u274C Cancel", callback_data=f"action:cancel:{jid}"),
        ])
    elif job.status == "paused":
        buttons.append([
            InlineKeyboardButton("\u25B6\uFE0F Resume", callback_data=f"action:resume:{jid}"),
            InlineKeyboardButton("\u274C Cancel", callback_data=f"action:cancel:{jid}"),
        ])
    elif job.status in ("failed",):
        pipeline_state = (job.error_details or {}).get("pipeline_state")
        if pipeline_state:
            buttons.append([
                InlineKeyboardButton("\U0001F504 Retry", callback_data=f"action:resume:{jid}"),
            ])
    elif job.status == "queued":
        buttons.append([
            InlineKeyboardButton("\u274C Cancel", callback_data=f"action:cancel:{jid}"),
        ])

    # Always add refresh button for active jobs
    if job.status in ("running", "queued", "paused"):
        buttons.append([
            InlineKeyboardButton("\U0001F504 Refresh", callback_data=f"job:{jid}"),
        ])

    buttons.append([
        InlineKeyboardButton("\u2B05\uFE0F Back to Jobs", callback_data="back:jobs"),
    ])

    return InlineKeyboardMarkup(buttons)


# ── /start ───────────────────────────────────────────────────────────────


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Link Telegram account to SocyBase via deep link token."""
    chat_id = str(update.effective_chat.id)

    # Check if already linked
    user = await _get_user_by_chat_id(chat_id)
    if user:
        await update.message.reply_text(
            f"\u2705 Linked to <b>{user.email}</b>\n\n"
            "Use the buttons below or type a command to get started.",
            parse_mode="HTML",
            reply_markup=MAIN_KEYBOARD,
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
                        f"\u2705 Account linked to <b>{user.email}</b>!\n\n"
                        "You can now manage scraping jobs directly from Telegram.\n"
                        "Use the buttons below to get started!",
                        parse_mode="HTML",
                        reply_markup=MAIN_KEYBOARD,
                    )
                    return
        await update.message.reply_text(
            "\u274C Invalid or expired link token.\n\n"
            "Go to <b>Settings</b> in the SocyBase dashboard and click "
            "<b>Link Telegram</b> to generate a new link.",
            parse_mode="HTML",
        )
    else:
        await update.message.reply_text(
            "\U0001F44B <b>Welcome to SocyBase Bot!</b>\n\n"
            "This bot lets you create and manage scraping jobs, "
            "check credits, and receive notifications — all from Telegram.\n\n"
            "<b>Getting started:</b>\n"
            "1. Open the SocyBase dashboard\n"
            "2. Go to <b>Settings</b>\n"
            "3. Click <b>Link Telegram</b>\n"
            "4. Click the link to connect your account\n\n"
            "Once linked, type /help to see available commands.",
            parse_mode="HTML",
        )


# ── /help ────────────────────────────────────────────────────────────────


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show command reference."""
    await update.message.reply_text(
        "\U0001F4D6 <b>SocyBase Bot Commands</b>\n\n"
        "<b>Job Management:</b>\n"
        "/newjob — Create a new scraping job\n"
        "  1. Choose a platform (Facebook, etc.)\n"
        "  2. Choose a scrape type\n"
        "  3. Send the URL or ID\n"
        "  4. Job is created and starts automatically\n\n"
        "/jobs — List your 5 most recent jobs\n"
        "  \u2022 Tap a job to see details\n"
        "  \u2022 Use action buttons to pause/cancel/resume\n\n"
        "/status <i>job_id</i> — Check a specific job\n\n"
        "<b>Account:</b>\n"
        "/credits — Check your credit balance\n"
        "/cancel — Cancel current operation\n"
        "/help — Show this message\n\n"
        "<b>Notifications:</b>\n"
        "You'll automatically receive a message when a job completes or fails.",
        parse_mode="HTML",
    )


# ── /cancel ──────────────────────────────────────────────────────────────


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel current new-job flow."""
    cleared = False
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
        if context.user_data.pop(key, None) is not None:
            cleared = True
    if cleared:
        await update.message.reply_text("\u274C Job creation cancelled.")
    else:
        await update.message.reply_text("Nothing to cancel. Use /newjob to start a new job.")


# ── /jobs ────────────────────────────────────────────────────────────────


async def jobs_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List recent scraping jobs."""
    user = await _require_user(update)
    if not user:
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
        await update.message.reply_text(
            "No jobs found.\n\nUse /newjob to create your first scraping job!",
        )
        return

    lines = ["\U0001F4CB <b>Your Recent Jobs</b>\n"]
    buttons = []
    for job in jobs:
        icon = STATUS_ICONS.get(job.status, "\u26AA")
        short_id = str(job.id)[:8]
        pct = float(job.progress_pct or 0)
        jtype = "Discovery" if job.job_type == "post_discovery" else "Comments"
        lines.append(
            f"{icon} <code>{short_id}</code> {jtype} — {job.status} "
            f"({job.processed_items or 0}/{job.total_items or '?'} · {pct:.0f}%)"
        )
        buttons.append([
            InlineKeyboardButton(
                f"{icon} {short_id}... — {jtype}",
                callback_data=f"job:{job.id}",
            )
        ])

    buttons.append([
        InlineKeyboardButton("\u2795 New Job", callback_data="newjob:start"),
    ])

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ── /credits ─────────────────────────────────────────────────────────────


async def credits_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check credit balance."""
    user = await _require_user(update)
    if not user:
        return

    async with async_session() as db:
        result = await db.execute(
            select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
        )
        balance = result.scalar_one_or_none()

        # Count active jobs
        active = (await db.execute(
            select(func.count(ScrapingJob.id)).where(
                ScrapingJob.user_id == user.id,
                ScrapingJob.status.in_(["running", "queued"]),
            )
        )).scalar() or 0

    if balance:
        await update.message.reply_text(
            "\U0001F4B3 <b>Credit Balance</b>\n\n"
            f"Available: <b>{balance.balance:,}</b>\n"
            f"Lifetime purchased: {balance.lifetime_purchased:,}\n"
            f"Lifetime used: {balance.lifetime_used:,}\n\n"
            f"\U0001F504 Active jobs: {active}",
            parse_mode="HTML",
        )
    else:
        await update.message.reply_text("No credit balance found.")


# ── /status <job_id> ─────────────────────────────────────────────────────


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check status of a specific job."""
    user = await _require_user(update)
    if not user:
        return

    if not context.args:
        await update.message.reply_text(
            "Usage: /status <code>job_id</code>\n\n"
            "Tip: Use /jobs to see your recent jobs and tap one for details.",
            parse_mode="HTML",
        )
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
        _job_detail_text(job),
        parse_mode="HTML",
        reply_markup=_job_action_buttons(job),
    )


# ── /newjob ──────────────────────────────────────────────────────────────


async def newjob_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start creating a new scraping job — step 1: choose platform."""
    user = await _require_user(update)
    if not user:
        return

    # Clear any previous flow state
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
        context.user_data.pop(key, None)

    await _send_platform_picker(update.message, context)


async def _send_platform_picker(message, context: ContextTypes.DEFAULT_TYPE):
    """Send the platform selection keyboard."""
    async with async_session() as db:
        result = await db.execute(
            select(Platform).where(Platform.is_enabled == True)
        )
        platforms = result.scalars().all()

    keyboard = []
    for p in platforms:
        scrape_count = len(SCRAPE_TYPES.get(p.name, []))
        keyboard.append([
            InlineKeyboardButton(
                f"{p.display_name} ({scrape_count} type{'s' if scrape_count != 1 else ''})",
                callback_data=f"platform:{p.name}",
            )
        ])

    keyboard.append([InlineKeyboardButton("\u274C Cancel", callback_data="newjob:cancel")])

    await message.reply_text(
        "\U0001F680 <b>New Scraping Job</b>\n\n"
        "<b>Step 1/3:</b> Choose a platform:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── Callback Handler ─────────────────────────────────────────────────────


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline keyboard button presses."""
    query = update.callback_query
    await query.answer()
    data = query.data

    # ── Job detail ───────────────────────────────────────────────
    if data.startswith("job:"):
        job_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            await query.edit_message_text("Please link your account first. See /start")
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
            _job_detail_text(job),
            parse_mode="HTML",
            reply_markup=_job_action_buttons(job),
        )

    # ── Back to jobs list ────────────────────────────────────────
    elif data == "back:jobs":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
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
            await query.edit_message_text("No jobs found. Use /newjob to create one.")
            return

        lines = ["\U0001F4CB <b>Your Recent Jobs</b>\n"]
        buttons = []
        for job in jobs:
            icon = STATUS_ICONS.get(job.status, "\u26AA")
            short_id = str(job.id)[:8]
            pct = float(job.progress_pct or 0)
            jtype = "Discovery" if job.job_type == "post_discovery" else "Comments"
            lines.append(
                f"{icon} <code>{short_id}</code> {jtype} — {job.status} "
                f"({job.processed_items or 0}/{job.total_items or '?'} · {pct:.0f}%)"
            )
            buttons.append([
                InlineKeyboardButton(
                    f"{icon} {short_id}... — {jtype}",
                    callback_data=f"job:{job.id}",
                )
            ])
        buttons.append([
            InlineKeyboardButton("\u2795 New Job", callback_data="newjob:start"),
        ])

        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
        )

    # ── Job actions (pause, cancel, resume) ──────────────────────
    elif data.startswith("action:"):
        parts = data.split(":", 2)
        action = parts[1]
        job_id = parts[2]

        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
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

            if action == "cancel":
                if job.status in ("running", "queued", "paused"):
                    job.status = "cancelled"
                    await db.commit()
                    await query.edit_message_text(
                        f"\u274C <b>Job {str(job.id)[:8]}... cancelled.</b>\n\n"
                        f"Credits used: {job.credits_used or 0}",
                        parse_mode="HTML",
                        reply_markup=InlineKeyboardMarkup([[
                            InlineKeyboardButton("\u2B05\uFE0F Back to Jobs", callback_data="back:jobs"),
                        ]]),
                    )
                else:
                    await query.answer(f"Cannot cancel a {job.status} job.", show_alert=True)

            elif action == "pause":
                if job.status == "running":
                    job.status = "paused"
                    await db.commit()
                    # Refresh detail view
                    await query.edit_message_text(
                        _job_detail_text(job),
                        parse_mode="HTML",
                        reply_markup=_job_action_buttons(job),
                    )
                else:
                    await query.answer(f"Cannot pause a {job.status} job.", show_alert=True)

            elif action == "resume":
                if job.status in ("failed", "paused"):
                    pipeline_state = (job.error_details or {}).get("pipeline_state")
                    if not pipeline_state and job.status == "failed":
                        await query.answer("No checkpoint data to resume from.", show_alert=True)
                        return

                    if job.status == "paused":
                        job.status = "running"
                        await db.commit()
                    else:
                        # Create retry job for failed
                        new_job = ScrapingJob(
                            tenant_id=job.tenant_id,
                            user_id=user.id,
                            platform_id=job.platform_id,
                            job_type=job.job_type,
                            input_type=job.input_type,
                            input_value=job.input_value,
                            input_metadata=job.input_metadata,
                            settings={
                                **(job.settings or {}),
                                "resume_from_job_id": str(job.id),
                                "profile_retry_count": 2,
                            },
                            status="queued",
                        )
                        db.add(new_job)
                        await db.flush()

                        if job.job_type == "post_discovery":
                            from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
                            task = run_post_discovery_pipeline.delay(str(new_job.id))
                        else:
                            from app.scraping.pipeline import run_scraping_pipeline
                            task = run_scraping_pipeline.delay(str(new_job.id))

                        new_job.celery_task_id = task.id
                        await db.commit()
                        job = new_job  # Show the new job

                    await query.edit_message_text(
                        _job_detail_text(job),
                        parse_mode="HTML",
                        reply_markup=_job_action_buttons(job),
                    )
                else:
                    await query.answer(f"Cannot resume a {job.status} job.", show_alert=True)

    # ── New job: start ───────────────────────────────────────────
    elif data == "newjob:start":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return
        for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
            context.user_data.pop(key, None)

        async with async_session() as db:
            result = await db.execute(
                select(Platform).where(Platform.is_enabled == True)
            )
            platforms = result.scalars().all()

        keyboard = []
        for p in platforms:
            scrape_count = len(SCRAPE_TYPES.get(p.name, []))
            keyboard.append([
                InlineKeyboardButton(
                    f"{p.display_name} ({scrape_count} type{'s' if scrape_count != 1 else ''})",
                    callback_data=f"platform:{p.name}",
                )
            ])
        keyboard.append([InlineKeyboardButton("\u274C Cancel", callback_data="newjob:cancel")])

        await query.edit_message_text(
            "\U0001F680 <b>New Scraping Job</b>\n\n"
            "<b>Step 1/3:</b> Choose a platform:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── New job: cancel ──────────────────────────────────────────
    elif data == "newjob:cancel":
        for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
            context.user_data.pop(key, None)
        await query.edit_message_text("\u274C Job creation cancelled.")

    # ── New job: platform selected ───────────────────────────────
    elif data.startswith("platform:"):
        platform_name = data.split(":", 1)[1]
        scrape_types = SCRAPE_TYPES.get(platform_name, [])

        if not scrape_types:
            await query.edit_message_text(
                f"No scrape types available for {platform_name}.",
            )
            return

        context.user_data["new_job_platform"] = platform_name

        # If only one scrape type, auto-select it
        if len(scrape_types) == 1:
            st = scrape_types[0]
            context.user_data["new_job_scrape_type"] = st["id"]
            context.user_data["new_job_awaiting_input"] = True
            await query.edit_message_text(
                f"\U0001F680 <b>New Scraping Job</b>\n\n"
                f"<b>Platform:</b> {platform_name.title()}\n"
                f"<b>Type:</b> {st['short']}\n\n"
                f"<b>Step 3/3:</b> {st['input_prompt']}\n\n"
                f"<i>Send /cancel to abort.</i>",
                parse_mode="HTML",
            )
            return

        keyboard = []
        for st in scrape_types:
            keyboard.append([
                InlineKeyboardButton(
                    st["label"],
                    callback_data=f"scrape:{st['id']}",
                )
            ])
        keyboard.append([
            InlineKeyboardButton("\u2B05\uFE0F Back", callback_data="newjob:start"),
        ])

        await query.edit_message_text(
            f"\U0001F680 <b>New Scraping Job</b>\n\n"
            f"<b>Platform:</b> {platform_name.title()}\n\n"
            f"<b>Step 2/3:</b> Choose a scrape type:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── New job: scrape type selected ────────────────────────────
    elif data.startswith("scrape:"):
        scrape_type_id = data.split(":", 1)[1]
        platform_name = context.user_data.get("new_job_platform")

        if not platform_name:
            await query.edit_message_text("Session expired. Use /newjob to start over.")
            return

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)

        if not st:
            await query.edit_message_text("Invalid scrape type. Use /newjob to start over.")
            return

        context.user_data["new_job_scrape_type"] = scrape_type_id
        context.user_data["new_job_awaiting_input"] = True

        await query.edit_message_text(
            f"\U0001F680 <b>New Scraping Job</b>\n\n"
            f"<b>Platform:</b> {platform_name.title()}\n"
            f"<b>Type:</b> {st['short']}\n\n"
            f"<b>Step 3/3:</b> {st['input_prompt']}\n\n"
            f"<i>Send /cancel to abort.</i>",
            parse_mode="HTML",
        )


# ── Message Handler (for URL / input during job creation) ────────────────


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages — keyboard buttons and URL input during /newjob flow."""
    text = (update.message.text or "").strip()

    # ── Handle persistent keyboard button presses ────────────────
    if text == "\U0001F680 New Job":
        return await newjob_command(update, context)
    elif text == "\U0001F4CB My Jobs":
        return await jobs_command(update, context)
    elif text == "\U0001F4B3 Credits":
        return await credits_command(update, context)
    elif text == "\u2753 Help":
        return await help_command(update, context)

    # ── URL/input during job creation flow ────────────────────────
    if not context.user_data.get("new_job_awaiting_input"):
        await update.message.reply_text(
            "Use the buttons below or type /help for commands.",
            reply_markup=MAIN_KEYBOARD,
        )
        return

    user = await _require_user(update)
    if not user:
        return

    platform_name = context.user_data.get("new_job_platform")
    scrape_type_id = context.user_data.get("new_job_scrape_type")

    if not platform_name or not scrape_type_id:
        await update.message.reply_text("Session expired. Use /newjob to start over.")
        for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
            context.user_data.pop(key, None)
        return

    scrape_types = SCRAPE_TYPES.get(platform_name, [])
    st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)
    if not st:
        await update.message.reply_text("Invalid configuration. Use /newjob to start over.")
        for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
            context.user_data.pop(key, None)
        return

    input_value = update.message.text.strip()

    # Basic validation
    if not input_value:
        await update.message.reply_text("Please send a valid URL or ID.")
        return

    # Clear flow state
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
        context.user_data.pop(key, None)

    # Create the job
    async with async_session() as db:
        result = await db.execute(
            select(Platform).where(Platform.name == platform_name)
        )
        plat = result.scalar_one_or_none()
        if not plat:
            await update.message.reply_text("Platform not found. Use /newjob to start over.")
            return

        job = ScrapingJob(
            tenant_id=user.tenant_id,
            user_id=user.id,
            platform_id=plat.id,
            job_type=st["job_type"],
            input_type=st["input_type"],
            input_value=input_value,
            status="queued",
            settings={
                "include_replies": True,
                "profile_retry_count": 2,
            },
        )
        db.add(job)
        await db.flush()

        # Dispatch Celery task
        if st["job_type"] == "post_discovery":
            from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
            task = run_post_discovery_pipeline.delay(str(job.id))
        else:
            from app.scraping.pipeline import run_scraping_pipeline
            task = run_scraping_pipeline.delay(str(job.id))

        job.celery_task_id = task.id
        await db.commit()

        short_id = str(job.id)[:8]
        await update.message.reply_text(
            f"\u2705 <b>Job Created!</b>\n\n"
            f"<b>ID:</b> <code>{short_id}...</code>\n"
            f"<b>Platform:</b> {platform_name.title()}\n"
            f"<b>Type:</b> {st['short']}\n"
            f"<b>Input:</b> <code>{input_value[:60]}</code>\n\n"
            f"\u23F3 Job is queued and will start shortly.\n"
            f"You'll receive a notification when it completes.\n\n"
            f"Use /status {job.id} or tap below to track progress:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton(f"\U0001F4CA View Job", callback_data=f"job:{job.id}")],
                [InlineKeyboardButton("\U0001F4CB My Jobs", callback_data="back:jobs")],
            ]),
        )


# ── Bot Application Builder ──────────────────────────────────────────────


async def _post_init(app: Application) -> None:
    """Set bot commands menu after startup."""
    await app.bot.set_my_commands([
        BotCommand("newjob", "Create a new scraping job"),
        BotCommand("jobs", "List your recent jobs"),
        BotCommand("credits", "Check credit balance"),
        BotCommand("status", "Check a specific job status"),
        BotCommand("help", "Show all commands"),
        BotCommand("cancel", "Cancel current operation"),
    ])


def create_bot_app() -> Application:
    """Build and configure the Telegram bot application."""
    settings = get_settings()
    if not settings.telegram_bot_token:
        raise ValueError("TELEGRAM_BOT_TOKEN is not set")

    app = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .post_init(_post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("jobs", jobs_command))
    app.add_handler(CommandHandler("credits", credits_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("newjob", newjob_command))
    app.add_handler(CommandHandler("cancel", cancel_command))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    return app
