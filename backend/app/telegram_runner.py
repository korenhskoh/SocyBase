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
    from app.config import get_settings

    settings = get_settings()
    if not settings.telegram_bot_token:
        logger.warning(
            "TELEGRAM_BOT_TOKEN is not set. "
            "Global bot disabled — tenants can configure their own bots in tenant settings. "
            "Set TELEGRAM_BOT_TOKEN env var to enable the global bot. Sleeping..."
        )
        # Sleep instead of exiting to prevent Railway restart loops
        while True:
            time.sleep(3600)

    from app.services.telegram_bot import create_bot_app

    logger.info("Starting SocyBase Telegram bot (polling mode)...")
    app = create_bot_app()
    app.run_polling()


if __name__ == "__main__":
    main()
