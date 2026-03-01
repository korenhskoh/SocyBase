"""Entry point to run the SocyBase Telegram bot in polling mode.

If TELEGRAM_BOT_TOKEN is not set, the process sleeps indefinitely
instead of crash-looping. Tenants configure their own bot tokens
via tenant settings — this global runner is optional.
"""

import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    from app.services.telegram_bot import get_bot_token_sync, create_bot_app

    token = get_bot_token_sync()
    if not token:
        logger.warning(
            "Telegram bot token not configured. "
            "Set it via Admin Settings UI or TELEGRAM_BOT_TOKEN env var. Sleeping..."
        )
        # Sleep instead of exiting to prevent Railway restart loops
        while True:
            time.sleep(3600)

    logger.info("Starting SocyBase Telegram bot (polling mode)...")
    app = create_bot_app()
    app.run_polling()


if __name__ == "__main__":
    main()
