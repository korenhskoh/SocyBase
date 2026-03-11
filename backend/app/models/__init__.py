from app.models.tenant import Tenant
from app.models.user import User
from app.models.credit import CreditBalance, CreditTransaction, CreditPackage
from app.models.payment import Payment
from app.models.platform import Platform
from app.models.job import ScrapingJob, ScrapedProfile, ExtractedComment
from app.models.audit import AuditLog
from app.models.system import SystemSetting, NotificationTemplate
from app.models.fan_analysis import FanAnalysisCache
from app.models.fb_ads import (
    FBConnection, FBAdAccount, FBPage, FBPixel,
    FBCampaign, FBAdSet, FBAd, FBInsight,
    FBInsightScore, FBWinningAd,
    AICampaign, AICampaignAdSet, AICampaignAd,
)
from app.models.competitor import CompetitorPage
from app.models.fb_cookie_session import FBCookieSession
from app.models.browser_scrape_task import BrowserScrapeTask
from app.models.traffic_bot import (
    TrafficBotWallet, TrafficBotTransaction,
    TrafficBotService, TrafficBotOrder,
)
from app.models.fb_live_sell import LiveSession, LiveComment

__all__ = [
    "Tenant",
    "User",
    "CreditBalance",
    "CreditTransaction",
    "CreditPackage",
    "Payment",
    "Platform",
    "ScrapingJob",
    "ScrapedProfile",
    "ExtractedComment",
    "AuditLog",
    "SystemSetting",
    "NotificationTemplate",
    "FanAnalysisCache",
    # FB Ads
    "FBConnection",
    "FBAdAccount",
    "FBPage",
    "FBPixel",
    "FBCampaign",
    "FBAdSet",
    "FBAd",
    "FBInsight",
    "FBInsightScore",
    "FBWinningAd",
    "AICampaign",
    "AICampaignAdSet",
    "AICampaignAd",
    # Competitors
    "CompetitorPage",
    # Cookie Sessions
    "FBCookieSession",
    # Browser Scrape Tasks
    "BrowserScrapeTask",
    # Traffic Bot
    "TrafficBotWallet",
    "TrafficBotTransaction",
    "TrafficBotService",
    "TrafficBotOrder",
    # Live Sell
    "LiveSession",
    "LiveComment",
]
