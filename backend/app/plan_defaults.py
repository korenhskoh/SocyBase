"""
Plan-based default settings for tenant tiers.

Each plan defines defaults for all configurable limits. Tenant-level overrides
in ``tenant.settings`` take precedence; these serve as the fallback.

Usage:
    from app.plan_defaults import resolve_setting

    max_concurrent = resolve_setting(tenant, "max_concurrent_jobs")
"""

from __future__ import annotations

from typing import Any

# ── Plan tier defaults ────────────────────────────────────────────────
# Keys must match the settings keys used in jobs.py and both pipelines.

PLAN_DEFAULTS: dict[str, dict[str, Any]] = {
    "free": {
        "max_concurrent_jobs": 1,
        "max_jobs_per_day": 5,
        "max_comment_pages": 50,
        "max_pages": 10,             # post discovery pages
        "api_rate_limit_tenant": 2,   # per-tenant req/sec
        "max_users": 1,
    },
    "starter": {
        "max_concurrent_jobs": 2,
        "max_jobs_per_day": 20,
        "max_comment_pages": 100,
        "max_pages": 30,
        "api_rate_limit_tenant": 3,
        "max_users": 3,
    },
    "growth": {
        "max_concurrent_jobs": 3,
        "max_jobs_per_day": 50,
        "max_comment_pages": 200,
        "max_pages": 50,
        "api_rate_limit_tenant": 4,
        "max_users": 5,
    },
    "professional": {
        "max_concurrent_jobs": 5,
        "max_jobs_per_day": 100,
        "max_comment_pages": 500,
        "max_pages": 100,
        "api_rate_limit_tenant": 5,
        "max_users": 15,
    },
    "enterprise": {
        "max_concurrent_jobs": 10,
        "max_jobs_per_day": 500,
        "max_comment_pages": 1000,
        "max_pages": 500,
        "api_rate_limit_tenant": 8,
        "max_users": 50,
    },
}

# Hard-coded fallback if the plan name is unknown (same as "free")
_FALLBACK_DEFAULTS: dict[str, Any] = PLAN_DEFAULTS["free"]


def get_plan_defaults(plan: str) -> dict[str, Any]:
    """Return the full defaults dict for a plan tier."""
    return PLAN_DEFAULTS.get(plan, _FALLBACK_DEFAULTS)


def resolve_setting(tenant, key: str, *, job_settings: dict | None = None) -> Any:
    """Resolve a setting value with the following priority:

    1. ``job_settings[key]`` — per-job override (if provided)
    2. ``tenant.settings[key]`` — tenant-level override
    3. ``PLAN_DEFAULTS[tenant.plan][key]`` — plan-tier default
    4. ``_FALLBACK_DEFAULTS[key]`` — hard-coded fallback

    ``tenant`` is expected to be a Tenant ORM instance (or None).
    """
    # 1. Per-job override
    if job_settings and key in job_settings:
        return job_settings[key]

    # 2. Tenant-level override
    if tenant is not None:
        tenant_settings = tenant.settings or {}
        if key in tenant_settings:
            return tenant_settings[key]

    # 3. Plan-tier default
    plan = (tenant.plan if tenant else "free") or "free"
    plan_defs = PLAN_DEFAULTS.get(plan, _FALLBACK_DEFAULTS)
    if key in plan_defs:
        return plan_defs[key]

    # 4. Hard-coded fallback
    return _FALLBACK_DEFAULTS.get(key)
