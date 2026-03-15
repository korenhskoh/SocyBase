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
from app.models.fb_action_batch import FBActionBatch
from app.models.fb_action_log import FBActionLog
from app.models.fb_login_batch import FBLoginBatch
from app.models.fb_login_result import FBLoginResult
from app.models.browser_scrape_task import BrowserScrapeTask
from app.models.traffic_bot import (
    TrafficBotWallet, TrafficBotTransaction,
    TrafficBotService, TrafficBotOrder,
)
from app.models.fb_live_sell import LiveSession, LiveComment
from app.models.fb_live_engage import FBLiveEngageSession, FBLiveEngageLog
from app.models.ai_search_history import AISearchHistory
from app.models.quick_scan_history import QuickScanHistory

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
    # FB Action Bot
    "FBActionBatch",
    "FBActionLog",
    # FB Bulk Login
    "FBLoginBatch",
    "FBLoginResult",
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
    # Live Engage
    "FBLiveEngageSession",
    "FBLiveEngageLog",
    # AI Search History
    "AISearchHistory",
    # Quick Scan History
    "QuickScanHistory",
]
