"""
Runturfing Backend – Configuration
Reads from environment variables; use a .env file locally.
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/runturfing"

    # JWT / Auth
    jwt_secret: str = "CHANGE_ME_IN_PRODUCTION"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 60
    jwt_refresh_expiry_days: int = 30

    # Apple Sign In
    apple_team_id: str = ""
    apple_client_id: str = "com.runturfing.app"
    apple_key_id: str = ""
    apple_private_key: str = ""  # PEM content

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # RevenueCat: the exact Authorization header value set on the dashboard webhook
    revenuecat_webhook_auth: str = ""

    # APNS (push notifications)
    apns_key_id: str = ""
    apns_team_id: str = ""
    apns_bundle_id: str = "com.runturfing.app"
    apns_private_key: str = ""  # PEM content
    apns_use_sandbox: bool = True

    # App
    debug: bool = False
    allowed_origins: List[str] = ["*"]

    # Territory
    # r10 (~123 m across), not r9 (~325 m). At r9 a 2.5 km loop enclosed a
    # single cell, so encircling only mattered past ~10 km — and a typical pass
    # banked 351 m, well over the 300 m the per-run cap allows, so distance
    # inside a cell stopped counting for everyone. r10 fixes both: 18 cells
    # enclosed on the same loop, and no cell hits the cap.
    h3_resolution: int = 10
    corridor_buffer_meters: float = 15.0
    # Scaled with the cell: a pass banks ~14 points at r10 against ~30 at r9,
    # so 25 keeps claiming at two days of running rather than three.
    ownership_threshold: float = 25.0
    contested_delta: float = 8.0   # same fraction of the threshold as before
    daily_decay_rate: float = 0.97
    # How far inside a closed loop a claim reaches from the route itself. The
    # ratio and count caps limit how much interior a run takes but not where,
    # so a 20 km ring used to hand over its middle as well — ground the runner
    # never approached. At 300 m a lap under ~2.5 km still fills solid, while a
    # 20 km ring takes a band and leaves 22 km2 of centre alone.
    max_enclosure_reach_m: float = 300.0

    # Season
    season_duration_days: int = 14
    season_group_size: int = 6
    threshold_min_runs: int = 4
    threshold_min_km: float = 20.0
    threshold_min_days: int = 3

    # Economics. There is no season entry fee and no setting for one: entering
    # a season is free for everyone, and a runner is entered automatically by
    # running while the season is open. The only money a season takes in is the
    # optional rundating bounty below. `season_entry_fee_cents` used to live
    # here; it was removed rather than zeroed so no env var can quietly put a
    # price back on entry.
    # The bounty splits in half: half is the platform's, half is escrowed and
    # paid out to qualifying women at the close.
    platform_fee_rate: float = 0.50

    # Mixed-group guarantee. Introductory price for a first season.
    mixed_group_guarantee_cents: int = 500

    # Runturfing referral multiplier. Bonuses only count for referrals that were
    # actually paid out, so a signup on its own is worth nothing.
    referral_bonus: float = 0.10
    referral_female_bonus: float = 0.15
    max_referral_multiplier: float = 2.0
    # A season refuses to settle if the leaderboard snapshot backing payout
    # eligibility is older than this, rather than paying nobody and closing.
    payout_snapshot_max_age_days: int = 2

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
