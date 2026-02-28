from urllib.parse import urlparse, urlunparse
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "SocyBase"
    app_env: str = "development"
    app_debug: bool = True
    backend_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"

    # Port (Railway injects PORT)
    port: int = 8000

    # Database — Railway provides DATABASE_URL as postgresql://
    database_url: str = "postgresql+asyncpg://socybase:changeme@postgres:5432/socybase"

    @property
    def async_database_url(self) -> str:
        """Convert standard postgres URL to asyncpg format for SQLAlchemy."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    # Redis — Railway provides a single REDIS_URL; Celery uses different DB numbers
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    def _redis_with_db(self, db: int) -> str:
        """Replace Redis DB number in URL using proper URL parsing."""
        parsed = urlparse(self.redis_url)
        return urlunparse(parsed._replace(path=f"/{db}"))

    @property
    def effective_celery_broker_url(self) -> str:
        """Use explicit CELERY_BROKER_URL if set, otherwise derive from REDIS_URL."""
        if self.celery_broker_url:
            return self.celery_broker_url
        return self._redis_with_db(1)

    @property
    def effective_celery_result_backend(self) -> str:
        """Use explicit CELERY_RESULT_BACKEND if set, otherwise derive from REDIS_URL."""
        if self.celery_result_backend:
            return self.celery_result_backend
        return self._redis_with_db(2)

    # JWT — MUST be overridden via JWT_SECRET_KEY env var in production
    jwt_secret_key: str = "changeme_jwt_secret_at_least_32_chars_long"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Facebook Graph API (akng.io.vn)
    akng_base_url: str = "https://api.akng.io.vn/graph"
    akng_access_token: str = "0a3f3a286bc6bc279bd5f051b0bd9996"
    akng_api_version: str = "v19.0"
    akng_rate_limit_per_second: int = 10

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""

    @property
    def effective_google_redirect_uri(self) -> str:
        """Default to BACKEND_URL + callback path if not explicitly set."""
        if self.google_redirect_uri:
            return self.google_redirect_uri
        return f"{self.backend_url}/api/v1/auth/google/callback"

    # Telegram Bot
    telegram_bot_token: str = ""

    # WhatsApp Notifications (Baileys microservice)
    whatsapp_service_url: str = "http://whatsapp:3001"
    whatsapp_admin_number: str = ""  # e.g. "60123456789"

    # OpenAI
    openai_api_key: str = ""

    # Meta Marketing API (Facebook Ads)
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_redirect_uri: str = ""
    token_encryption_key: str = ""  # Fernet key for encrypting stored tokens

    @property
    def effective_meta_redirect_uri(self) -> str:
        """Default to BACKEND_URL + callback path if not explicitly set."""
        if self.meta_redirect_uri:
            return self.meta_redirect_uri
        return f"{self.backend_url}/api/v1/fb-ads/callback"

    # Traffic Bot (BulkProviders)
    traffic_bot_api_key: str = ""
    traffic_bot_api_url: str = "https://bulkproviders.com/api/v2"

    # Stripe
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""

    # Email
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = "noreply@socybase.com"

    # Super Admin
    super_admin_email: str = "admin@socybase.com"
    super_admin_password: str = "Admin123"

    # File Storage
    upload_dir: str = "/app/uploads"
    export_dir: str = "/app/exports"
    max_upload_size_mb: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [
            origin.strip().rstrip("/")
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]
        # Always include frontend_url so CORS works even if CORS_ORIGINS is not updated
        frontend = self.frontend_url.strip().rstrip("/")
        if frontend and frontend not in origins:
            origins.append(frontend)
        return origins

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
