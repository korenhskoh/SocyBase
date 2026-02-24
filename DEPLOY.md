# SocyBase — Railway Deployment Guide

## Prerequisites

1. A [Railway](https://railway.com) account
2. Your code pushed to a GitHub repository
3. Railway CLI installed (optional): `npm i -g @railway/cli`

---

## Step 1: Create a Railway Project

1. Go to [railway.com/new](https://railway.com/new)
2. Click **"Deploy from GitHub Repo"**
3. Select your SocyBase repository

---

## Step 2: Add Database Plugins

In your Railway project dashboard, click **"+ New"** and add:

1. **PostgreSQL** — Railway auto-injects `DATABASE_URL`
2. **Redis** — Railway auto-injects `REDIS_URL`

---

## Step 3: Create Services

You need **6 services** total, all from the same repo but with different configs.

### 3.1 Backend API (Web)

| Setting | Value |
|---------|-------|
| Name | `backend` |
| Root Directory | `backend` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check | `/health` |

### 3.2 Celery Worker

| Setting | Value |
|---------|-------|
| Name | `celery-worker` |
| Root Directory | `backend` |
| Start Command | `celery -A app.celery_app worker --loglevel=info --concurrency=4 -Q default,scraping` |

### 3.3 Celery Beat (Scheduler)

| Setting | Value |
|---------|-------|
| Name | `celery-beat` |
| Root Directory | `backend` |
| Start Command | `celery -A app.celery_app beat --loglevel=info` |

### 3.4 Telegram Bot

| Setting | Value |
|---------|-------|
| Name | `telegram-bot` |
| Root Directory | `backend` |
| Start Command | `python -m app.telegram_runner` |

### 3.5 Frontend (Web)

| Setting | Value |
|---------|-------|
| Name | `frontend` |
| Root Directory | `frontend` |
| Start Command | `node server.js` |

### 3.6 Flower (Optional — Task Monitor)

| Setting | Value |
|---------|-------|
| Name | `flower` |
| Root Directory | `backend` |
| Start Command | `celery -A app.celery_app flower --port=$PORT` |

---

## Step 4: Configure Environment Variables

### Shared Variables (set on ALL backend services)

Railway auto-provides `DATABASE_URL` and `REDIS_URL` from the plugins.
Add these to each backend service (backend, celery-worker, celery-beat, telegram-bot, flower):

Use Railway's **Shared Variables** feature to avoid duplicating:

```
APP_ENV=production
APP_DEBUG=false
JWT_SECRET_KEY=<generate a strong random 64-char string>

# Facebook API
AKNG_ACCESS_TOKEN=010ae806423eb40e0daf4dbf27842a2c

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Google OAuth
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>

# Telegram
TELEGRAM_BOT_TOKEN=<from @BotFather>

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=your_app_password
EMAIL_FROM=noreply@socybase.com

# Super Admin
SUPER_ADMIN_EMAIL=admin@socybase.com
SUPER_ADMIN_PASSWORD=<strong password>
```

### Backend-Specific URLs

After Railway generates domains for your services, set:

```
BACKEND_URL=https://<your-backend>.up.railway.app
FRONTEND_URL=https://<your-frontend>.up.railway.app
CORS_ORIGINS=https://<your-frontend>.up.railway.app
GOOGLE_REDIRECT_URI=https://<your-backend>.up.railway.app/api/v1/auth/google/callback
```

### Frontend Variables

Set on the **frontend** service:

```
NEXT_PUBLIC_API_URL=https://<your-backend>.up.railway.app
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

> These are build-time variables. After changing them, redeploy the frontend.

---

## Step 5: Custom Domains (Optional)

1. In the **frontend** service, go to Settings > Networking > Custom Domain
2. Add your domain (e.g. `app.socybase.com`)
3. In the **backend** service, add `api.socybase.com`
4. Update DNS records as Railway instructs
5. Update env vars:
   - `BACKEND_URL=https://api.socybase.com`
   - `FRONTEND_URL=https://app.socybase.com`
   - `CORS_ORIGINS=https://app.socybase.com`
   - Rebuild frontend with `NEXT_PUBLIC_API_URL=https://api.socybase.com`

---

## Architecture on Railway

```
                    Railway Project
    ┌──────────────────────────────────────────┐
    │                                          │
    │  ┌──────────┐      ┌──────────────┐     │
    │  │ PostgreSQL│      │    Redis     │     │
    │  │ (Plugin)  │      │  (Plugin)    │     │
    │  └────┬─────┘      └──────┬───────┘     │
    │       │                   │              │
    │  ┌────┴───────────────────┴──────┐      │
    │  │         Backend API           │      │
    │  │   uvicorn app.main:app        │──┐   │
    │  └───────────────────────────────┘  │   │
    │                                     │   │
    │  ┌──────────────┐  ┌────────────┐   │   │
    │  │ Celery Worker │  │ Celery Beat│   │   │
    │  └──────────────┘  └────────────┘   │   │
    │                                     │   │
    │  ┌──────────────┐  ┌────────────┐   │   │
    │  │ Telegram Bot  │  │  Flower    │   │   │
    │  └──────────────┘  └────────────┘   │   │
    │                                     │   │
    │  ┌──────────────────────────────┐   │   │
    │  │       Frontend (Next.js)     │◄──┘   │
    │  │       node server.js         │       │
    │  └──────────────────────────────┘       │
    │                                          │
    └──────────────────────────────────────────┘
```

---

## Cost Estimate

Railway charges per-resource usage (vCPU + RAM + Network):

| Service | Estimated Monthly Cost |
|---------|----------------------|
| PostgreSQL | $5-10 |
| Redis | $3-5 |
| Backend API | $5-10 |
| Celery Worker | $5-10 |
| Celery Beat | $1-3 |
| Telegram Bot | $1-3 |
| Frontend | $3-5 |
| Flower | $1-3 |
| **Total** | **~$24-49/mo** |

> Railway offers $5 free credit/month on the Hobby plan. For production, use the Pro plan ($20/mo + usage).

---

## Troubleshooting

### Database connection fails
- Make sure the PostgreSQL plugin is linked to all backend services
- Railway injects `DATABASE_URL` — the app auto-converts `postgresql://` to `postgresql+asyncpg://`

### Redis connection fails
- Celery broker/backend URLs are auto-derived from `REDIS_URL` if not explicitly set
- If Railway Redis uses a password URL like `redis://default:pass@host:port`, it works automatically

### Frontend can't reach backend
- Ensure `NEXT_PUBLIC_API_URL` points to the backend's Railway domain
- Ensure `CORS_ORIGINS` includes the frontend domain
- Redeploy frontend after changing `NEXT_PUBLIC_*` vars (they're baked at build time)

### Google OAuth redirect mismatch
- Set `GOOGLE_REDIRECT_URI` to `https://<backend-domain>/api/v1/auth/google/callback`
- Add the same URI in Google Cloud Console > Authorized redirect URIs
