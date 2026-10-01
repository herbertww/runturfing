"""
Runturfing Backend API
FastAPI application — production-ready async Python backend.

Start: uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from api.routes import (
    auth,
    runs,
    territory,
    leaderboard,
    seasons,
    chat,
    wallet,
    profiles,
    moderation,
    webhooks,
    institutions,
)
from api.middleware.auth_middleware import AuthMiddleware
from api.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Runturfing API",
    version="1.0.0",
    description="Backend for the Runturfing social running app.",
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(AuthMiddleware)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth.router,        prefix="/v1/auth",        tags=["Auth"])
app.include_router(runs.router,        prefix="/v1/runs",        tags=["Runs"])
app.include_router(territory.router,   prefix="/v1/territory",   tags=["Territory"])
app.include_router(leaderboard.router, prefix="/v1/leaderboard", tags=["Leaderboard"])
app.include_router(seasons.router,     prefix="/v1/seasons",     tags=["Seasons"])
app.include_router(chat.router,        prefix="/v1/chat",        tags=["Chat"])
app.include_router(wallet.router,      prefix="/v1/wallet",      tags=["Wallet"])
app.include_router(profiles.router,    prefix="/v1/profiles",    tags=["Profiles"])
app.include_router(moderation.router,  prefix="/v1/moderation",  tags=["Moderation"])
app.include_router(webhooks.router,    prefix="/v1/webhooks",    tags=["Webhooks"])
app.include_router(institutions.router, prefix="/v1/institutions", tags=["Institutions"])

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"message": "Internal server error"},
    )
