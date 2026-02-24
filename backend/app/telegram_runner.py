"""Entry point to run the SocyBase Telegram bot in polling mode."""

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    from app.config import get_settings

    settings = get_settings()
    if not settings.telegram_bot_token:
        logger.error("TELEGRAM_BOT_TOKEN is not set. Exiting.")
        sys.exit(1)

    from app.services.telegram_bot import create_bot_app

    logger.info("Starting SocyBase Telegram bot (polling mode)...")
    app = create_bot_app()
    app.run_polling()


if __name__ == "__main__":
    main()
