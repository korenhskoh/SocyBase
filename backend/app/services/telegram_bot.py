"""SocyBase Telegram Bot — remote job management, traffic bot orders, and notifications.

Mirrors the webapp flow:
  /login  → email → verify account exists → linked
  /newjob → select platform → select scrape type → send input → pre-check & confirm → job created
  /jobs   → list recent jobs with action buttons (details, cancel, pause, resume)
  /credits → credit balance
  /tborder  → select category → select service → enter link → enter qty → confirm
  /tborders → list recent traffic bot orders with action buttons
  /tbwallet → traffic bot wallet balance
  /help   → command reference
"""

import logging
import re
import time
from collections import defaultdict

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
from sqlalchemy import select, func, distinct
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.database import async_session
from app.models.user import User
from app.models.job import ScrapingJob, ScrapedProfile
from app.models.credit import CreditBalance
from app.models.platform import Platform
from app.models.traffic_bot import TrafficBotOrder
from app.services import traffic_bot_service as tb_svc
from app.utils.security import decode_token

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# ── RATE LIMITING ────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════

_rate_limits: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 10  # max commands per window


def _is_rate_limited(chat_id: str) -> bool:
    """Check if a chat_id has exceeded the rate limit. Returns True if limited."""
    now = time.time()
    timestamps = _rate_limits[chat_id]
    # Prune old entries
    _rate_limits[chat_id] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limits[chat_id]) >= RATE_LIMIT_MAX:
        return True
    _rate_limits[chat_id].append(now)
    return False


# ═══════════════════════════════════════════════════════════════════════
# ── LANGUAGE / i18n ──────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════

KB_LABELS = {
    "en": {
        "new_job": "\U0001F680 New Job",
        "my_jobs": "\U0001F4CB My Jobs",
        "tb_order": "\U0001F4E6 TB Order",
        "tb_orders": "\U0001F4CA TB Orders",
        "credits": "\U0001F4B3 Credits",
        "tb_wallet": "\U0001F4B0 TB Wallet",
        "help": "\u2753 Help",
        "language": "\U0001F310 Language",
    },
    "zh": {
        "new_job": "\U0001F680 新任务",
        "my_jobs": "\U0001F4CB 我的任务",
        "tb_order": "\U0001F4E6 TB 下单",
        "tb_orders": "\U0001F4CA TB 订单",
        "credits": "\U0001F4B3 积分",
        "tb_wallet": "\U0001F4B0 TB 钱包",
        "help": "\u2753 帮助",
        "language": "\U0001F310 语言",
    },
}

# Build reverse lookup: button text → command name
_KB_COMMANDS: dict[str, str] = {}
for _lc in ("en", "zh"):
    _kl = KB_LABELS[_lc]
    _KB_COMMANDS[_kl["new_job"]] = "newjob"
    _KB_COMMANDS[_kl["my_jobs"]] = "jobs"
    _KB_COMMANDS[_kl["tb_order"]] = "tborder"
    _KB_COMMANDS[_kl["tb_orders"]] = "tborders"
    _KB_COMMANDS[_kl["credits"]] = "credits"
    _KB_COMMANDS[_kl["tb_wallet"]] = "tbwallet"
    _KB_COMMANDS[_kl["help"]] = "help"
    _KB_COMMANDS[_kl["language"]] = "language"


def _build_keyboard(lang: str) -> ReplyKeyboardMarkup:
    kb = KB_LABELS.get(lang, KB_LABELS["en"])
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(kb["new_job"]), KeyboardButton(kb["my_jobs"])],
            [KeyboardButton(kb["tb_order"]), KeyboardButton(kb["tb_orders"])],
            [KeyboardButton(kb["credits"]), KeyboardButton(kb["tb_wallet"])],
            [KeyboardButton(kb["language"]), KeyboardButton(kb["help"])],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


MAIN_KEYBOARD_EN = _build_keyboard("en")
MAIN_KEYBOARD_ZH = _build_keyboard("zh")
# Keep old name for backward compat
MAIN_KEYBOARD = MAIN_KEYBOARD_EN


def _lang(context: ContextTypes.DEFAULT_TYPE) -> str:
    """Get user's language preference."""
    return context.user_data.get("lang", "en")


def _kb(lang: str) -> ReplyKeyboardMarkup:
    """Get keyboard for language."""
    return MAIN_KEYBOARD_ZH if lang == "zh" else MAIN_KEYBOARD_EN


def _sl(field, lang: str) -> str:
    """Get string from a {lang: str} dict or plain str."""
    if isinstance(field, dict):
        return field.get(lang, field.get("en", ""))
    return field


