"""SocyBase Telegram Bot — remote job management, traffic bot orders, and notifications.

Mirrors the webapp flow:
  /login  → email → OTP code → account linked
  /newjob → select platform → select scrape type → send input → job created
  /jobs   → list recent jobs with action buttons (details, cancel, pause, resume)
  /credits → credit balance
  /tborder  → select category → select service → enter link → enter qty → confirm
  /tborders → list recent traffic bot orders with action buttons
  /tbwallet → traffic bot wallet balance
  /help   → command reference
"""

import logging
import re
import secrets
import time

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
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import async_session
from app.models.user import User
from app.models.job import ScrapingJob
from app.models.credit import CreditBalance
from app.models.platform import Platform
from app.models.traffic_bot import TrafficBotOrder
from app.services import traffic_bot_service as tb_svc
from app.services.email_sender import send_email
from app.utils.security import decode_token

logger = logging.getLogger(__name__)

# Persistent reply keyboard shown to linked users
MAIN_KEYBOARD = ReplyKeyboardMarkup(
    [
        [KeyboardButton("\U0001F680 New Job"), KeyboardButton("\U0001F4CB My Jobs")],
        [KeyboardButton("\U0001F4E6 TB Order"), KeyboardButton("\U0001F4CA TB Orders")],
        [KeyboardButton("\U0001F4B3 Credits"), KeyboardButton("\U0001F4B0 TB Wallet")],
        [KeyboardButton("\u2753 Help")],
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

TB_STATUS_ICONS = {
    "pending": "\u23F3",
    "processing": "\U0001F504",
    "in_progress": "\U0001F504",
    "completed": "\u2705",
    "partial": "\u26A0\uFE0F",
    "cancelled": "\u26D4",
    "refunded": "\U0001F4B8",
    "failed": "\u274C",
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

TB_SERVICES_PER_PAGE = 8

# ── Login / OTP constants ────────────────────────────────────────────────

MAX_LOGIN_ATTEMPTS = 5
LOGIN_COOLDOWN_SECONDS = 300  # 5 min
MAX_OTP_RESENDS = 3
OTP_EXPIRY_SECONDS = 300  # 5 min

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _generate_otp() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def _clear_login_flow(context: ContextTypes.DEFAULT_TYPE):
    """Clear all login flow state."""
    for key in ["login_awaiting_email", "login_awaiting_otp",
                "login_email", "login_otp", "login_otp_expires",
                "login_otp_resends"]:
        context.user_data.pop(key, None)


def _mask_email(email: str) -> str:
    """Mask email: j***n@gmail.com"""
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked = local[0] + "***"
    else:
        masked = local[0] + "***" + local[-1]
    return f"{masked}@{domain}"


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
            "Use /login to link your SocyBase account, "
            "or go to <b>Settings</b> in the dashboard and click "
            "<b>Link Telegram</b>.",
            parse_mode="HTML",
        )
    return user


def _clear_tb_flow(context: ContextTypes.DEFAULT_TYPE):
    """Clear all traffic bot order flow state."""
    for key in ["tb_category", "tb_service_id", "tb_service_name",
                "tb_link", "tb_quantity", "tb_awaiting_link", "tb_awaiting_quantity"]:
        context.user_data.pop(key, None)


def _clear_job_flow(context: ContextTypes.DEFAULT_TYPE):
    """Clear all scraping job creation flow state."""
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input"]:
        context.user_data.pop(key, None)


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


def _tb_order_detail_text(order: TrafficBotOrder) -> str:
    """Build rich traffic bot order detail text."""
    icon = TB_STATUS_ICONS.get(order.status, "\u26AA")
    short_id = str(order.id)[:8]
    svc_name = order.service.name if order.service else "Unknown"

    lines = [
        f"{icon} <b>TB Order {short_id}...</b>\n",
        f"<b>Service:</b> {svc_name}",
        f"<b>Link:</b> <code>{(order.link or '')[:60]}</code>",
        f"<b>Quantity:</b> {order.quantity:,}",
        f"<b>Cost:</b> RM{float(order.total_cost):.4f}",
        f"<b>Status:</b> {order.status.upper().replace('_', ' ')}",
    ]

    if order.start_count is not None:
        lines.append(f"<b>Start Count:</b> {order.start_count:,}")
    if order.remains is not None:
        lines.append(f"<b>Remains:</b> {order.remains:,}")
    if order.external_order_id:
        lines.append(f"<b>Ext. ID:</b> {order.external_order_id}")
    if order.created_at:
        lines.append(f"<b>Created:</b> {order.created_at.strftime('%Y-%m-%d %H:%M')}")
    if order.error_message:
        lines.append(f"\n\u26A0\uFE0F <b>Error:</b> {order.error_message[:200]}")

    return "\n".join(lines)


def _tb_order_action_buttons(order: TrafficBotOrder) -> InlineKeyboardMarkup:
    """Build action buttons for a traffic bot order."""
    buttons = []
    oid = str(order.id)

    if order.status in ("pending", "processing", "in_progress"):
        buttons.append([
            InlineKeyboardButton("\U0001F504 Refresh Status", callback_data=f"tb_refresh:{oid}"),
        ])
    if order.status in ("pending", "processing", "in_progress"):
        buttons.append([
            InlineKeyboardButton("\u274C Cancel Order", callback_data=f"tb_cancel_order:{oid}"),
        ])
    if order.status == "completed":
        buttons.append([
            InlineKeyboardButton("\U0001F504 Refill", callback_data=f"tb_refill:{oid}"),
        ])

    buttons.append([
        InlineKeyboardButton("\u2B05\uFE0F Back to Orders", callback_data="tb_back:orders"),
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
                        "You can now manage scraping jobs and traffic bot orders "
                        "directly from Telegram.\n"
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
            "place traffic bot orders, check credits, and receive "
            "notifications \u2014 all from Telegram.\n\n"
            "<b>To get started, log in with your SocyBase account:</b>\n"
            "\u27A1\uFE0F /login\n\n"
            "Or link from the dashboard via <b>Settings \u2192 Link Telegram</b>.",
            parse_mode="HTML",
        )


# ── /help ────────────────────────────────────────────────────────────────


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show command reference."""
    await update.message.reply_text(
        "\U0001F4D6 <b>SocyBase Bot Commands</b>\n\n"
        "<b>Scraping Jobs:</b>\n"
        "/newjob \u2014 Create a new scraping job\n"
        "/jobs \u2014 List your recent scraping jobs\n"
        "/status <i>job_id</i> \u2014 Check a specific job\n\n"
        "<b>Traffic Bot:</b>\n"
        "/tborder \u2014 Place a traffic bot order\n"
        "/tborders \u2014 View your recent TB orders\n"
        "/tbwallet \u2014 Check TB wallet balance\n\n"
        "<b>Account:</b>\n"
        "/login \u2014 Log in with email & OTP code\n"
        "/unlink \u2014 Disconnect your Telegram\n"
        "/credits \u2014 Check scraping credit balance\n"
        "/cancel \u2014 Cancel current operation\n"
        "/help \u2014 Show this message\n\n"
        "<b>Notifications:</b>\n"
        "You'll receive messages when jobs complete or fail, "
        "and confirmations for traffic bot orders.",
        parse_mode="HTML",
    )


# ── /cancel ──────────────────────────────────────────────────────────────


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel current flow."""
    cleared = False
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input",
                "tb_category", "tb_service_id", "tb_service_name",
                "tb_link", "tb_quantity", "tb_awaiting_link", "tb_awaiting_quantity",
                "login_awaiting_email", "login_awaiting_otp",
                "login_email", "login_otp", "login_otp_expires", "login_otp_resends"]:
        if context.user_data.pop(key, None) is not None:
            cleared = True
    if cleared:
        await update.message.reply_text("\u274C Operation cancelled.")
    else:
        await update.message.reply_text("Nothing to cancel.")


# ── /login ──────────────────────────────────────────────────────────────


async def login_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start the email + OTP login flow."""
    chat_id = str(update.effective_chat.id)

    # Already linked?
    user = await _get_user_by_chat_id(chat_id)
    if user:
        await update.message.reply_text(
            f"\u2705 Already linked to <b>{user.email}</b>.\n\n"
            "Use /unlink to disconnect first.",
            parse_mode="HTML",
            reply_markup=MAIN_KEYBOARD,
        )
        return

    # Check cooldown
    cooldown_until = context.user_data.get("login_cooldown_until", 0)
    if time.time() < cooldown_until:
        remaining = int(cooldown_until - time.time())
        await update.message.reply_text(
            f"\u23F3 Too many failed attempts. Try again in {remaining}s."
        )
        return

    # Clear any stale login state
    _clear_login_flow(context)

    context.user_data["login_awaiting_email"] = True
    await update.message.reply_text(
        "\U0001F511 <b>Log in to SocyBase</b>\n\n"
        "Enter your <b>email address</b>:\n\n"
        "<i>Send /cancel to abort.</i>",
        parse_mode="HTML",
    )


# ── /unlink ─────────────────────────────────────────────────────────────


async def unlink_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Disconnect Telegram from SocyBase account."""
    chat_id = str(update.effective_chat.id)

    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.telegram_chat_id == chat_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            await update.message.reply_text(
                "Your Telegram is not linked to any account."
            )
            return

        email = user.email
        user.telegram_chat_id = None
        await db.commit()

    _clear_login_flow(context)
    await update.message.reply_text(
        f"\u2705 Telegram disconnected from <b>{email}</b>.\n\n"
        "Use /login to link a different account.",
        parse_mode="HTML",
    )


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
            f"{icon} <code>{short_id}</code> {jtype} \u2014 {job.status} "
            f"({job.processed_items or 0}/{job.total_items or '?'} \u00B7 {pct:.0f}%)"
        )
        buttons.append([
            InlineKeyboardButton(
                f"{icon} {short_id}... \u2014 {jtype}",
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
    _clear_job_flow(context)
    _clear_tb_flow(context)

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


# ── /tbwallet ────────────────────────────────────────────────────────────


async def tbwallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check traffic bot wallet balance."""
    user = await _require_user(update)
    if not user:
        return

    async with async_session() as db:
        wallet = await tb_svc.get_or_create_wallet(db, user.tenant_id)
        await db.commit()

    await update.message.reply_text(
        "\U0001F4B0 <b>Traffic Bot Wallet</b>\n\n"
        f"Balance: <b>RM{float(wallet.balance):.2f}</b>\n\n"
        "<i>To deposit funds, use the SocyBase dashboard \u2192 Traffic Bot \u2192 Wallet.</i>",
        parse_mode="HTML",
    )


# ── /tborder ─────────────────────────────────────────────────────────────


async def tborder_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start placing a traffic bot order — step 1: choose category."""
    user = await _require_user(update)
    if not user:
        return

    _clear_tb_flow(context)
    _clear_job_flow(context)

    async with async_session() as db:
        categories = await tb_svc.get_categories(db)

    if not categories:
        await update.message.reply_text(
            "No traffic bot services available. Please try again later.",
        )
        return

    keyboard = []
    for cat in categories:
        keyboard.append([
            InlineKeyboardButton(cat, callback_data=f"tb_cat:{cat}")
        ])
    keyboard.append([InlineKeyboardButton("\u274C Cancel", callback_data="tb_cancel_flow")])

    await update.message.reply_text(
        "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
        "<b>Step 1/4:</b> Choose a category:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── /tborders ────────────────────────────────────────────────────────────


async def tborders_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List recent traffic bot orders."""
    user = await _require_user(update)
    if not user:
        return

    async with async_session() as db:
        orders, total = await tb_svc.list_orders(db, user.tenant_id, limit=5)

    if not orders:
        await update.message.reply_text(
            "No traffic bot orders found.\n\nUse /tborder to place your first order!",
        )
        return

    lines = [f"\U0001F4CA <b>Your Recent TB Orders</b> ({total} total)\n"]
    buttons = []
    for order in orders:
        icon = TB_STATUS_ICONS.get(order.status, "\u26AA")
        short_id = str(order.id)[:8]
        svc_name = (order.service.name if order.service else "Unknown")[:25]
        lines.append(
            f"{icon} <code>{short_id}</code> {svc_name} \u2014 {order.status}"
        )
        buttons.append([
            InlineKeyboardButton(
                f"{icon} {short_id}... \u2014 {svc_name}",
                callback_data=f"tb_order:{order.id}",
            )
        ])

    buttons.append([
        InlineKeyboardButton("\u2795 New Order", callback_data="tb_start_order"),
    ])

    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


# ── Callback Handler ─────────────────────────────────────────────────────


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline keyboard button presses."""
    query = update.callback_query
    await query.answer()
    data = query.data

    # ── Login: resend OTP ─────────────────────────────────────────
    if data == "login:resend_otp":
        email = context.user_data.get("login_email")
        if not email or not context.user_data.get("login_awaiting_otp"):
            await query.edit_message_text(
                "Login session expired. Use /login to start again."
            )
            return

        resends = context.user_data.get("login_otp_resends", 0)
        if resends >= MAX_OTP_RESENDS:
            await query.edit_message_text(
                "\u26D4 Maximum resends reached. Use /login to start a new session."
            )
            _clear_login_flow(context)
            return

        # Generate new OTP and resend
        otp = _generate_otp()
        context.user_data["login_otp"] = otp
        context.user_data["login_otp_expires"] = time.time() + OTP_EXPIRY_SECONDS
        context.user_data["login_otp_resends"] = resends + 1

        sent = await send_email(
            to=email,
            subject="SocyBase Telegram Login Code",
            body_text=f"Your verification code is: {otp}\n\nThis code expires in 5 minutes.",
            body_html=(
                f"<h2>SocyBase Telegram Verification</h2>"
                f"<p>Your verification code is:</p>"
                f"<h1 style='letter-spacing:8px;font-family:monospace'>{otp}</h1>"
                f"<p>This code expires in 5 minutes.</p>"
                f"<p>If you didn't request this, you can safely ignore this email.</p>"
            ),
        )

        masked = _mask_email(email)
        if sent:
            remaining_resends = MAX_OTP_RESENDS - resends - 1
            await query.edit_message_text(
                f"\U0001F504 New code sent to <b>{masked}</b>.\n\n"
                f"Enter the 6-digit code below:\n"
                f"<i>({remaining_resends} resend{'s' if remaining_resends != 1 else ''} remaining)</i>\n\n"
                "<i>Send /cancel to abort.</i>",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("\U0001F504 Resend Code", callback_data="login:resend_otp"),
                ]]) if remaining_resends > 0 else None,
            )
        else:
            await query.edit_message_text(
                "\u274C Failed to resend email. Try /login again later."
            )
            _clear_login_flow(context)
        return

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
                f"{icon} <code>{short_id}</code> {jtype} \u2014 {job.status} "
                f"({job.processed_items or 0}/{job.total_items or '?'} \u00B7 {pct:.0f}%)"
            )
            buttons.append([
                InlineKeyboardButton(
                    f"{icon} {short_id}... \u2014 {jtype}",
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
        _clear_job_flow(context)

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
        _clear_job_flow(context)
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

    # ══════════════════════════════════════════════════════════════
    # ── TRAFFIC BOT CALLBACKS ────────────────────────────────────
    # ══════════════════════════════════════════════════════════════

    # ── TB: Start order flow (from button) ───────────────────────
    elif data == "tb_start_order":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return
        _clear_tb_flow(context)

        async with async_session() as db:
            categories = await tb_svc.get_categories(db)

        if not categories:
            await query.edit_message_text("No traffic bot services available.")
            return

        keyboard = []
        for cat in categories:
            keyboard.append([
                InlineKeyboardButton(cat, callback_data=f"tb_cat:{cat}")
            ])
        keyboard.append([InlineKeyboardButton("\u274C Cancel", callback_data="tb_cancel_flow")])

        await query.edit_message_text(
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Step 1/4:</b> Choose a category:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── TB: Cancel flow ──────────────────────────────────────────
    elif data == "tb_cancel_flow":
        _clear_tb_flow(context)
        await query.edit_message_text("\u274C Order cancelled.")

    # ── TB: Category selected ────────────────────────────────────
    elif data.startswith("tb_cat:"):
        category = data.split(":", 1)[1]
        context.user_data["tb_category"] = category

        async with async_session() as db:
            services = await tb_svc.list_services(db, enabled_only=True, category=category)

        if not services:
            await query.edit_message_text(f"No services available in {category}.")
            return

        # Paginate services
        page = 0
        total_pages = (len(services) + TB_SERVICES_PER_PAGE - 1) // TB_SERVICES_PER_PAGE
        page_services = services[:TB_SERVICES_PER_PAGE]

        keyboard = []
        for svc in page_services:
            rate_with_fee = float(svc.rate) * (1 + float(svc.fee_pct) / 100)
            label = f"{svc.name[:35]} (RM{rate_with_fee:.2f}/1K)"
            keyboard.append([
                InlineKeyboardButton(label, callback_data=f"tb_svc:{svc.id}")
            ])

        nav_row = []
        if total_pages > 1:
            nav_row.append(
                InlineKeyboardButton(f"Page 1/{total_pages} \u25B6\uFE0F", callback_data=f"tb_svc_page:{category}:1")
            )
        keyboard.append(nav_row if nav_row else [])
        keyboard.append([
            InlineKeyboardButton("\u2B05\uFE0F Back", callback_data="tb_start_order"),
            InlineKeyboardButton("\u274C Cancel", callback_data="tb_cancel_flow"),
        ])
        # Remove empty rows
        keyboard = [row for row in keyboard if row]

        await query.edit_message_text(
            f"\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            f"<b>Category:</b> {category}\n"
            f"<b>Step 2/4:</b> Choose a service ({len(services)} available):",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── TB: Service page navigation ──────────────────────────────
    elif data.startswith("tb_svc_page:"):
        parts = data.split(":", 2)
        category = parts[1]
        page = int(parts[2])

        async with async_session() as db:
            services = await tb_svc.list_services(db, enabled_only=True, category=category)

        total_pages = (len(services) + TB_SERVICES_PER_PAGE - 1) // TB_SERVICES_PER_PAGE
        start = page * TB_SERVICES_PER_PAGE
        page_services = services[start:start + TB_SERVICES_PER_PAGE]

        keyboard = []
        for svc in page_services:
            rate_with_fee = float(svc.rate) * (1 + float(svc.fee_pct) / 100)
            label = f"{svc.name[:35]} (RM{rate_with_fee:.2f}/1K)"
            keyboard.append([
                InlineKeyboardButton(label, callback_data=f"tb_svc:{svc.id}")
            ])

        nav_row = []
        if page > 0:
            nav_row.append(
                InlineKeyboardButton("\u25C0\uFE0F Prev", callback_data=f"tb_svc_page:{category}:{page - 1}")
            )
        if page < total_pages - 1:
            nav_row.append(
                InlineKeyboardButton(f"Next \u25B6\uFE0F", callback_data=f"tb_svc_page:{category}:{page + 1}")
            )
        if nav_row:
            keyboard.append(nav_row)

        keyboard.append([
            InlineKeyboardButton("\u2B05\uFE0F Back", callback_data="tb_start_order"),
            InlineKeyboardButton("\u274C Cancel", callback_data="tb_cancel_flow"),
        ])

        await query.edit_message_text(
            f"\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            f"<b>Category:</b> {category}\n"
            f"<b>Step 2/4:</b> Choose a service (page {page + 1}/{total_pages}):",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── TB: Service selected → ask for link ──────────────────────
    elif data.startswith("tb_svc:"):
        service_id = data.split(":", 1)[1]

        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            await query.edit_message_text("Service not found. Use /tborder to start over.")
            return

        context.user_data["tb_service_id"] = str(service.id)
        context.user_data["tb_service_name"] = service.name
        context.user_data["tb_awaiting_link"] = True

        rate_with_fee = float(service.rate) * (1 + float(service.fee_pct) / 100)
        await query.edit_message_text(
            f"\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            f"<b>Service:</b> {service.name}\n"
            f"<b>Rate:</b> RM{rate_with_fee:.2f} per 1K\n"
            f"<b>Min/Max:</b> {service.min_quantity:,} \u2014 {service.max_quantity:,}\n\n"
            f"<b>Step 3/4:</b> Send me the <b>target link/URL</b>:\n\n"
            f"<i>Send /cancel to abort.</i>",
            parse_mode="HTML",
        )

    # ── TB: Confirm order ────────────────────────────────────────
    elif data == "tb_confirm":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        service_id = context.user_data.get("tb_service_id")
        link = context.user_data.get("tb_link")
        quantity = context.user_data.get("tb_quantity")

        if not all([service_id, link, quantity]):
            _clear_tb_flow(context)
            await query.edit_message_text("Session expired. Use /tborder to start over.")
            return

        _clear_tb_flow(context)

        async with async_session() as db:
            try:
                order = await tb_svc.place_order(
                    db, user.tenant_id, user.id,
                    service_id, link, quantity,
                )
                await db.refresh(order, attribute_names=["service"])
                await db.commit()

                svc_name = order.service.name if order.service else "Unknown"
                short_id = str(order.id)[:8]
                icon = TB_STATUS_ICONS.get(order.status, "\u26AA")

                await query.edit_message_text(
                    f"\u2705 <b>Order Placed!</b>\n\n"
                    f"<b>ID:</b> <code>{short_id}...</code>\n"
                    f"<b>Service:</b> {svc_name}\n"
                    f"<b>Link:</b> <code>{link[:60]}</code>\n"
                    f"<b>Quantity:</b> {quantity:,}\n"
                    f"<b>Cost:</b> RM{float(order.total_cost):.4f}\n"
                    f"<b>Status:</b> {icon} {order.status.upper()}\n\n"
                    f"Your order is being processed.",
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton("\U0001F4CA View Order", callback_data=f"tb_order:{order.id}")],
                        [InlineKeyboardButton("\U0001F4CB My Orders", callback_data="tb_back:orders")],
                    ]),
                )
            except ValueError as exc:
                await query.edit_message_text(
                    f"\u274C <b>Order Failed</b>\n\n{str(exc)}\n\n"
                    f"Use /tborder to try again.",
                    parse_mode="HTML",
                )
            except Exception as exc:
                logger.error("TB order failed via Telegram: %s", exc)
                await query.edit_message_text(
                    f"\u274C <b>Order Failed</b>\n\nAn unexpected error occurred.\n\n"
                    f"Use /tborder to try again.",
                    parse_mode="HTML",
                )

    # ── TB: View order detail ────────────────────────────────────
    elif data.startswith("tb_order:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)

        if not order or order.tenant_id != user.tenant_id:
            await query.edit_message_text("Order not found.")
            return

        await query.edit_message_text(
            _tb_order_detail_text(order),
            parse_mode="HTML",
            reply_markup=_tb_order_action_buttons(order),
        )

    # ── TB: Refresh order status ─────────────────────────────────
    elif data.startswith("tb_refresh:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text("Order not found.")
                return
            order = await tb_svc.refresh_order_status(db, order)
            await db.commit()

        await query.edit_message_text(
            _tb_order_detail_text(order),
            parse_mode="HTML",
            reply_markup=_tb_order_action_buttons(order),
        )

    # ── TB: Cancel order ─────────────────────────────────────────
    elif data.startswith("tb_cancel_order:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text("Order not found.")
                return

            try:
                order = await tb_svc.cancel_order(db, order)
                await db.commit()
                await query.edit_message_text(
                    f"\u274C <b>Order {str(order.id)[:8]}... cancelled.</b>\n\n"
                    f"RM{float(order.total_cost):.4f} has been refunded to your wallet.",
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup([[
                        InlineKeyboardButton("\u2B05\uFE0F Back to Orders", callback_data="tb_back:orders"),
                    ]]),
                )
            except ValueError as exc:
                await query.answer(str(exc), show_alert=True)
            except Exception:
                await query.answer("Failed to cancel order.", show_alert=True)

    # ── TB: Refill order ─────────────────────────────────────────
    elif data.startswith("tb_refill:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text("Order not found.")
                return

            try:
                await tb_svc.refill_order(db, order)
                await query.answer("\u2705 Refill requested!", show_alert=True)
                # Refresh the detail view
                order = await tb_svc.get_order(db, order_id)
                await query.edit_message_text(
                    _tb_order_detail_text(order),
                    parse_mode="HTML",
                    reply_markup=_tb_order_action_buttons(order),
                )
            except ValueError as exc:
                await query.answer(str(exc), show_alert=True)
            except Exception:
                await query.answer("Failed to request refill.", show_alert=True)

    # ── TB: Back to orders list ──────────────────────────────────
    elif data == "tb_back:orders":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            orders, total = await tb_svc.list_orders(db, user.tenant_id, limit=5)

        if not orders:
            await query.edit_message_text("No orders found. Use /tborder to place one.")
            return

        lines = [f"\U0001F4CA <b>Your Recent TB Orders</b> ({total} total)\n"]
        buttons = []
        for order in orders:
            icon = TB_STATUS_ICONS.get(order.status, "\u26AA")
            short_id = str(order.id)[:8]
            svc_name = (order.service.name if order.service else "Unknown")[:25]
            lines.append(
                f"{icon} <code>{short_id}</code> {svc_name} \u2014 {order.status}"
            )
            buttons.append([
                InlineKeyboardButton(
                    f"{icon} {short_id}... \u2014 {svc_name}",
                    callback_data=f"tb_order:{order.id}",
                )
            ])
        buttons.append([
            InlineKeyboardButton("\u2795 New Order", callback_data="tb_start_order"),
        ])

        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
        )


# ── Message Handler (for URL / input during flows) ───────────────────────


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages — keyboard buttons and text input during flows."""
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
    elif text == "\U0001F4E6 TB Order":
        return await tborder_command(update, context)
    elif text == "\U0001F4CA TB Orders":
        return await tborders_command(update, context)
    elif text == "\U0001F4B0 TB Wallet":
        return await tbwallet_command(update, context)

    # ── Login flow: awaiting email ────────────────────────────────
    if context.user_data.get("login_awaiting_email"):
        email = text.lower().strip()
        if not EMAIL_RE.match(email):
            await update.message.reply_text(
                "That doesn't look like a valid email. Please try again:"
            )
            return

        # Look up user by email
        async with async_session() as db:
            result = await db.execute(
                select(User).where(func.lower(User.email) == email)
            )
            user = result.scalar_one_or_none()

        if not user:
            await update.message.reply_text(
                "\u274C No SocyBase account found with that email.\n"
                "Please check and try again, or /cancel to abort."
            )
            return

        # Check if this account is already linked to another Telegram
        if user.telegram_chat_id and user.telegram_chat_id != str(update.effective_chat.id):
            await update.message.reply_text(
                "\u26A0\uFE0F This account is already linked to another Telegram.\n"
                "Unlink it from the other device first via the dashboard, "
                "or /cancel to abort."
            )
            return

        # Generate and send OTP
        otp = _generate_otp()
        context.user_data["login_awaiting_email"] = False
        context.user_data["login_email"] = email
        context.user_data["login_otp"] = otp
        context.user_data["login_otp_expires"] = time.time() + OTP_EXPIRY_SECONDS
        context.user_data["login_awaiting_otp"] = True
        context.user_data["login_otp_resends"] = 0

        sent = await send_email(
            to=email,
            subject="SocyBase Telegram Login Code",
            body_text=f"Your verification code is: {otp}\n\nThis code expires in 5 minutes.",
            body_html=(
                f"<h2>SocyBase Telegram Verification</h2>"
                f"<p>Your verification code is:</p>"
                f"<h1 style='letter-spacing:8px;font-family:monospace'>{otp}</h1>"
                f"<p>This code expires in 5 minutes.</p>"
                f"<p>If you didn't request this, you can safely ignore this email.</p>"
            ),
        )

        # Try to delete the email message for privacy
        try:
            await update.message.delete()
        except Exception:
            pass

        if sent:
            masked = _mask_email(email)
            await update.effective_chat.send_message(
                f"\U0001F4E7 A 6-digit code has been sent to <b>{masked}</b>.\n\n"
                "Enter the code below:\n\n"
                "<i>Send /cancel to abort.</i>",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("\U0001F504 Resend Code", callback_data="login:resend_otp"),
                ]]),
            )
        else:
            _clear_login_flow(context)
            await update.effective_chat.send_message(
                "\u274C Failed to send verification email.\n"
                "Please check that SMTP is configured, or try /login again later."
            )
        return

    # ── Login flow: awaiting OTP code ─────────────────────────────
    if context.user_data.get("login_awaiting_otp"):
        # Check expiry
        if time.time() > context.user_data.get("login_otp_expires", 0):
            _clear_login_flow(context)
            await update.message.reply_text(
                "\u23F3 Code expired. Use /login to try again."
            )
            return

        code = text.strip()
        stored_otp = context.user_data.get("login_otp", "")

        # Try to delete the code message
        try:
            await update.message.delete()
        except Exception:
            pass

        if secrets.compare_digest(code, stored_otp):
            # Success — link account
            email = context.user_data.get("login_email")
            chat_id = str(update.effective_chat.id)

            async with async_session() as db:
                result = await db.execute(
                    select(User).where(func.lower(User.email) == email)
                )
                user = result.scalar_one_or_none()
                if user:
                    user.telegram_chat_id = chat_id
                    await db.commit()

            _clear_login_flow(context)
            # Reset attempt counter on success
            context.user_data.pop("login_attempts", None)
            context.user_data.pop("login_cooldown_until", None)

            await update.effective_chat.send_message(
                f"\u2705 <b>Account linked!</b>\n\n"
                f"Logged in as <b>{email}</b>.\n"
                "Use the buttons below to get started.",
                parse_mode="HTML",
                reply_markup=MAIN_KEYBOARD,
            )
        else:
            # Wrong code — increment attempts
            attempts = context.user_data.get("login_attempts", 0) + 1
            context.user_data["login_attempts"] = attempts

            if attempts >= MAX_LOGIN_ATTEMPTS:
                _clear_login_flow(context)
                context.user_data["login_cooldown_until"] = time.time() + LOGIN_COOLDOWN_SECONDS
                await update.effective_chat.send_message(
                    f"\u26D4 Too many failed attempts. "
                    f"Please wait {LOGIN_COOLDOWN_SECONDS // 60} minutes before trying /login again."
                )
            else:
                remaining = MAX_LOGIN_ATTEMPTS - attempts
                await update.effective_chat.send_message(
                    f"\u274C Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.\n\n"
                    "Enter the code again or /cancel to abort.",
                    reply_markup=InlineKeyboardMarkup([[
                        InlineKeyboardButton("\U0001F504 Resend Code", callback_data="login:resend_otp"),
                    ]]),
                )
        return

    # ── Traffic bot: awaiting link input ──────────────────────────
    if context.user_data.get("tb_awaiting_link"):
        user = await _require_user(update)
        if not user:
            return

        link = text
        if not link:
            await update.message.reply_text("Please send a valid URL.")
            return

        context.user_data["tb_awaiting_link"] = False
        context.user_data["tb_link"] = link

        service_id = context.user_data.get("tb_service_id")
        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            _clear_tb_flow(context)
            await update.message.reply_text("Service not found. Use /tborder to start over.")
            return

        context.user_data["tb_awaiting_quantity"] = True

        await update.message.reply_text(
            f"\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            f"<b>Service:</b> {service.name}\n"
            f"<b>Link:</b> <code>{link[:60]}</code>\n\n"
            f"<b>Step 4/4:</b> Enter the <b>quantity</b>:\n"
            f"<i>Min: {service.min_quantity:,} \u2014 Max: {service.max_quantity:,}</i>\n\n"
            f"<i>Send /cancel to abort.</i>",
            parse_mode="HTML",
        )
        return

    # ── Traffic bot: awaiting quantity input ───────────────────────
    if context.user_data.get("tb_awaiting_quantity"):
        user = await _require_user(update)
        if not user:
            return

        try:
            quantity = int(text.replace(",", ""))
        except (ValueError, TypeError):
            await update.message.reply_text("Please send a valid number.")
            return

        service_id = context.user_data.get("tb_service_id")
        link = context.user_data.get("tb_link")

        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            _clear_tb_flow(context)
            await update.message.reply_text("Service not found. Use /tborder to start over.")
            return

        if quantity < service.min_quantity or quantity > service.max_quantity:
            await update.message.reply_text(
                f"Quantity must be between {service.min_quantity:,} and {service.max_quantity:,}."
            )
            return

        context.user_data["tb_awaiting_quantity"] = False
        context.user_data["tb_quantity"] = quantity

        # Calculate price
        pricing = tb_svc.calculate_price(float(service.rate), quantity, float(service.fee_pct))

        # Check wallet balance
        async with async_session() as db:
            wallet = await tb_svc.get_or_create_wallet(db, user.tenant_id)
            await db.commit()

        balance = float(wallet.balance)
        total = pricing["total_cost"]
        enough = balance >= total

        balance_line = (
            f"\U0001F4B0 <b>Wallet:</b> RM{balance:.2f} {'✅' if enough else '❌ Insufficient'}"
        )

        await update.message.reply_text(
            f"\U0001F4E6 <b>Confirm Traffic Bot Order</b>\n\n"
            f"<b>Service:</b> {service.name}\n"
            f"<b>Link:</b> <code>{link[:60]}</code>\n"
            f"<b>Quantity:</b> {quantity:,}\n\n"
            f"<b>Base cost:</b> RM{pricing['base_cost']:.4f}\n"
            f"<b>Fee:</b> RM{pricing['fee_amount']:.4f}\n"
            f"<b>Total:</b> RM{total:.4f}\n\n"
            f"{balance_line}",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("\u2705 Confirm Order", callback_data="tb_confirm"),
                    InlineKeyboardButton("\u274C Cancel", callback_data="tb_cancel_flow"),
                ],
            ]) if enough else InlineKeyboardMarkup([
                [InlineKeyboardButton("\u274C Cancel (Insufficient funds)", callback_data="tb_cancel_flow")],
            ]),
        )
        return

    # ── URL/input during scraping job creation flow ───────────────
    if context.user_data.get("new_job_awaiting_input"):
        user = await _require_user(update)
        if not user:
            return

        platform_name = context.user_data.get("new_job_platform")
        scrape_type_id = context.user_data.get("new_job_scrape_type")

        if not platform_name or not scrape_type_id:
            await update.message.reply_text("Session expired. Use /newjob to start over.")
            _clear_job_flow(context)
            return

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)
        if not st:
            await update.message.reply_text("Invalid configuration. Use /newjob to start over.")
            _clear_job_flow(context)
            return

        input_value = update.message.text.strip()

        # Basic validation
        if not input_value:
            await update.message.reply_text("Please send a valid URL or ID.")
            return

        # Clear flow state
        _clear_job_flow(context)

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
        return

    # ── Default: show help ────────────────────────────────────────
    await update.message.reply_text(
        "Use the buttons below or type /help for commands.",
        reply_markup=MAIN_KEYBOARD,
    )


# ── Bot Application Builder ──────────────────────────────────────────────


async def _post_init(app: Application) -> None:
    """Set bot commands menu after startup."""
    await app.bot.set_my_commands([
        BotCommand("login", "Log in with your SocyBase account"),
        BotCommand("newjob", "Create a new scraping job"),
        BotCommand("jobs", "List your recent jobs"),
        BotCommand("credits", "Check credit balance"),
        BotCommand("status", "Check a specific job status"),
        BotCommand("tborder", "Place a traffic bot order"),
        BotCommand("tborders", "View your TB orders"),
        BotCommand("tbwallet", "Check TB wallet balance"),
        BotCommand("unlink", "Disconnect your Telegram account"),
        BotCommand("help", "Show all commands"),
        BotCommand("cancel", "Cancel current operation"),
    ])


async def get_bot_token() -> str:
    """Get bot token from DB settings (async), falling back to env var."""
    from app.models.system import SystemSetting

    try:
        async with async_session() as db:
            result = await db.execute(
                select(SystemSetting).where(
                    SystemSetting.key == "telegram_settings"
                )
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value.get("bot_token"):
                return setting.value["bot_token"].strip()
    except Exception:
        pass
    return (get_settings().telegram_bot_token or "").strip()


def get_bot_token_sync() -> str:
    """Get bot token from DB settings (sync), falling back to env var.

    NOTE: Only call this from outside an async event loop (e.g. module-level).
    Inside async code, use ``get_bot_token()`` instead.
    """
    import asyncio
    from app.models.system import SystemSetting

    token = None
    try:
        loop = asyncio.new_event_loop()
        async def _fetch():
            async with async_session() as db:
                result = await db.execute(
                    select(SystemSetting).where(
                        SystemSetting.key == "telegram_settings"
                    )
                )
                setting = result.scalar_one_or_none()
                if setting and setting.value.get("bot_token"):
                    return setting.value["bot_token"]
            return None
        token = loop.run_until_complete(_fetch())
        loop.close()
    except Exception:
        pass
    if not token:
        token = get_settings().telegram_bot_token
    return token or ""


def create_bot_app(token: str | None = None) -> Application:
    """Build and configure the Telegram bot application."""
    if not token:
        token = get_bot_token_sync()
    if not token:
        raise ValueError("Telegram bot token not configured (set via Admin Settings or TELEGRAM_BOT_TOKEN env var)")

    app = (
        Application.builder()
        .token(token)
        .post_init(_post_init)
        .build()
    )

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("login", login_command))
    app.add_handler(CommandHandler("unlink", unlink_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("jobs", jobs_command))
    app.add_handler(CommandHandler("credits", credits_command))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("newjob", newjob_command))
    app.add_handler(CommandHandler("tborder", tborder_command))
    app.add_handler(CommandHandler("tborders", tborders_command))
    app.add_handler(CommandHandler("tbwallet", tbwallet_command))
    app.add_handler(CommandHandler("cancel", cancel_command))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    return app
