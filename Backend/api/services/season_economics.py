"""
Runfluence Backend – Season Economics (pure)

The money maths, with no database and no settings import, so that
scripts/simulate_economics.py can model a season without a Postgres connection
or a .env file. season_service.py keeps the SQL; this file owns the arithmetic.

Same split as territory_scoring.py against territory_service.py. If a number
changes, it changes here, and both the API and the simulator move together.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Dict, Tuple


@dataclass(frozen=True)
class EconomicsParams:
    """Defaults mirror api.config.Settings. Keep the two in step."""

    # Simulation-only. The live product charges nothing to enter a season, so
    # this is 0 by default and no setting feeds it; scripts/simulate_economics.py
    # can still model a hypothetical fee by passing --fee.
    entry_fee_cents: int = 0
    # A posted bounty splits in half: half the platform's, half the payout pool.
    platform_fee_rate: float = 0.50

    # Payout eligibility. A season entrant must clear all three.
    min_runs: int = 4
    min_km: float = 20.0
    min_days: int = 3

    season_days: int = 14
    group_size: int = 6

    # The rundating bounty: pay to be guaranteed a mixed group. Since entry is
    # free, this is the only money a live season takes in, so the pool is the
    # sum of the bounties posted and nothing else — of which half is paid out
    # and half is the platform's, per `platform_fee_rate`.
    mixed_group_guarantee_cents: int = 500

    # -- Runfluence: referral bounty multiplier ------------------------------
    # A referrer's share of the pool is weighted rather than equal. Every bonus
    # is contingent on the referred person actually being PAID — clearing the
    # activity threshold and completing Stripe Connect. Signing people up earns
    # nothing on its own, which is what makes farming accounts pointless.
    referral_bonus: float = 0.10        # per referred entrant who got paid
    referral_female_bonus: float = 0.15 # additional, per referred woman paid out
    # Without a ceiling one well-connected referrer collects most of the pool
    # and everyone else's share collapses. The split is zero-sum.
    max_referral_multiplier: float = 2.0

    def with_(self, **overrides) -> "EconomicsParams":
        return replace(self, **overrides)


DEFAULT_PARAMS = EconomicsParams()


def params_from_settings(settings) -> EconomicsParams:
    return EconomicsParams(
        # entry_fee_cents is deliberately not sourced from settings: entry is
        # free and there is no setting to read.
        platform_fee_rate=settings.platform_fee_rate,
        min_runs=settings.threshold_min_runs,
        min_km=settings.threshold_min_km,
        min_days=settings.threshold_min_days,
        season_days=settings.season_duration_days,
        group_size=settings.season_group_size,
        mixed_group_guarantee_cents=settings.mixed_group_guarantee_cents,
        referral_bonus=settings.referral_bonus,
        referral_female_bonus=settings.referral_female_bonus,
        max_referral_multiplier=settings.max_referral_multiplier,
    )


def referral_multiplier(
    paid_referrals: int,
    paid_female_referrals: int,
    params: EconomicsParams = DEFAULT_PARAMS,
) -> float:
    """
    A referrer's weight in the payout split.

    Both counts must be of referrals that were actually PAID this season, not
    merely signed up. `paid_female_referrals` is a subset of `paid_referrals`,
    so a referred woman who got paid earns both bonuses.
    """
    if paid_referrals < 0 or paid_female_referrals < 0:
        raise ValueError("referral counts cannot be negative")
    if paid_female_referrals > paid_referrals:
        raise ValueError("female referrals cannot exceed total referrals")

    weight = (
        1.0
        + paid_referrals * params.referral_bonus
        + paid_female_referrals * params.referral_female_bonus
    )
    return min(weight, params.max_referral_multiplier)


def meets_threshold(
    runs: int,
    km: float,
    active_days: int,
    params: EconomicsParams = DEFAULT_PARAMS,
) -> bool:
    """Whether one entrant's season clears the payout bar."""
    return runs >= params.min_runs and km >= params.min_km and active_days >= params.min_days


@dataclass(frozen=True)
class PayoutSplit:
    pool_cents: int
    platform_cents: int
    per_person_cents: int
    eligible_count: int
    #: Cents the integer division cannot allocate. Small, but it is real money
    #: and it currently stays with the platform by default rather than by
    #: decision — surfaced here so that stays a choice.
    remainder_cents: int

    @property
    def distributed_cents(self) -> int:
        return self.per_person_cents * self.eligible_count


def split_pool(
    pool_cents: int,
    eligible_count: int,
    params: EconomicsParams = DEFAULT_PARAMS,
) -> PayoutSplit:
    """Divide a season pool evenly between the platform and eligible entrants."""
    if pool_cents < 0:
        raise ValueError("pool cannot be negative")

    if eligible_count <= 0:
        return PayoutSplit(
            pool_cents=pool_cents,
            platform_cents=0,
            per_person_cents=0,
            eligible_count=0,
            remainder_cents=pool_cents,
        )

    payout_pool = int(pool_cents * (1 - params.platform_fee_rate))
    per_person = payout_pool // eligible_count

    return PayoutSplit(
        pool_cents=pool_cents,
        platform_cents=pool_cents - payout_pool,
        per_person_cents=per_person,
        eligible_count=eligible_count,
        remainder_cents=payout_pool - per_person * eligible_count,
    )


def split_pool_weighted(
    pool_cents: int,
    weights: Dict[str, float],
    params: EconomicsParams = DEFAULT_PARAMS,
) -> Tuple[Dict[str, int], PayoutSplit]:
    """
    Divide the pool in proportion to each entrant's referral weight.

    Returns per-user amounts plus a summary. Note what a multiplier actually
    does here: the pool is fixed, so raising one person's weight lowers
    everybody else's payout. Referral bonuses are redistribution between
    winners, not new money — the only thing that grows the pool is more
    bounties coming in.
    """
    if pool_cents < 0:
        raise ValueError("pool cannot be negative")

    live = {u: w for u, w in weights.items() if w > 0}
    if not live:
        return {}, PayoutSplit(pool_cents, 0, 0, 0, pool_cents)

    payout_pool = int(pool_cents * (1 - params.platform_fee_rate))
    total_weight = sum(live.values())

    amounts = {u: int(payout_pool * w / total_weight) for u, w in live.items()}
    distributed = sum(amounts.values())

    return amounts, PayoutSplit(
        pool_cents=pool_cents,
        platform_cents=pool_cents - payout_pool,
        # Reported as the average, since shares now differ per person.
        per_person_cents=distributed // len(live),
        eligible_count=len(live),
        remainder_cents=payout_pool - distributed,
    )