# ── Translation strings ─────────────────────────────────────────────
T: dict[str, dict[str, str]] = {
    # ── Common ──
    "unlinked": {
        "en": (
            "\u26A0\uFE0F Your Telegram account is not linked.\n\n"
            "Use /login to link your SocyBase account, "
            "or go to <b>Settings</b> in the dashboard and click "
            "<b>Link Telegram</b>."
        ),
        "zh": (
            "\u26A0\uFE0F 您的 Telegram 帐户未绑定。\n\n"
            "使用 /login 绑定您的 SocyBase 帐户，"
            "或前往后台<b>设置</b>点击"
            "<b>绑定 Telegram</b>。"
        ),
    },
    "session_expired_newjob": {
        "en": "Session expired. Use /newjob to start over.",
        "zh": "会话已过期。请使用 /newjob 重新开始。",
    },
    "session_expired_tborder": {
        "en": "Session expired. Use /tborder to start over.",
        "zh": "会话已过期。请使用 /tborder 重新开始。",
    },
    "rate_limited": {
        "en": "\u23F3 Too many requests. Please wait a moment and try again.",
        "zh": "\u23F3 请求过于频繁，请稍后再试。",
    },
    "op_cancelled": {
        "en": "\u274C Operation cancelled.",
        "zh": "\u274C 操作已取消。",
    },
    "nothing_cancel": {
        "en": "Nothing to cancel.",
        "zh": "没有需要取消的操作。",
    },
    "default_msg": {
        "en": "Use the buttons below or type /help for commands.",
        "zh": "使用下方按钮或输入 /help 查看命令。",
    },
    "link_first": {
        "en": "Please link your account first. See /start",
        "zh": "请先绑定帐户。查看 /start",
    },
    "not_found_job": {
        "en": "Job not found.",
        "zh": "找不到该任务。",
    },
    "not_found_order": {
        "en": "Order not found.",
        "zh": "找不到该订单。",
    },
    "invalid_config": {
        "en": "Invalid configuration. Use /newjob to start over.",
        "zh": "配置无效。请使用 /newjob 重新开始。",
    },
    "send_valid_url": {
        "en": "Please send a valid URL or ID.",
        "zh": "请发送有效的链接或ID。",
    },
    "send_valid_number": {
        "en": "Please send a valid number.",
        "zh": "请发送有效的数字。",
    },
    "send_valid_link": {
        "en": "Please send a valid URL.",
        "zh": "请发送有效的链接。",
    },

    # ── /start ──
    "start_linked": {
        "en": (
            "\u2705 Linked to <b>{email}</b>\n\n"
            "Use the buttons below or type a command to get started."
        ),
        "zh": (
            "\u2705 已绑定到 <b>{email}</b>\n\n"
            "使用下方按钮或输入命令开始使用。"
        ),
    },
    "start_link_ok": {
        "en": (
            "\u2705 Account linked to <b>{email}</b>!\n\n"
            "You can now manage scraping jobs and traffic bot orders "
            "directly from Telegram.\n"
            "Use the buttons below to get started!"
        ),
        "zh": (
            "\u2705 帐户已绑定到 <b>{email}</b>！\n\n"
            "您现在可以直接从 Telegram 管理采集任务和流量机器人订单。\n"
            "使用下方按钮开始使用！"
        ),
    },
    "start_invalid_token": {
        "en": (
            "\u274C Invalid or expired link token.\n\n"
            "Go to <b>Settings</b> in the SocyBase dashboard and click "
            "<b>Link Telegram</b> to generate a new link."
        ),
        "zh": (
            "\u274C 无效或已过期的绑定链接。\n\n"
            "前往 SocyBase 后台<b>设置</b>点击"
            "<b>绑定 Telegram</b>生成新链接。"
        ),
    },
    "start_welcome": {
        "en": (
            "\U0001F44B <b>Welcome to SocyBase Bot!</b>\n\n"
            "This bot lets you create and manage scraping jobs, "
            "place traffic bot orders, check credits, and receive "
            "notifications \u2014 all from Telegram.\n\n"
            "<b>To get started, log in with your SocyBase account:</b>\n"
            "\u27A1\uFE0F /login\n\n"
            "Or link from the dashboard via <b>Settings \u2192 Link Telegram</b>."
        ),
        "zh": (
            "\U0001F44B <b>欢迎使用 SocyBase 机器人！</b>\n\n"
            "此机器人可让您创建和管理采集任务、"
            "下达流量机器人订单、查询积分和接收"
            "通知 \u2014 全部在 Telegram 上完成。\n\n"
            "<b>开始使用前，请先登录您的 SocyBase 帐户：</b>\n"
            "\u27A1\uFE0F /login\n\n"
            "或从后台 <b>设置 \u2192 绑定 Telegram</b> 进行绑定。"
        ),
    },

    # ── /help ──
    "help_text": {
        "en": (
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
            "/login \u2014 Log in with your email\n"
            "/unlink \u2014 Disconnect your Telegram\n"
            "/credits \u2014 Check scraping credit balance\n"
            "/language \u2014 Change language\n"
            "/cancel \u2014 Cancel current operation\n"
            "/help \u2014 Show this message\n\n"
            "<b>Notifications:</b>\n"
            "You'll receive messages when jobs complete or fail, "
            "and confirmations for traffic bot orders."
        ),
        "zh": (
            "\U0001F4D6 <b>SocyBase 机器人命令</b>\n\n"
            "<b>采集任务：</b>\n"
            "/newjob \u2014 创建新的采集任务\n"
            "/jobs \u2014 查看最近的采集任务\n"
            "/status <i>job_id</i> \u2014 查看特定任务状态\n\n"
            "<b>流量机器人：</b>\n"
            "/tborder \u2014 下达流量机器人订单\n"
            "/tborders \u2014 查看最近的 TB 订单\n"
            "/tbwallet \u2014 查看 TB 钱包余额\n\n"
            "<b>帐户：</b>\n"
            "/login \u2014 使用邮箱登录\n"
            "/unlink \u2014 解除 Telegram 绑定\n"
            "/credits \u2014 查看采集积分余额\n"
            "/language \u2014 更改语言\n"
            "/cancel \u2014 取消当前操作\n"
            "/help \u2014 显示此帮助信息\n\n"
            "<b>通知：</b>\n"
            "任务完成或失败时您将收到通知，"
            "流量机器人订单也会有确认通知。"
        ),
    },

    # ── /login ──
    "login_already": {
        "en": (
            "\u2705 Already linked to <b>{email}</b>.\n\n"
            "Use /unlink to disconnect first."
        ),
        "zh": (
            "\u2705 已绑定到 <b>{email}</b>。\n\n"
            "如需更换，请先使用 /unlink 解除绑定。"
        ),
    },
    "login_enter_email": {
        "en": (
            "\U0001F511 <b>Log in to SocyBase</b>\n\n"
            "Enter your <b>email address</b>:\n\n"
            "<i>Send /cancel to abort.</i>"
        ),
        "zh": (
            "\U0001F511 <b>登录 SocyBase</b>\n\n"
            "请输入您的<b>邮箱地址</b>：\n\n"
            "<i>发送 /cancel 取消。</i>"
        ),
    },
    "login_invalid_email": {
        "en": "That doesn't look like a valid email. Please try again:",
        "zh": "这不像是有效的邮箱地址。请重新输入：",
    },
    "login_no_account": {
        "en": (
            "\u274C No SocyBase account found with that email.\n"
            "Please check and try again, or /cancel to abort."
        ),
        "zh": (
            "\u274C 未找到使用该邮箱的 SocyBase 帐户。\n"
            "请检查后重试，或发送 /cancel 取消。"
        ),
    },
    "login_linked_other": {
        "en": (
            "\u26A0\uFE0F This account is already linked to another Telegram.\n"
            "Unlink it from the other device first via the dashboard, "
            "or /cancel to abort."
        ),
        "zh": (
            "\u26A0\uFE0F 此帐户已绑定到另一个 Telegram。\n"
            "请先在后台解除另一设备的绑定，"
            "或发送 /cancel 取消。"
        ),
    },
    "login_success": {
        "en": (
            "\u2705 <b>Account linked!</b>\n\n"
            "Logged in as <b>{email}</b>.\n"
            "Use the buttons below to get started."
        ),
        "zh": (
            "\u2705 <b>帐户已绑定！</b>\n\n"
            "已登录为 <b>{email}</b>。\n"
            "使用下方按钮开始使用。"
        ),
    },

    # ── /unlink ──
    "unlink_not_linked": {
        "en": "Your Telegram is not linked to any account.",
        "zh": "您的 Telegram 未绑定任何帐户。",
    },
    "unlink_ok": {
        "en": (
            "\u2705 Telegram disconnected from <b>{email}</b>.\n\n"
            "Use /login to link a different account."
        ),
        "zh": (
            "\u2705 Telegram 已从 <b>{email}</b> 解除绑定。\n\n"
            "使用 /login 绑定其他帐户。"
        ),
    },

    # ── /jobs ──
    "jobs_header": {
        "en": "\U0001F4CB <b>Your Recent Jobs</b>\n",
        "zh": "\U0001F4CB <b>您最近的任务</b>\n",
    },
    "jobs_empty": {
        "en": "No jobs found.\n\nUse /newjob to create your first scraping job!",
        "zh": "没有找到任务。\n\n使用 /newjob 创建您的第一个采集任务！",
    },
    "jobs_empty_short": {
        "en": "No jobs found. Use /newjob to create one.",
        "zh": "没有找到任务。使用 /newjob 创建。",
    },

    # ── /credits ──
    "credits_header": {
        "en": (
            "\U0001F4B3 <b>Credit Balance</b>\n\n"
            "Available: <b>{balance}</b>\n"
            "Lifetime purchased: {purchased}\n"
            "Lifetime used: {used}\n\n"
            "\U0001F504 Active jobs: {active}"
        ),
        "zh": (
            "\U0001F4B3 <b>积分余额</b>\n\n"
            "可用: <b>{balance}</b>\n"
            "累计购买: {purchased}\n"
            "累计使用: {used}\n\n"
            "\U0001F504 进行中任务: {active}"
        ),
    },
    "credits_none": {
        "en": "No credit balance found.",
        "zh": "未找到积分余额。",
    },

    # ── /status ──
    "status_usage": {
        "en": (
            "Usage: /status <code>job_id</code>\n\n"
            "Tip: Use /jobs to see your recent jobs and tap one for details."
        ),
        "zh": (
            "用法: /status <code>job_id</code>\n\n"
            "提示: 使用 /jobs 查看最近的任务并点击查看详情。"
        ),
    },

    # ── /newjob ──
    "newjob_step1": {
        "en": (
            "\U0001F680 <b>New Scraping Job</b>\n\n"
            "<b>Step 1/4:</b> Choose a platform:"
        ),
        "zh": (
            "\U0001F680 <b>新采集任务</b>\n\n"
            "<b>步骤 1/4：</b>选择平台："
        ),
    },
    "newjob_step2": {
        "en": (
            "\U0001F680 <b>New Scraping Job</b>\n\n"
            "<b>Platform:</b> {platform}\n\n"
            "<b>Step 2/4:</b> Choose a scrape type:"
        ),
        "zh": (
            "\U0001F680 <b>新采集任务</b>\n\n"
            "<b>平台：</b>{platform}\n\n"
            "<b>步骤 2/4：</b>选择采集类型："
        ),
    },
    "newjob_step3": {
        "en": (
            "\U0001F680 <b>New Scraping Job</b>\n\n"
            "<b>Platform:</b> {platform}\n"
            "<b>Type:</b> {stype}\n\n"
            "<b>Step 3/4:</b> {prompt}\n\n"
            "<i>Send /cancel to abort.</i>"
        ),
        "zh": (
            "\U0001F680 <b>新采集任务</b>\n\n"
            "<b>平台：</b>{platform}\n"
            "<b>类型：</b>{stype}\n\n"
            "<b>步骤 3/4：</b>{prompt}\n\n"
            "<i>发送 /cancel 取消。</i>"
        ),
    },
    "newjob_cancelled": {
        "en": "\u274C Job creation cancelled.",
        "zh": "\u274C 任务创建已取消。",
    },
    "newjob_no_types": {
        "en": "No scrape types available for {platform}.",
        "zh": "{platform} 没有可用的采集类型。",
    },
    "newjob_confirm_title": {
        "en": "\U0001F680 <b>Confirm New Job</b>\n",
        "zh": "\U0001F680 <b>确认新任务</b>\n",
    },
    "newjob_prev_scraped": {
        "en": (
            "\n\u26A0\uFE0F <b>Previously scraped:</b> {jobs} job(s), "
            "{profiles} profiles (last: {date})"
        ),
        "zh": (
            "\n\u26A0\uFE0F <b>曾经采集过：</b>{jobs} 个任务，"
            "{profiles} 个资料（最近：{date}）"
        ),
    },
    "newjob_dedup_on": {
        "en": "ON \u2014 skip already scraped",
        "zh": "开启 \u2014 跳过已采集的",
    },
    "newjob_dedup_off": {
        "en": "OFF \u2014 scrape all",
        "zh": "关闭 \u2014 采集全部",
    },
    "newjob_created": {
        "en": (
            "\u2705 <b>Job Created!</b>\n\n"
            "<b>ID:</b> <code>{short_id}...</code>\n"
            "<b>Platform:</b> {platform}\n"
            "<b>Type:</b> {stype}\n"
            "<b>Input:</b> <code>{input}</code>\n\n"
            "{dedup_line}"
            "\u23F3 Job is queued and will start shortly.\n"
            "You'll receive a notification when it completes."
        ),
        "zh": (
            "\u2705 <b>任务已创建！</b>\n\n"
            "<b>ID：</b><code>{short_id}...</code>\n"
            "<b>平台：</b>{platform}\n"
            "<b>类型：</b>{stype}\n"
            "<b>输入：</b><code>{input}</code>\n\n"
            "{dedup_line}"
            "\u23F3 任务已排队，即将开始。\n"
            "完成后您将收到通知。"
        ),
    },
    "newjob_dedup_note": {
        "en": "\U0001F50D Duplicate users will be skipped.\n",
        "zh": "\U0001F50D 重复用户将被跳过。\n",
    },

    # ── Validation ──
    "validate_post_url": {
        "en": (
            "\u26A0\uFE0F That doesn't look like a valid Facebook post URL or ID.\n\n"
            "<b>Accepted formats:</b>\n"
            "\u2022 <code>https://facebook.com/page/posts/123</code>\n"
            "\u2022 <code>https://fb.com/reel/123</code>\n"
            "\u2022 <code>123456789</code> (post ID)\n"
            "\u2022 <code>pageid_postid</code>\n\n"
            "Please try again:"
        ),
        "zh": (
            "\u26A0\uFE0F 这不像是有效的 Facebook 帖子链接或ID。\n\n"
            "<b>支持的格式：</b>\n"
            "\u2022 <code>https://facebook.com/page/posts/123</code>\n"
            "\u2022 <code>https://fb.com/reel/123</code>\n"
            "\u2022 <code>123456789</code>（帖子ID）\n"
            "\u2022 <code>pageid_postid</code>\n\n"
            "请重新输入："
        ),
    },
    "validate_page_id": {
        "en": (
            "\u26A0\uFE0F That doesn't look like a valid page URL or username.\n\n"
            "<b>Accepted formats:</b>\n"
            "\u2022 <code>https://facebook.com/pagename</code>\n"
            "\u2022 <code>pagename</code> (username)\n"
            "\u2022 <code>123456789</code> (page ID)\n\n"
            "Please try again:"
        ),
        "zh": (
            "\u26A0\uFE0F 这不像是有效的主页链接或用户名。\n\n"
            "<b>支持的格式：</b>\n"
            "\u2022 <code>https://facebook.com/pagename</code>\n"
            "\u2022 <code>pagename</code>（用户名）\n"
            "\u2022 <code>123456789</code>（主页ID）\n\n"
            "请重新输入："
        ),
    },

    # ── Job detail labels ──
    "lbl_type": {"en": "Type", "zh": "类型"},
    "lbl_input": {"en": "Input", "zh": "输入"},
    "lbl_status": {"en": "Status", "zh": "状态"},
    "lbl_progress": {"en": "Progress", "zh": "进度"},
    "lbl_items": {"en": "Items", "zh": "项目"},
    "lbl_credits": {"en": "Credits", "zh": "积分"},
    "lbl_results": {"en": "Results", "zh": "结果"},
    "lbl_created": {"en": "Created", "zh": "创建时间"},
    "lbl_error": {"en": "Error", "zh": "错误"},
    "lbl_failed": {"en": "failed", "zh": "失败"},
    "lbl_profiles": {"en": "profiles", "zh": "个资料"},
    "lbl_platform": {"en": "Platform", "zh": "平台"},
    "lbl_skip_dupes": {"en": "Skip duplicates", "zh": "跳过重复"},
    "lbl_available": {"en": "available", "zh": "可用"},

    # ── Job action buttons ──
    "btn_pause": {"en": "\u23F8 Pause", "zh": "\u23F8 暂停"},
    "btn_cancel": {"en": "\u274C Cancel", "zh": "\u274C 取消"},
    "btn_resume": {"en": "\u25B6\uFE0F Resume", "zh": "\u25B6\uFE0F 继续"},
    "btn_retry": {"en": "\U0001F504 Retry", "zh": "\U0001F504 重试"},
    "btn_refresh": {"en": "\U0001F504 Refresh", "zh": "\U0001F504 刷新"},
    "btn_back_jobs": {"en": "\u2B05\uFE0F Back to Jobs", "zh": "\u2B05\uFE0F 返回任务"},
    "btn_new_job": {"en": "\u2795 New Job", "zh": "\u2795 新任务"},
    "btn_create_job": {"en": "\u2705 Create Job", "zh": "\u2705 创建任务"},
    "btn_skip_dupes": {"en": "Skip Duplicates", "zh": "跳过重复"},
    "btn_view_job": {"en": "\U0001F4CA View Job", "zh": "\U0001F4CA 查看任务"},
    "btn_my_jobs": {"en": "\U0001F4CB My Jobs", "zh": "\U0001F4CB 我的任务"},
    "btn_back": {"en": "\u2B05\uFE0F Back", "zh": "\u2B05\uFE0F 返回"},

    # ── Job action results ──
    "job_cancelled": {
        "en": "\u274C <b>Job {short_id}... cancelled.</b>\n\nCredits used: {credits}",
        "zh": "\u274C <b>任务 {short_id}... 已取消。</b>\n\n已使用积分: {credits}",
    },
    "cannot_cancel_job": {
        "en": "Cannot cancel a {status} job.",
        "zh": "无法取消 {status} 状态的任务。",
    },
    "cannot_pause_job": {
        "en": "Cannot pause a {status} job.",
        "zh": "无法暂停 {status} 状态的任务。",
    },
    "cannot_resume_job": {
        "en": "Cannot resume a {status} job.",
        "zh": "无法恢复 {status} 状态的任务。",
    },
    "no_checkpoint": {
        "en": "No checkpoint data to resume from.",
        "zh": "没有可恢复的检查点数据。",
    },

    # ── TB wallet ──
    "tbwallet_header": {
        "en": (
            "\U0001F4B0 <b>Traffic Bot Wallet</b>\n\n"
            "Balance: <b>RM{balance}</b>\n\n"
            "<i>To deposit funds, use the SocyBase dashboard \u2192 Traffic Bot \u2192 Wallet.</i>"
        ),
        "zh": (
            "\U0001F4B0 <b>流量机器人钱包</b>\n\n"
            "余额: <b>RM{balance}</b>\n\n"
            "<i>如需充值，请使用 SocyBase 后台 \u2192 流量机器人 \u2192 钱包。</i>"
        ),
    },

    # ── TB order flow ──
    "tborder_step1": {
        "en": (
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Step 1/4:</b> Choose a category:"
        ),
        "zh": (
            "\U0001F4E6 <b>新流量机器人订单</b>\n\n"
            "<b>步骤 1/4：</b>选择类别："
        ),
    },
    "tborder_step2": {
        "en": (
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Category:</b> {category}\n"
            "<b>Step 2/4:</b> Choose a service ({count} available):"
        ),
        "zh": (
            "\U0001F4E6 <b>新流量机器人订单</b>\n\n"
            "<b>类别：</b>{category}\n"
            "<b>步骤 2/4：</b>选择服务（{count} 个可用）："
        ),
    },
    "tborder_step2_page": {
        "en": (
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Category:</b> {category}\n"
            "<b>Step 2/4:</b> Choose a service (page {page}/{total}):"
        ),
        "zh": (
            "\U0001F4E6 <b>新流量机器人订单</b>\n\n"
            "<b>类别：</b>{category}\n"
            "<b>步骤 2/4：</b>选择服务（第 {page}/{total} 页）："
        ),
    },
    "tborder_step3": {
        "en": (
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Service:</b> {service}\n"
            "<b>Rate:</b> RM{rate} per 1K\n"
            "<b>Min/Max:</b> {min} \u2014 {max}\n\n"
            "<b>Step 3/4:</b> Send me the <b>target link/URL</b>:\n\n"
            "<i>Send /cancel to abort.</i>"
        ),
        "zh": (
            "\U0001F4E6 <b>新流量机器人订单</b>\n\n"
            "<b>服务：</b>{service}\n"
            "<b>费率：</b>RM{rate} / 1K\n"
            "<b>最小/最大：</b>{min} \u2014 {max}\n\n"
            "<b>步骤 3/4：</b>发送<b>目标链接/URL</b>给我：\n\n"
            "<i>发送 /cancel 取消。</i>"
        ),
    },
    "tborder_step4": {
        "en": (
            "\U0001F4E6 <b>New Traffic Bot Order</b>\n\n"
            "<b>Service:</b> {service}\n"
            "<b>Link:</b> <code>{link}</code>\n\n"
            "<b>Step 4/4:</b> Enter the <b>quantity</b>:\n"
            "<i>Min: {min} \u2014 Max: {max}</i>\n\n"
            "<i>Send /cancel to abort.</i>"
        ),
        "zh": (
            "\U0001F4E6 <b>新流量机器人订单</b>\n\n"
            "<b>服务：</b>{service}\n"
            "<b>链接：</b><code>{link}</code>\n\n"
            "<b>步骤 4/4：</b>输入<b>数量</b>：\n"
            "<i>最小: {min} \u2014 最大: {max}</i>\n\n"
            "<i>发送 /cancel 取消。</i>"
        ),
    },
    "tborder_qty_range": {
        "en": "Quantity must be between {min} and {max}.",
        "zh": "数量必须在 {min} 到 {max} 之间。",
    },
    "tborder_no_services": {
        "en": "No traffic bot services available. Please try again later.",
        "zh": "没有可用的流量机器人服务。请稍后再试。",
    },
    "tborder_no_services_cat": {
        "en": "No services available in {category}.",
        "zh": "{category} 没有可用的服务。",
    },
    "tborder_svc_not_found": {
        "en": "Service not found. Use /tborder to start over.",
        "zh": "找不到服务。请使用 /tborder 重新开始。",
    },
    "tborder_confirm": {
        "en": (
            "\U0001F4E6 <b>Confirm Traffic Bot Order</b>\n\n"
            "<b>Service:</b> {service}\n"
            "<b>Link:</b> <code>{link}</code>\n"
            "<b>Quantity:</b> {qty}\n\n"
            "<b>Base cost:</b> RM{base}\n"
            "<b>Fee:</b> RM{fee}\n"
            "<b>Total:</b> RM{total}\n\n"
            "{wallet_line}"
        ),
        "zh": (
            "\U0001F4E6 <b>确认流量机器人订单</b>\n\n"
            "<b>服务：</b>{service}\n"
            "<b>链接：</b><code>{link}</code>\n"
            "<b>数量：</b>{qty}\n\n"
            "<b>基础费用：</b>RM{base}\n"
            "<b>手续费：</b>RM{fee}\n"
            "<b>总计：</b>RM{total}\n\n"
            "{wallet_line}"
        ),
    },
    "tborder_wallet_ok": {
        "en": "\U0001F4B0 <b>Wallet:</b> RM{balance} \u2705",
        "zh": "\U0001F4B0 <b>钱包：</b>RM{balance} \u2705",
    },
    "tborder_wallet_low": {
        "en": "\U0001F4B0 <b>Wallet:</b> RM{balance} \u274C Insufficient",
        "zh": "\U0001F4B0 <b>钱包：</b>RM{balance} \u274C 余额不足",
    },
    "tborder_placed": {
        "en": (
            "\u2705 <b>Order Placed!</b>\n\n"
            "<b>ID:</b> <code>{short_id}...</code>\n"
            "<b>Service:</b> {service}\n"
            "<b>Link:</b> <code>{link}</code>\n"
            "<b>Quantity:</b> {qty}\n"
            "<b>Cost:</b> RM{cost}\n"
            "<b>Status:</b> {icon} {status}\n\n"
            "Your order is being processed."
        ),
        "zh": (
            "\u2705 <b>订单已提交！</b>\n\n"
            "<b>ID：</b><code>{short_id}...</code>\n"
            "<b>服务：</b>{service}\n"
            "<b>链接：</b><code>{link}</code>\n"
            "<b>数量：</b>{qty}\n"
            "<b>费用：</b>RM{cost}\n"
            "<b>状态：</b>{icon} {status}\n\n"
            "您的订单正在处理中。"
        ),
    },
    "tborder_failed": {
        "en": "\u274C <b>Order Failed</b>\n\n{error}\n\nUse /tborder to try again.",
        "zh": "\u274C <b>订单失败</b>\n\n{error}\n\n使用 /tborder 重试。",
    },
    "tborder_failed_unexpected": {
        "en": "\u274C <b>Order Failed</b>\n\nAn unexpected error occurred.\n\nUse /tborder to try again.",
        "zh": "\u274C <b>订单失败</b>\n\n发生意外错误。\n\n使用 /tborder 重试。",
    },
    "tb_order_cancelled": {
        "en": (
            "\u274C <b>Order cancelled.</b>\n\n"
            "<b>ID:</b> <code>{short_id}...</code>\n"
            "RM{cost} has been refunded to your wallet."
        ),
        "zh": (
            "\u274C <b>订单已取消。</b>\n\n"
            "<b>ID：</b><code>{short_id}...</code>\n"
            "RM{cost} 已退回您的钱包。"
        ),
    },
    "tb_cancel_failed": {
        "en": "Failed to cancel order.",
        "zh": "取消订单失败。",
    },
    "tb_refill_ok": {
        "en": "\u2705 Refill requested!",
        "zh": "\u2705 已请求补充！",
    },
    "tb_refill_failed": {
        "en": "Failed to request refill.",
        "zh": "请求补充失败。",
    },
    "tb_order_cancelled_flow": {
        "en": "\u274C Order cancelled.",
        "zh": "\u274C 订单已取消。",
    },

    # ── TB orders list ──
    "tborders_header": {
        "en": "\U0001F4CA <b>Your Recent TB Orders</b> ({total} total)\n",
        "zh": "\U0001F4CA <b>您最近的 TB 订单</b>（共 {total} 个）\n",
    },
    "tborders_empty": {
        "en": "No traffic bot orders found.\n\nUse /tborder to place your first order!",
        "zh": "没有找到流量机器人订单。\n\n使用 /tborder 下达您的第一个订单！",
    },
    "tborders_empty_short": {
        "en": "No orders found. Use /tborder to place one.",
        "zh": "没有找到订单。使用 /tborder 下单。",
    },

    # ── TB order detail labels ──
    "tb_lbl_service": {"en": "Service", "zh": "服务"},
    "tb_lbl_link": {"en": "Link", "zh": "链接"},
    "tb_lbl_quantity": {"en": "Quantity", "zh": "数量"},
    "tb_lbl_cost": {"en": "Cost", "zh": "费用"},
    "tb_lbl_status": {"en": "Status", "zh": "状态"},
    "tb_lbl_start_count": {"en": "Start Count", "zh": "起始数量"},
    "tb_lbl_remains": {"en": "Remains", "zh": "剩余"},
    "tb_lbl_ext_id": {"en": "Ext. ID", "zh": "外部ID"},
    "tb_lbl_created": {"en": "Created", "zh": "创建时间"},
    "tb_lbl_error": {"en": "Error", "zh": "错误"},

    # ── TB action buttons ──
    "btn_tb_refresh": {"en": "\U0001F504 Refresh Status", "zh": "\U0001F504 刷新状态"},
    "btn_tb_cancel": {"en": "\u274C Cancel Order", "zh": "\u274C 取消订单"},
    "btn_tb_refill": {"en": "\U0001F504 Refill", "zh": "\U0001F504 补充"},
    "btn_tb_back": {"en": "\u2B05\uFE0F Back to Orders", "zh": "\u2B05\uFE0F 返回订单"},
    "btn_tb_new": {"en": "\u2795 New Order", "zh": "\u2795 新订单"},
    "btn_tb_view": {"en": "\U0001F4CA View Order", "zh": "\U0001F4CA 查看订单"},
    "btn_tb_my_orders": {"en": "\U0001F4CB My Orders", "zh": "\U0001F4CB 我的订单"},
    "btn_confirm_order": {"en": "\u2705 Confirm Order", "zh": "\u2705 确认订单"},
    "btn_cancel_insuf": {"en": "\u274C Cancel (Insufficient funds)", "zh": "\u274C 取消（余额不足）"},

    # ── Language ──
    "lang_choose": {
        "en": "\U0001F310 <b>Choose Language / 选择语言</b>",
        "zh": "\U0001F310 <b>选择语言 / Choose Language</b>",
    },
    "lang_set": {
        "en": "\u2705 Language set to <b>English</b>.",
        "zh": "\u2705 语言已设置为<b>华语</b>。",
    },
}


