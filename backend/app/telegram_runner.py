"""Entry point to run the SocyBase Telegram bot in polling mode.

Supports auto-restart when settings are updated via the Admin UI.
Uses Redis signaling for restart triggers and heartbeat status.
"""

import asyncio
import logging

import redis as sync_redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

REDIS_KEY_RESTART = "telegram_bot:restart"
REDIS_KEY_STATUS = "telegram_bot:status"
HEARTBEAT_TTL = 15  # seconds
HEARTBEAT_INTERVAL = 10  # seconds
RESTART_CHECK_INTERVAL = 5  # seconds
TOKEN_CHECK_INTERVAL = 30  # seconds


def _get_redis() -> sync_redis.Redis:
    from app.config import get_settings
    return sync_redis.from_url(get_settings().redis_url, decode_responses=True)


def _set_status(r: sync_redis.Redis, status: str) -> None:
    """Set bot status in Redis with TTL heartbeat."""
    try:
        r.setex(REDIS_KEY_STATUS, HEARTBEAT_TTL, status)
    except Exception:
        logger.warning("Failed to set bot status in Redis", exc_info=True)


def _check_restart_signal(r: sync_redis.Redis) -> bool:
    """Check and consume the restart signal from Redis."""
    try:
        val = r.get(REDIS_KEY_RESTART)
        if val:
            r.delete(REDIS_KEY_RESTART)
            return True
    except Exception:
        logger.warning("Failed to check restart signal in Redis", exc_info=True)
    return False


async def _run_bot_loop() -> None:
    """Main loop: wait for token, run bot, restart on signal."""
    from app.services.telegram_bot import get_bot_token, create_bot_app

    r = _get_redis()

    while True:
        # Phase 1: Wait for a valid token
        token = await get_bot_token()
        if not token:
            _set_status(r, "waiting_for_token")
            logger.info(
                "Telegram bot token not configured. "
                "Checking again in %ds...", TOKEN_CHECK_INTERVAL,
            )
            # While waiting for token, also check for restart signal (clears stale signals)
            _check_restart_signal(r)
            await asyncio.sleep(TOKEN_CHECK_INTERVAL)
            continue

        # Phase 2: Start the bot
        logger.info("Starting SocyBase Telegram bot (polling mode)...")
        _set_status(r, "restarting")

        try:
            app = create_bot_app(token)
        except Exception:
            logger.error("Failed to create bot application", exc_info=True)
            _set_status(r, "offline")
            await asyncio.sleep(TOKEN_CHECK_INTERVAL)
            continue

        try:
            async with app:
                await app.start()
                await app.updater.start_polling(drop_pending_updates=True)
                logger.info("Telegram bot is now polling.")
                _set_status(r, "running")

                # Phase 3: Keep running, refresh heartbeat, check for restart signal
                heartbeat_counter = 0
                while True:
                    await asyncio.sleep(RESTART_CHECK_INTERVAL)
                    heartbeat_counter += RESTART_CHECK_INTERVAL

                    # Refresh heartbeat
                    if heartbeat_counter >= HEARTBEAT_INTERVAL:
                        _set_status(r, "running")
                        heartbeat_counter = 0

                    # Check for restart signal
                    if _check_restart_signal(r):
                        logger.info("Restart signal received. Stopping bot...")
                        _set_status(r, "restarting")
                        break

                # Phase 4: Graceful shutdown
                await app.updater.stop()
                await app.stop()
                logger.info("Bot stopped. Restarting with new settings...")

        except Exception:
            logger.error("Bot crashed unexpectedly", exc_info=True)
            _set_status(r, "offline")
            await asyncio.sleep(5)


def main() -> None:
    asyncio.run(_run_bot_loop())


if __name__ == "__main__":
    main()