def _t(lang: str, key: str, **kw) -> str:
    """Get translated string."""
    entry = T.get(key, {})
    text = entry.get(lang, entry.get("en", f"[{key}]"))
    return text.format(**kw) if kw else text

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
            "label": {"en": "\U0001F4AC Comment Profile Scraper", "zh": "\U0001F4AC 评论资料采集"},
            "short": {"en": "Comment Scraper", "zh": "评论采集"},
            "desc": {"en": "Extract commenter profiles from any post", "zh": "从帖子中提取评论者资料"},
            "input_prompt": {
                "en": (
                    "Send me the <b>post URL or ID</b> to scrape.\n\n"
                    "<i>Supported: page posts, group posts, video posts, photo posts, reels</i>\n\n"
                    "Example:\n<code>https://www.facebook.com/page/posts/123456789</code>"
                ),
                "zh": (
                    "发送<b>帖子链接或ID</b>给我进行采集。\n\n"
                    "<i>支持：主页帖子、群组帖子、视频帖子、图片帖子、Reels</i>\n\n"
                    "示例：\n<code>https://www.facebook.com/page/posts/123456789</code>"
                ),
            },
            "job_type": "full_pipeline",
            "input_type": "post_url",
        },
        {
            "id": "post_discovery",
            "label": {"en": "\U0001F50D Page Post Discovery", "zh": "\U0001F50D 主页帖子发现"},
            "short": {"en": "Post Discovery", "zh": "帖子发现"},
            "desc": {"en": "Discover all posts from a page, group, or profile", "zh": "发现主页、群组或个人的所有帖子"},
            "input_prompt": {
                "en": (
                    "Send me the <b>Page ID, username, or URL</b>.\n\n"
                    "<i>Supported: page IDs, usernames, @handles, group URLs, profile URLs</i>\n\n"
                    "Example:\n<code>https://facebook.com/pagename</code>"
                ),
                "zh": (
                    "发送<b>主页ID、用户名或链接</b>给我。\n\n"
                    "<i>支持：主页ID、用户名、@用户名、群组链接、个人资料链接</i>\n\n"
                    "示例：\n<code>https://facebook.com/pagename</code>"
                ),
            },
            "job_type": "post_discovery",
            "input_type": "page_id",
        },
    ],
}

TB_SERVICES_PER_PAGE = 8

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Facebook URL patterns for pre-check validation
FB_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.com|fb\.watch)/",
    re.IGNORECASE,
)


def _validate_fb_input(input_value: str, input_type: str, lang: str = "en") -> str | None:
    """Validate Facebook input. Returns error message or None if valid."""
    if input_type == "post_url":
        if FB_URL_RE.search(input_value):
            return None
        if re.match(r"^\d+$", input_value):
            return None
        if re.match(r"^\d+_\d+$", input_value):
            return None
        return _t(lang, "validate_post_url")
    elif input_type == "page_id":
        if FB_URL_RE.search(input_value):
            return None
        if re.match(r"^[\w.]+$", input_value):
            return None
        return _t(lang, "validate_page_id")
    return None


def _clear_login_flow(context: ContextTypes.DEFAULT_TYPE):
    """Clear all login flow state."""
    for key in ["login_awaiting_email", "login_email"]:
        context.user_data.pop(key, None)


# ── Helpers ──────────────────────────────────────────────────────────────


async def _get_user_by_chat_id(chat_id: str) -> User | None:
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.telegram_chat_id == str(chat_id))
        )
        return result.scalar_one_or_none()


async def _require_user(update: Update, context: ContextTypes.DEFAULT_TYPE) -> User | None:
    """Get linked user or send auth prompt. Returns None if unlinked."""
    chat_id = str(update.effective_chat.id)
    user = await _get_user_by_chat_id(chat_id)
    if not user:
        lang = _lang(context)
        msg = update.message or update.callback_query.message
        await msg.reply_text(
            _t(lang, "unlinked"),
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
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input",
                "new_job_input_value", "new_job_ignore_dupes"]:
        context.user_data.pop(key, None)


def _progress_bar(pct: float, width: int = 10) -> str:
    filled = int(round(pct / 100 * width))
    return "\u2588" * filled + "\u2591" * (width - filled)


def _job_detail_text(job: ScrapingJob, lang: str = "en") -> str:
    """Build rich job detail text."""
    icon = STATUS_ICONS.get(job.status, "\u26AA")
    short_id = str(job.id)[:8]
    pct = float(job.progress_pct or 0)

    lines = [
        f"{icon} <b>Job {short_id}...</b>\n",
        f"<b>{_t(lang, 'lbl_type')}:</b> {job.job_type or 'full_pipeline'}",
        f"<b>{_t(lang, 'lbl_input')}:</b> <code>{(job.input_value or '')[:60]}</code>",
        f"<b>{_t(lang, 'lbl_status')}:</b> {job.status.upper()}",
    ]

    if job.status in ("running", "completed", "failed", "paused"):
        bar = _progress_bar(pct)
        lines.append(f"<b>{_t(lang, 'lbl_progress')}:</b> [{bar}] {pct:.0f}%")
        lines.append(
            f"<b>{_t(lang, 'lbl_items')}:</b> {job.processed_items or 0}/{job.total_items or '?'}"
            f" ({job.failed_items or 0} {_t(lang, 'lbl_failed')})"
        )

    if job.credits_used:
        lines.append(f"<b>{_t(lang, 'lbl_credits')}:</b> {job.credits_used:,}")
    if job.result_row_count:
        lines.append(f"<b>{_t(lang, 'lbl_results')}:</b> {job.result_row_count:,} {_t(lang, 'lbl_profiles')}")
    if job.created_at:
        lines.append(f"<b>{_t(lang, 'lbl_created')}:</b> {job.created_at.strftime('%Y-%m-%d %H:%M')}")
    if job.error_message:
        lines.append(f"\n\u26A0\uFE0F <b>{_t(lang, 'lbl_error')}:</b> {job.error_message[:200]}")

    return "\n".join(lines)


def _job_action_buttons(job: ScrapingJob, lang: str = "en") -> InlineKeyboardMarkup:
    """Build action buttons based on current job status."""
    buttons = []
    jid = str(job.id)

    if job.status == "running":
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_pause"), callback_data=f"action:pause:{jid}"),
            InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data=f"action:cancel:{jid}"),
        ])
    elif job.status == "paused":
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_resume"), callback_data=f"action:resume:{jid}"),
            InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data=f"action:cancel:{jid}"),
        ])
    elif job.status in ("failed",):
        pipeline_state = (job.error_details or {}).get("pipeline_state")
        if pipeline_state:
            buttons.append([
                InlineKeyboardButton(_t(lang, "btn_retry"), callback_data=f"action:resume:{jid}"),
            ])
    elif job.status == "queued":
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data=f"action:cancel:{jid}"),
        ])

    if job.status in ("running", "queued", "paused"):
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_refresh"), callback_data=f"job:{jid}"),
        ])

    buttons.append([
        InlineKeyboardButton(_t(lang, "btn_back_jobs"), callback_data="back:jobs"),
    ])

    return InlineKeyboardMarkup(buttons)


def _tb_order_detail_text(order: TrafficBotOrder, lang: str = "en") -> str:
    """Build rich traffic bot order detail text."""
    icon = TB_STATUS_ICONS.get(order.status, "\u26AA")
    short_id = str(order.id)[:8]
    svc_name = order.service.name if order.service else "Unknown"

    lines = [
        f"{icon} <b>TB Order {short_id}...</b>\n",
        f"<b>{_t(lang, 'tb_lbl_service')}:</b> {svc_name}",
        f"<b>{_t(lang, 'tb_lbl_link')}:</b> <code>{(order.link or '')[:60]}</code>",
        f"<b>{_t(lang, 'tb_lbl_quantity')}:</b> {order.quantity:,}",
        f"<b>{_t(lang, 'tb_lbl_cost')}:</b> RM{float(order.total_cost):.4f}",
        f"<b>{_t(lang, 'tb_lbl_status')}:</b> {order.status.upper().replace('_', ' ')}",
    ]

    if order.start_count is not None:
        lines.append(f"<b>{_t(lang, 'tb_lbl_start_count')}:</b> {order.start_count:,}")
    if order.remains is not None:
        lines.append(f"<b>{_t(lang, 'tb_lbl_remains')}:</b> {order.remains:,}")
    if order.external_order_id:
        lines.append(f"<b>{_t(lang, 'tb_lbl_ext_id')}:</b> {order.external_order_id}")
    if order.created_at:
        lines.append(f"<b>{_t(lang, 'tb_lbl_created')}:</b> {order.created_at.strftime('%Y-%m-%d %H:%M')}")
    if order.error_message:
        lines.append(f"\n\u26A0\uFE0F <b>{_t(lang, 'tb_lbl_error')}:</b> {order.error_message[:200]}")

    return "\n".join(lines)


def _tb_order_action_buttons(order: TrafficBotOrder, lang: str = "en") -> InlineKeyboardMarkup:
    """Build action buttons for a traffic bot order."""
    buttons = []
    oid = str(order.id)

    if order.status in ("pending", "processing", "in_progress"):
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_tb_refresh"), callback_data=f"tb_refresh:{oid}"),
        ])
    if order.status in ("pending", "processing", "in_progress"):
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_tb_cancel"), callback_data=f"tb_cancel_order:{oid}"),
        ])
    if order.status == "completed":
        buttons.append([
            InlineKeyboardButton(_t(lang, "btn_tb_refill"), callback_data=f"tb_refill:{oid}"),
        ])

    buttons.append([
        InlineKeyboardButton(_t(lang, "btn_tb_back"), callback_data="tb_back:orders"),
    ])

    return InlineKeyboardMarkup(buttons)


# ── /start ───────────────────────────────────────────────────────────────


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Link Telegram account to SocyBase via deep link token."""
    chat_id = str(update.effective_chat.id)
    lang = _lang(context)

    # Check if already linked
    user = await _get_user_by_chat_id(chat_id)
    if user:
        await update.message.reply_text(
            _t(lang, "start_linked", email=user.email),
            parse_mode="HTML",
            reply_markup=_kb(lang),
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
                        _t(lang, "start_link_ok", email=user.email),
                        parse_mode="HTML",
                        reply_markup=_kb(lang),
                    )
                    return
        await update.message.reply_text(
            _t(lang, "start_invalid_token"),
            parse_mode="HTML",
        )
    else:
        # New user — show bilingual language picker
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("\U0001F1EC\U0001F1E7 English", callback_data="lang:en")],
            [InlineKeyboardButton("\U0001F1E8\U0001F1F3 华语 (Chinese)", callback_data="lang:zh")],
        ])
        await update.message.reply_text(
            "\U0001F44B <b>Welcome to SocyBase Bot!</b>\n"
            "欢迎使用 SocyBase 机器人！\n\n"
            "Please choose your language:\n"
            "请选择您的语言：",
            parse_mode="HTML",
            reply_markup=keyboard,
        )


# ── /help ────────────────────────────────────────────────────────────────


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show command reference."""
    lang = _lang(context)
    await update.message.reply_text(
        _t(lang, "help_text"),
        parse_mode="HTML",
    )


# ── /cancel ──────────────────────────────────────────────────────────────


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel current flow."""
    cleared = False
    for key in ["new_job_platform", "new_job_scrape_type", "new_job_awaiting_input",
                "new_job_input_value", "new_job_ignore_dupes",
                "tb_category", "tb_service_id", "tb_service_name",
                "tb_link", "tb_quantity", "tb_awaiting_link", "tb_awaiting_quantity",
                "login_awaiting_email", "login_email"]:
        if context.user_data.pop(key, None) is not None:
            cleared = True
    lang = _lang(context)
    if cleared:
        await update.message.reply_text(_t(lang, "op_cancelled"))
    else:
        await update.message.reply_text(_t(lang, "nothing_cancel"))


# ── /login ──────────────────────────────────────────────────────────────


async def login_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start the email login flow."""
    chat_id = str(update.effective_chat.id)
    lang = _lang(context)

    user = await _get_user_by_chat_id(chat_id)
    if user:
        await update.message.reply_text(
            _t(lang, "login_already", email=user.email),
            parse_mode="HTML",
            reply_markup=_kb(lang),
        )
        return

    _clear_login_flow(context)

    context.user_data["login_awaiting_email"] = True
    await update.message.reply_text(
        _t(lang, "login_enter_email"),
        parse_mode="HTML",
    )


# ── /unlink ─────────────────────────────────────────────────────────────


async def unlink_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Disconnect Telegram from SocyBase account."""
    chat_id = str(update.effective_chat.id)
    lang = _lang(context)

    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.telegram_chat_id == chat_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            await update.message.reply_text(_t(lang, "unlink_not_linked"))
            return

        email = user.email
        user.telegram_chat_id = None
        await db.commit()

    _clear_login_flow(context)
    await update.message.reply_text(
        _t(lang, "unlink_ok", email=email),
        parse_mode="HTML",
    )


# ── /jobs ────────────────────────────────────────────────────────────────

JOBS_PAGE_SIZE = 5


async def _build_jobs_page(user_id, lang: str, page: int = 0):
    """Build jobs list text + buttons for a given page. Returns (text, markup, has_jobs)."""
    async with async_session() as db:
        # Get total count
        total = (await db.execute(
            select(func.count(ScrapingJob.id)).where(ScrapingJob.user_id == user_id)
        )).scalar() or 0

        result = await db.execute(
            select(ScrapingJob)
            .where(ScrapingJob.user_id == user_id)
            .order_by(ScrapingJob.created_at.desc())
            .offset(page * JOBS_PAGE_SIZE)
            .limit(JOBS_PAGE_SIZE)
        )
        jobs = result.scalars().all()

    if not jobs:
        return None, None, False

    total_pages = max(1, (total + JOBS_PAGE_SIZE - 1) // JOBS_PAGE_SIZE)
    lines = [_t(lang, "jobs_header")]
    if total_pages > 1:
        lines[0] += f" ({page + 1}/{total_pages})"

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

    # Pagination buttons
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("\u25C0 Prev", callback_data=f"jobs:page:{page - 1}"))
    if page < total_pages - 1:
        nav.append(InlineKeyboardButton("Next \u25B6", callback_data=f"jobs:page:{page + 1}"))
    if nav:
        buttons.append(nav)

    buttons.append([
        InlineKeyboardButton(_t(lang, "btn_new_job"), callback_data="newjob:start"),
    ])

    return "\n".join(lines), InlineKeyboardMarkup(buttons), True


async def jobs_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List recent scraping jobs."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    text, markup, has_jobs = await _build_jobs_page(user.id, lang, page=0)
    if not has_jobs:
        await update.message.reply_text(_t(lang, "jobs_empty"))
        return

    await update.message.reply_text(text, parse_mode="HTML", reply_markup=markup)


# ── /credits ─────────────────────────────────────────────────────────────


async def credits_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check credit balance."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    async with async_session() as db:
        result = await db.execute(
            select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
        )
        balance = result.scalar_one_or_none()

        active = (await db.execute(
            select(func.count(ScrapingJob.id)).where(
                ScrapingJob.user_id == user.id,
                ScrapingJob.status.in_(["running", "queued"]),
            )
        )).scalar() or 0

    if balance:
        await update.message.reply_text(
            _t(lang, "credits_header",
               balance=f"{balance.balance:,}",
               purchased=f"{balance.lifetime_purchased:,}",
               used=f"{balance.lifetime_used:,}",
               active=active),
            parse_mode="HTML",
        )
    else:
        await update.message.reply_text(_t(lang, "credits_none"))


# ── /status <job_id> ─────────────────────────────────────────────────────


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check status of a specific job."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    if not context.args:
        await update.message.reply_text(
            _t(lang, "status_usage"),
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
        await update.message.reply_text(_t(lang, "not_found_job"))
        return

    await update.message.reply_text(
        _job_detail_text(job, lang),
        parse_mode="HTML",
        reply_markup=_job_action_buttons(job, lang),
    )


# ── /newjob ──────────────────────────────────────────────────────────────


async def newjob_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start creating a new scraping job — step 1: choose platform."""
    user = await _require_user(update, context)
    if not user:
        return

    # Clear any previous flow state
    _clear_job_flow(context)
    _clear_tb_flow(context)

    await _send_platform_picker(update.message, context)


async def _send_platform_picker(message, context: ContextTypes.DEFAULT_TYPE):
    """Send the platform selection keyboard."""
    lang = _lang(context)
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
                f"{p.display_name} ({scrape_count})",
                callback_data=f"platform:{p.name}",
            )
        ])

    keyboard.append([InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="newjob:cancel")])

    await message.reply_text(
        _t(lang, "newjob_step1"),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── /tbwallet ────────────────────────────────────────────────────────────


async def tbwallet_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check traffic bot wallet balance."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    async with async_session() as db:
        wallet = await tb_svc.get_or_create_wallet(db, user.tenant_id)
        await db.commit()

    await update.message.reply_text(
        _t(lang, "tbwallet_header", balance=f"{float(wallet.balance):.2f}"),
        parse_mode="HTML",
    )


# ── /tborder ─────────────────────────────────────────────────────────────


async def tborder_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start placing a traffic bot order — step 1: choose category."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    _clear_tb_flow(context)
    _clear_job_flow(context)

    async with async_session() as db:
        categories = await tb_svc.get_categories(db)

    if not categories:
        await update.message.reply_text(_t(lang, "tborder_no_services"))
        return

    keyboard = []
    for cat in categories:
        keyboard.append([
            InlineKeyboardButton(cat, callback_data=f"tb_cat:{cat}")
        ])
    keyboard.append([InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="tb_cancel_flow")])

    await update.message.reply_text(
        _t(lang, "tborder_step1"),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── /tborders ────────────────────────────────────────────────────────────


async def tborders_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List recent traffic bot orders."""
    lang = _lang(context)
    user = await _require_user(update, context)
    if not user:
        return

    async with async_session() as db:
        orders, total = await tb_svc.list_orders(db, user.tenant_id, limit=5)

    if not orders:
        await update.message.reply_text(_t(lang, "tborders_empty"))
        return

    lines = [_t(lang, "tborders_header", total=total)]
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
        InlineKeyboardButton(_t(lang, "btn_tb_new"), callback_data="tb_start_order"),
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
    lang = _lang(context)

    # Rate limit check
    chat_id = str(query.from_user.id)
    if _is_rate_limited(chat_id):
        await query.edit_message_text(
            _t(lang, "rate_limited"),
            parse_mode="HTML",
        )
        return

    # ── Language selection ────────────────────────────────────────
    if data.startswith("lang:"):
        new_lang = data.split(":", 1)[1]
        context.user_data["lang"] = new_lang
        lang = new_lang
        user = await _get_user_by_chat_id(str(query.from_user.id))
        await query.edit_message_text(
            _t(lang, "lang_set"),
            parse_mode="HTML",
        )
        if user:
            await query.message.chat.send_message(
                _t(lang, "default_msg"),
                reply_markup=_kb(lang),
            )
        else:
            await query.message.chat.send_message(
                _t(lang, "start_welcome"),
                parse_mode="HTML",
            )
        return

    # ── Job detail ───────────────────────────────────────────────
    elif data.startswith("job:"):
        job_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            await query.edit_message_text(_t(lang, "link_first"))
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
            await query.edit_message_text(_t(lang, "not_found_job"))
            return

        await query.edit_message_text(
            _job_detail_text(job, lang),
            parse_mode="HTML",
            reply_markup=_job_action_buttons(job, lang),
        )

    # ── Back to jobs list / pagination ──────────────────────────
    elif data == "back:jobs" or data.startswith("jobs:page:"):
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        page = 0
        if data.startswith("jobs:page:"):
            try:
                page = int(data.split(":")[2])
            except (IndexError, ValueError):
                page = 0

        text, markup, has_jobs = await _build_jobs_page(user.id, lang, page=page)
        if not has_jobs:
            await query.edit_message_text(_t(lang, "jobs_empty_short"))
            return

        await query.edit_message_text(text, parse_mode="HTML", reply_markup=markup)

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
                await query.edit_message_text(_t(lang, "not_found_job"))
                return

            if action == "cancel":
                if job.status in ("running", "queued", "paused"):
                    job.status = "cancelled"
                    await db.commit()
                    await query.edit_message_text(
                        _t(lang, "job_cancelled", short_id=str(job.id)[:8], credits=job.credits_used or 0),
                        parse_mode="HTML",
                        reply_markup=InlineKeyboardMarkup([[
                            InlineKeyboardButton(_t(lang, "btn_back_jobs"), callback_data="back:jobs"),
                        ]]),
                    )
                else:
                    await query.answer(_t(lang, "cannot_cancel_job", status=job.status), show_alert=True)

            elif action == "pause":
                if job.status == "running":
                    job.status = "paused"
                    await db.commit()
                    await query.edit_message_text(
                        _job_detail_text(job, lang),
                        parse_mode="HTML",
                        reply_markup=_job_action_buttons(job, lang),
                    )
                else:
                    await query.answer(_t(lang, "cannot_pause_job", status=job.status), show_alert=True)

            elif action == "resume":
                if job.status in ("failed", "paused"):
                    pipeline_state = (job.error_details or {}).get("pipeline_state")
                    if not pipeline_state and job.status == "failed":
                        await query.answer(_t(lang, "no_checkpoint"), show_alert=True)
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
                        _job_detail_text(job, lang),
                        parse_mode="HTML",
                        reply_markup=_job_action_buttons(job, lang),
                    )
                else:
                    await query.answer(_t(lang, "cannot_resume_job", status=job.status), show_alert=True)

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
                    f"{p.display_name} ({scrape_count})",
                    callback_data=f"platform:{p.name}",
                )
            ])
        keyboard.append([InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="newjob:cancel")])

        await query.edit_message_text(
            _t(lang, "newjob_step1"),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── New job: cancel ──────────────────────────────────────────
    elif data == "newjob:cancel":
        _clear_job_flow(context)
        await query.edit_message_text(_t(lang, "newjob_cancelled"))

    # ── New job: platform selected ───────────────────────────────
    elif data.startswith("platform:"):
        platform_name = data.split(":", 1)[1]
        scrape_types = SCRAPE_TYPES.get(platform_name, [])

        if not scrape_types:
            await query.edit_message_text(_t(lang, "newjob_no_types", platform=platform_name))
            return

        context.user_data["new_job_platform"] = platform_name

        if len(scrape_types) == 1:
            st = scrape_types[0]
            context.user_data["new_job_scrape_type"] = st["id"]
            context.user_data["new_job_awaiting_input"] = True
            await query.edit_message_text(
                _t(lang, "newjob_step3",
                   platform=platform_name.title(),
                   stype=_sl(st["short"], lang),
                   prompt=_sl(st["input_prompt"], lang)),
                parse_mode="HTML",
            )
            return

        keyboard = []
        for st in scrape_types:
            keyboard.append([
                InlineKeyboardButton(
                    _sl(st["label"], lang),
                    callback_data=f"scrape:{st['id']}",
                )
            ])
        keyboard.append([
            InlineKeyboardButton(_t(lang, "btn_back"), callback_data="newjob:start"),
        ])

        await query.edit_message_text(
            _t(lang, "newjob_step2", platform=platform_name.title()),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── New job: scrape type selected ────────────────────────────
    elif data.startswith("scrape:"):
        scrape_type_id = data.split(":", 1)[1]
        platform_name = context.user_data.get("new_job_platform")

        if not platform_name:
            await query.edit_message_text(_t(lang, "session_expired_newjob"))
            return

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)

        if not st:
            await query.edit_message_text(_t(lang, "invalid_config"))
            return

        context.user_data["new_job_scrape_type"] = scrape_type_id
        context.user_data["new_job_awaiting_input"] = True

        await query.edit_message_text(
            _t(lang, "newjob_step3",
               platform=platform_name.title(),
               stype=_sl(st["short"], lang),
               prompt=_sl(st["input_prompt"], lang)),
            parse_mode="HTML",
        )

    # ── New job: toggle dedup ────────────────────────────────────
    elif data == "newjob:toggle_dedup":
        ignore_dupes = not context.user_data.get("new_job_ignore_dupes", False)
        context.user_data["new_job_ignore_dupes"] = ignore_dupes

        platform_name = context.user_data.get("new_job_platform", "?")
        scrape_type_id = context.user_data.get("new_job_scrape_type", "")
        input_value = context.user_data.get("new_job_input_value", "")

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)
        short_name = _sl(st["short"], lang) if st else scrape_type_id

        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        prev_info = None
        async with async_session() as db:
            prev_result = await db.execute(
                select(ScrapingJob).where(
                    ScrapingJob.tenant_id == user.tenant_id,
                    ScrapingJob.input_value == input_value,
                    ScrapingJob.status.in_(["completed", "paused", "failed"]),
                ).order_by(ScrapingJob.created_at.desc())
            )
            prev_jobs = prev_result.scalars().all()
            if prev_jobs:
                profiles_result = await db.execute(
                    select(func.count(distinct(ScrapedProfile.platform_user_id))).where(
                        ScrapedProfile.job_id.in_([j.id for j in prev_jobs]),
                        ScrapedProfile.scrape_status == "success",
                    )
                )
                total_profiles = profiles_result.scalar() or 0
                prev_info = {
                    "total_jobs": len(prev_jobs),
                    "total_profiles": total_profiles,
                    "last_date": prev_jobs[0].created_at.strftime("%Y-%m-%d") if prev_jobs[0].created_at else "?",
                }

            balance_result = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
            )
            balance = balance_result.scalar_one_or_none()
            credit_bal = balance.balance if balance else 0

        lines = [
            _t(lang, "newjob_confirm_title"),
            f"<b>{_t(lang, 'lbl_platform')}:</b> {platform_name.title()}",
            f"<b>{_t(lang, 'lbl_type')}:</b> {short_name}",
            f"<b>{_t(lang, 'lbl_input')}:</b> <code>{input_value[:60]}</code>",
        ]

        if prev_info:
            lines.append(_t(lang, "newjob_prev_scraped",
                            jobs=prev_info["total_jobs"],
                            profiles=f"{prev_info['total_profiles']:,}",
                            date=prev_info["last_date"]))

        dedup_icon = "\u2705" if ignore_dupes else "\u274C"
        dedup_label = _t(lang, "newjob_dedup_on") if ignore_dupes else _t(lang, "newjob_dedup_off")
        lines.append(f"\n<b>{_t(lang, 'lbl_skip_dupes')}:</b> {dedup_icon} {dedup_label}")
        lines.append(f"\U0001F4B3 <b>{_t(lang, 'lbl_credits')}:</b> {credit_bal:,} {_t(lang, 'lbl_available')}")

        buttons = [
            [
                InlineKeyboardButton(
                    f"{'✅' if ignore_dupes else '☐'} {_t(lang, 'btn_skip_dupes')}",
                    callback_data="newjob:toggle_dedup",
                ),
            ],
            [
                InlineKeyboardButton(_t(lang, "btn_create_job"), callback_data="newjob:confirm"),
                InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="newjob:cancel"),
            ],
        ]

        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
        )

    # ── New job: confirm and create ───────────────────────────────
    elif data == "newjob:confirm":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        platform_name = context.user_data.get("new_job_platform")
        scrape_type_id = context.user_data.get("new_job_scrape_type")
        input_value = context.user_data.get("new_job_input_value")
        ignore_dupes = context.user_data.get("new_job_ignore_dupes", False)

        if not all([platform_name, scrape_type_id, input_value]):
            _clear_job_flow(context)
            await query.edit_message_text(_t(lang, "session_expired_newjob"))
            return

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)
        if not st:
            _clear_job_flow(context)
            await query.edit_message_text(_t(lang, "invalid_config"))
            return

        _clear_job_flow(context)

        async with async_session() as db:
            result = await db.execute(
                select(Platform).where(Platform.name == platform_name)
            )
            plat = result.scalar_one_or_none()
            if not plat:
                await query.edit_message_text(_t(lang, "session_expired_newjob"))
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
                    "ignore_duplicate_users": ignore_dupes,
                },
            )
            db.add(job)
            await db.flush()

            if st["job_type"] == "post_discovery":
                from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
                task = run_post_discovery_pipeline.delay(str(job.id))
            else:
                from app.scraping.pipeline import run_scraping_pipeline
                task = run_scraping_pipeline.delay(str(job.id))

            job.celery_task_id = task.id
            await db.commit()

            short_id = str(job.id)[:8]
            dedup_line = _t(lang, "newjob_dedup_note") if ignore_dupes else ""

            await query.edit_message_text(
                _t(lang, "newjob_created",
                   short_id=short_id,
                   platform=platform_name.title(),
                   stype=_sl(st["short"], lang),
                   input=input_value[:60],
                   dedup_line=dedup_line),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton(_t(lang, "btn_view_job"), callback_data=f"job:{job.id}")],
                    [InlineKeyboardButton(_t(lang, "btn_my_jobs"), callback_data="back:jobs")],
                ]),
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
            await query.edit_message_text(_t(lang, "tborder_no_services"))
            return

        keyboard = []
        for cat in categories:
            keyboard.append([
                InlineKeyboardButton(cat, callback_data=f"tb_cat:{cat}")
            ])
        keyboard.append([InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="tb_cancel_flow")])

        await query.edit_message_text(
            _t(lang, "tborder_step1"),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    elif data == "tb_cancel_flow":
        _clear_tb_flow(context)
        await query.edit_message_text(_t(lang, "tb_order_cancelled_flow"))

    elif data.startswith("tb_cat:"):
        category = data.split(":", 1)[1]
        context.user_data["tb_category"] = category

        async with async_session() as db:
            services = await tb_svc.list_services(db, enabled_only=True, category=category)

        if not services:
            await query.edit_message_text(_t(lang, "tborder_no_services_cat", category=category))
            return

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
            InlineKeyboardButton(_t(lang, "btn_back"), callback_data="tb_start_order"),
            InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="tb_cancel_flow"),
        ])
        keyboard = [row for row in keyboard if row]

        await query.edit_message_text(
            _t(lang, "tborder_step2", category=category, count=len(services)),
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
            InlineKeyboardButton(_t(lang, "btn_back"), callback_data="tb_start_order"),
            InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="tb_cancel_flow"),
        ])

        await query.edit_message_text(
            _t(lang, "tborder_step2_page", category=category, page=page + 1, total=total_pages),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    elif data.startswith("tb_svc:"):
        service_id = data.split(":", 1)[1]

        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            await query.edit_message_text(_t(lang, "tborder_svc_not_found"))
            return

        context.user_data["tb_service_id"] = str(service.id)
        context.user_data["tb_service_name"] = service.name
        context.user_data["tb_awaiting_link"] = True

        rate_with_fee = float(service.rate) * (1 + float(service.fee_pct) / 100)
        await query.edit_message_text(
            _t(lang, "tborder_step3",
               service=service.name,
               rate=f"{rate_with_fee:.2f}",
               min=f"{service.min_quantity:,}",
               max=f"{service.max_quantity:,}"),
            parse_mode="HTML",
        )

    elif data == "tb_confirm":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        service_id = context.user_data.get("tb_service_id")
        link = context.user_data.get("tb_link")
        quantity = context.user_data.get("tb_quantity")

        if not all([service_id, link, quantity]):
            _clear_tb_flow(context)
            await query.edit_message_text(_t(lang, "session_expired_tborder"))
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
                    _t(lang, "tborder_placed",
                       short_id=short_id, service=svc_name,
                       link=link[:60], qty=f"{quantity:,}",
                       cost=f"{float(order.total_cost):.4f}",
                       icon=icon, status=order.status.upper()),
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton(_t(lang, "btn_tb_view"), callback_data=f"tb_order:{order.id}")],
                        [InlineKeyboardButton(_t(lang, "btn_tb_my_orders"), callback_data="tb_back:orders")],
                    ]),
                )
            except ValueError as exc:
                await query.edit_message_text(
                    _t(lang, "tborder_failed", error=str(exc)),
                    parse_mode="HTML",
                )
            except Exception as exc:
                logger.error("TB order failed via Telegram: %s", exc)
                await query.edit_message_text(
                    _t(lang, "tborder_failed_unexpected"),
                    parse_mode="HTML",
                )

    elif data.startswith("tb_order:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)

        if not order or order.tenant_id != user.tenant_id:
            await query.edit_message_text(_t(lang, "not_found_order"))
            return

        await query.edit_message_text(
            _tb_order_detail_text(order, lang),
            parse_mode="HTML",
            reply_markup=_tb_order_action_buttons(order, lang),
        )

    elif data.startswith("tb_refresh:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text(_t(lang, "not_found_order"))
                return
            order = await tb_svc.refresh_order_status(db, order)
            await db.commit()

        await query.edit_message_text(
            _tb_order_detail_text(order, lang),
            parse_mode="HTML",
            reply_markup=_tb_order_action_buttons(order, lang),
        )

    elif data.startswith("tb_cancel_order:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text(_t(lang, "not_found_order"))
                return

            try:
                order = await tb_svc.cancel_order(db, order)
                await db.commit()
                await query.edit_message_text(
                    _t(lang, "tb_order_cancelled",
                       short_id=str(order.id)[:8],
                       cost=f"{float(order.total_cost):.4f}"),
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup([[
                        InlineKeyboardButton(_t(lang, "btn_tb_back"), callback_data="tb_back:orders"),
                    ]]),
                )
            except ValueError as exc:
                await query.answer(str(exc), show_alert=True)
            except Exception:
                await query.answer(_t(lang, "tb_cancel_failed"), show_alert=True)

    # ── TB: Refill order ─────────────────────────────────────────
    elif data.startswith("tb_refill:"):
        order_id = data.split(":", 1)[1]
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            order = await tb_svc.get_order(db, order_id)
            if not order or order.tenant_id != user.tenant_id:
                await query.edit_message_text(_t(lang, "not_found_order"))
                return

            try:
                await tb_svc.refill_order(db, order)
                await query.answer(_t(lang, "tb_refill_ok"), show_alert=True)
                # Refresh the detail view
                order = await tb_svc.get_order(db, order_id)
                await query.edit_message_text(
                    _tb_order_detail_text(order, lang=lang),
                    parse_mode="HTML",
                    reply_markup=_tb_order_action_buttons(order, lang=lang),
                )
            except ValueError as exc:
                await query.answer(str(exc), show_alert=True)
            except Exception:
                await query.answer(_t(lang, "tb_refill_failed"), show_alert=True)

    # ── TB: Back to orders list ──────────────────────────────────
    elif data == "tb_back:orders":
        user = await _get_user_by_chat_id(str(query.from_user.id))
        if not user:
            return

        async with async_session() as db:
            orders, total = await tb_svc.list_orders(db, user.tenant_id, limit=5)

        if not orders:
            await query.edit_message_text(_t(lang, "tborders_empty_short"))
            return

        lines = [_t(lang, "tborders_header", total=total)]
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
            InlineKeyboardButton(_t(lang, "btn_tb_new"), callback_data="tb_start_order"),
        ])

        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
        )


# ── Language Command ──────────────────────────────────────────────────────


async def language_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show language selection."""
    lang = _lang(context)
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("\U0001F1EC\U0001F1E7 English", callback_data="lang:en")],
        [InlineKeyboardButton("\U0001F1E8\U0001F1F3 华语 (Chinese)", callback_data="lang:zh")],
    ])
    await update.message.reply_text(
        _t(lang, "lang_choose"),
        parse_mode="HTML",
        reply_markup=keyboard,
    )


# ── Message Handler (for URL / input during flows) ───────────────────────


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages — keyboard buttons and text input during flows."""
    text = (update.message.text or "").strip()
    lang = _lang(context)

    # Rate limit check
    chat_id = str(update.effective_user.id)
    if _is_rate_limited(chat_id):
        await update.message.reply_text(_t(lang, "rate_limited"), parse_mode="HTML")
        return

    # ── Handle persistent keyboard button presses (both EN/ZH) ──
    cmd = _KB_COMMANDS.get(text)
    if cmd == "newjob":
        return await newjob_command(update, context)
    elif cmd == "jobs":
        return await jobs_command(update, context)
    elif cmd == "credits":
        return await credits_command(update, context)
    elif cmd == "help":
        return await help_command(update, context)
    elif cmd == "tborder":
        return await tborder_command(update, context)
    elif cmd == "tborders":
        return await tborders_command(update, context)
    elif cmd == "tbwallet":
        return await tbwallet_command(update, context)
    elif cmd == "language":
        return await language_command(update, context)

    # ── Login flow: awaiting email ────────────────────────────────
    if context.user_data.get("login_awaiting_email"):
        email = text.lower().strip()
        if not EMAIL_RE.match(email):
            await update.message.reply_text(_t(lang, "login_invalid_email"))
            return

        # Look up user by email
        async with async_session() as db:
            result = await db.execute(
                select(User).where(func.lower(User.email) == email)
            )
            user = result.scalar_one_or_none()

        if not user:
            await update.message.reply_text(_t(lang, "login_no_account"))
            return

        # Check if this account is already linked to another Telegram
        if user.telegram_chat_id and user.telegram_chat_id != str(update.effective_chat.id):
            await update.message.reply_text(_t(lang, "login_linked_other"))
            return

        # Link account directly (no OTP — email existence is verification)
        chat_id = str(update.effective_chat.id)
        async with async_session() as db:
            result = await db.execute(
                select(User).where(func.lower(User.email) == email)
            )
            u = result.scalar_one_or_none()
            if u:
                u.telegram_chat_id = chat_id
                await db.commit()

        _clear_login_flow(context)

        # Try to delete the email message for privacy
        try:
            await update.message.delete()
        except Exception:
            pass

        await update.effective_chat.send_message(
            _t(lang, "login_success", email=email),
            parse_mode="HTML",
            reply_markup=_kb(lang),
        )
        return

    # ── Traffic bot: awaiting link input ──────────────────────────
    if context.user_data.get("tb_awaiting_link"):
        user = await _require_user(update, context)
        if not user:
            return

        link = text
        if not link:
            await update.message.reply_text(_t(lang, "send_valid_link"))
            return

        context.user_data["tb_awaiting_link"] = False
        context.user_data["tb_link"] = link

        service_id = context.user_data.get("tb_service_id")
        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            _clear_tb_flow(context)
            await update.message.reply_text(_t(lang, "tborder_svc_not_found"))
            return

        context.user_data["tb_awaiting_quantity"] = True

        await update.message.reply_text(
            _t(lang, "tborder_step4",
               service=service.name,
               link=link[:60],
               min=f"{service.min_quantity:,}",
               max=f"{service.max_quantity:,}"),
            parse_mode="HTML",
        )
        return

    # ── Traffic bot: awaiting quantity input ───────────────────────
    if context.user_data.get("tb_awaiting_quantity"):
        user = await _require_user(update, context)
        if not user:
            return

        try:
            quantity = int(text.replace(",", ""))
        except (ValueError, TypeError):
            await update.message.reply_text(_t(lang, "send_valid_number"))
            return

        service_id = context.user_data.get("tb_service_id")
        link = context.user_data.get("tb_link")

        async with async_session() as db:
            service = await tb_svc.get_service(db, service_id)

        if not service:
            _clear_tb_flow(context)
            await update.message.reply_text(_t(lang, "tborder_svc_not_found"))
            return

        if quantity < service.min_quantity or quantity > service.max_quantity:
            await update.message.reply_text(
                _t(lang, "tborder_qty_range",
                   min=f"{service.min_quantity:,}",
                   max=f"{service.max_quantity:,}")
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

        wallet_line = _t(lang, "tborder_wallet_ok", balance=f"{balance:.2f}") if enough else _t(lang, "tborder_wallet_low", balance=f"{balance:.2f}")

        await update.message.reply_text(
            _t(lang, "tborder_confirm",
               service=service.name,
               link=(link or "")[:60],
               qty=f"{quantity:,}",
               base=f"{pricing['base_cost']:.4f}",
               fee=f"{pricing['fee_amount']:.4f}",
               total=f"{total:.4f}",
               wallet_line=wallet_line),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton(_t(lang, "btn_confirm_order"), callback_data="tb_confirm"),
                    InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="tb_cancel_flow"),
                ],
            ]) if enough else InlineKeyboardMarkup([
                [InlineKeyboardButton(_t(lang, "btn_cancel_insuf"), callback_data="tb_cancel_flow")],
            ]),
        )
        return

    # ── URL/input during scraping job creation flow ───────────────
    if context.user_data.get("new_job_awaiting_input"):
        user = await _require_user(update, context)
        if not user:
            return

        platform_name = context.user_data.get("new_job_platform")
        scrape_type_id = context.user_data.get("new_job_scrape_type")

        if not platform_name or not scrape_type_id:
            await update.message.reply_text(_t(lang, "session_expired_newjob"))
            _clear_job_flow(context)
            return

        scrape_types = SCRAPE_TYPES.get(platform_name, [])
        st = next((s for s in scrape_types if s["id"] == scrape_type_id), None)
        if not st:
            await update.message.reply_text(_t(lang, "invalid_config"))
            _clear_job_flow(context)
            return

        input_value = update.message.text.strip()

        # Basic validation
        if not input_value:
            await update.message.reply_text(_t(lang, "send_valid_url"))
            return

        # URL format validation
        err = _validate_fb_input(input_value, st["input_type"], lang=lang)
        if err:
            await update.message.reply_text(err, parse_mode="HTML")
            return

        # Save input and move to confirmation step
        context.user_data["new_job_awaiting_input"] = False
        context.user_data["new_job_input_value"] = input_value

        # Pre-check: look for previous jobs with same input
        prev_info = None
        async with async_session() as db:
            prev_result = await db.execute(
                select(ScrapingJob).where(
                    ScrapingJob.tenant_id == user.tenant_id,
                    ScrapingJob.input_value == input_value,
                    ScrapingJob.status.in_(["completed", "paused", "failed"]),
                ).order_by(ScrapingJob.created_at.desc())
            )
            prev_jobs = prev_result.scalars().all()
            if prev_jobs:
                profiles_result = await db.execute(
                    select(func.count(distinct(ScrapedProfile.platform_user_id))).where(
                        ScrapedProfile.job_id.in_([j.id for j in prev_jobs]),
                        ScrapedProfile.scrape_status == "success",
                    )
                )
                total_profiles = profiles_result.scalar() or 0
                prev_info = {
                    "total_jobs": len(prev_jobs),
                    "total_profiles": total_profiles,
                    "last_date": prev_jobs[0].created_at.strftime("%Y-%m-%d") if prev_jobs[0].created_at else "?",
                }

            # Check credit balance
            balance_result = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
            )
            balance = balance_result.scalar_one_or_none()
            credit_bal = balance.balance if balance else 0

        # Default: enable dedup if previously scraped, else off
        ignore_dupes = bool(prev_info)
        context.user_data["new_job_ignore_dupes"] = ignore_dupes

        # Build confirmation message
        lines = [
            _t(lang, "newjob_confirm_title"),
            f"<b>{_t(lang, 'lbl_platform')}:</b> {platform_name.title()}",
            f"<b>{_t(lang, 'lbl_type')}:</b> {_sl(st['short'], lang)}",
            f"<b>{_t(lang, 'lbl_input')}:</b> <code>{input_value[:60]}</code>",
        ]

        if prev_info:
            lines.append(
                _t(lang, "newjob_prev_scraped",
                   jobs=prev_info['total_jobs'],
                   profiles=f"{prev_info['total_profiles']:,}",
                   date=prev_info['last_date'])
            )

        dedup_icon = "\u2705" if ignore_dupes else "\u274C"
        dedup_label = _t(lang, "newjob_dedup_on") if ignore_dupes else _t(lang, "newjob_dedup_off")
        lines.append(f"\n<b>{_t(lang, 'lbl_skip_dupes')}:</b> {dedup_icon} {dedup_label}")
        lines.append(f"\U0001F4B3 <b>{_t(lang, 'lbl_credits')}:</b> {credit_bal:,} {_t(lang, 'lbl_available')}")

        buttons = [
            [
                InlineKeyboardButton(
                    f"{'✅' if ignore_dupes else '☐'} {_t(lang, 'btn_skip_dupes')}",
                    callback_data="newjob:toggle_dedup",
                ),
            ],
            [
                InlineKeyboardButton(_t(lang, "btn_create_job"), callback_data="newjob:confirm"),
                InlineKeyboardButton(_t(lang, "btn_cancel"), callback_data="newjob:cancel"),
            ],
        ]

        await update.message.reply_text(
            "\n".join(lines),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
        )
        return

    # ── Default: show help ────────────────────────────────────────
    await update.message.reply_text(
        _t(lang, "default_msg"),
        reply_markup=_kb(lang),
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
        BotCommand("language", "Change language / 更改语言"),
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
    app.add_handler(CommandHandler("language", language_command))
    app.add_handler(CommandHandler("cancel", cancel_command))
    app.add_handler(CallbackQueryHandler(callback_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    return app
