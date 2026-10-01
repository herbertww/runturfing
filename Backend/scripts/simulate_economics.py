#!/usr/bin/env python
"""
Runfluence – Season economics simulator

Models a season's money end to end through the real functions in
api/services/season_economics.py: who enters, who clears the payout threshold,
what the pool comes to, what the platform keeps, and what each person actually
nets. No database, no .env, no Stripe.

The arithmetic is trivial; the distribution is not. What matters is how many
entrants clear min_runs / min_km / min_days over a fortnight, because that
number sets the payout and nobody knows it until people have run. This puts a
range on it before any money moves.

Usage:
    python scripts/simulate_economics.py cohort
    python scripts/simulate_economics.py cohort --entrants 300 --women-share 0.4
    python scripts/simulate_economics.py sweep
    python scripts/simulate_economics.py threshold

Deterministic: the same --seed gives the same season.
"""

from __future__ import annotations

import argparse
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.services.season_economics import (  # noqa: E402
    EconomicsParams,
    meets_threshold,
    referral_multiplier,
    split_pool,
    split_pool_weighted,
)


# ---------------------------------------------------------------------------
# Runner behaviour
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Archetype:
    name: str
    share: float          # fraction of the cohort
    run_probability: float  # chance of running on any given day
    km_mean: float
    km_sd: float


# Adherence in consumer fitness is heavily bimodal: a committed minority runs
# most days, a long tail signs up and barely shows. These bands are a starting
# assumption, not measured data — the point of --archetype-shares is that you
# can replace them once real cohorts exist.
ARCHETYPES = [
    Archetype("committed", 0.20, 0.72, 7.0, 2.0),
    Archetype("regular", 0.32, 0.46, 5.5, 1.6),
    Archetype("casual", 0.30, 0.21, 4.2, 1.3),
    Archetype("lapsed", 0.18, 0.05, 3.4, 1.0),
]


@dataclass
class Entrant:
    gender: str
    archetype: str
    runs: int
    km: float
    active_days: int
    eligible: bool = False


def simulate_entrant(rng: random.Random, gender: str, params: EconomicsParams) -> Entrant:
    roll = rng.random()
    cumulative = 0.0
    chosen = ARCHETYPES[-1]
    for archetype in ARCHETYPES:
        cumulative += archetype.share
        if roll <= cumulative:
            chosen = archetype
            break

    runs, km = 0, 0.0
    for _ in range(params.season_days):
        if rng.random() < chosen.run_probability:
            runs += 1
            km += max(1.0, rng.gauss(chosen.km_mean, chosen.km_sd))

    # One run per day at most, so active days and runs are the same number.
    return Entrant(gender=gender, archetype=chosen.name, runs=runs, km=km, active_days=runs)


def build_cohort(rng: random.Random, entrants: int, women_share: float, params: EconomicsParams) -> List[Entrant]:
    women = round(entrants * women_share)
    cohort = [simulate_entrant(rng, "female", params) for _ in range(women)]
    cohort += [simulate_entrant(rng, "male", params) for _ in range(entrants - women)]
    for e in cohort:
        e.eligible = e.gender == "female" and meets_threshold(e.runs, e.km, e.active_days, params)
    return cohort


def money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def _header(title: str) -> None:
    print(f"\n{title}")
    print("=" * len(title))


def _params_line(p: EconomicsParams) -> None:
    print(
        f"fee {money(p.entry_fee_cents)} | platform {p.platform_fee_rate:.0%} | "
        f"threshold {p.min_runs} runs / {p.min_km:g} km / {p.min_days} days "
        f"over {p.season_days} days"
    )


def scenario_cohort(p: EconomicsParams, args) -> None:
    rng = random.Random(args.seed)
    cohort = build_cohort(rng, args.entrants, args.women_share, p)

    women = [e for e in cohort if e.gender == "female"]
    men = [e for e in cohort if e.gender == "male"]
    eligible = [e for e in women if e.eligible]

    # Entry is free, so the pool is the rundating bounties men posted. A fee
    # only appears if one was passed with --fee to model a hypothetical.
    bounty_buyers = round(len(men) * args.guarantee_uptake)
    pool = len(cohort) * p.entry_fee_cents + bounty_buyers * p.mixed_group_guarantee_cents
    split = split_pool(pool, len(eligible), p)

    _header(f"One season: {args.entrants} entrants, {args.women_share:.0%} women")
    _params_line(p)

    print(f"\n{'archetype':>10}  {'n':>4}  {'median runs':>11}  {'median km':>9}  {'clears bar':>10}")
    for archetype in ARCHETYPES:
        band = [e for e in cohort if e.archetype == archetype.name]
        if not band:
            continue
        band_women = [e for e in band if e.gender == "female"]
        passed = sum(1 for e in band_women if e.eligible)
        rate = f"{passed}/{len(band_women)}" if band_women else "-"
        print(
            f"{archetype.name:>10}  {len(band):>4}  "
            f"{statistics.median(e.runs for e in band):>11.0f}  "
            f"{statistics.median(e.km for e in band):>9.1f}  {rate:>10}"
        )

    pass_rate = len(eligible) / len(women) if women else 0
    print(f"\nWomen entered      {len(women)}")
    print(f"Women paid out     {len(eligible)}  ({pass_rate:.0%} cleared the bar)")
    print(f"Men entered        {len(men)}")

    source = f"{bounty_buyers} x {money(p.mixed_group_guarantee_cents)} bounty"
    if p.entry_fee_cents:
        source = f"{len(cohort)} x {money(p.entry_fee_cents)} fee + " + source
    print(f"\nPool               {money(split.pool_cents)}  ({source})")
    print(f"Platform keeps     {money(split.platform_cents)}")
    print(f"Distributed        {money(split.distributed_cents)}")
    print(f"Unallocated        {money(split.remainder_cents)}  (integer division leftover)")

    print(f"\nPer eligible woman {money(split.per_person_cents)}")
    if split.per_person_cents and p.entry_fee_cents:
        net = split.per_person_cents - p.entry_fee_cents
        print(f"  net of her fee   {money(net)}  ({'profit' if net > 0 else 'loss'})")
        print(f"  return multiple  {split.per_person_cents / p.entry_fee_cents:.1f}x her entry")
    print(f"Woman who misses   {money(-p.entry_fee_cents)}  (entry costs nothing)")
    print(f"Man with a bounty  {money(-p.mixed_group_guarantee_cents)}  ({bounty_buyers} of {len(men)} men)")
    print(f"Man without one    {money(-p.entry_fee_cents)}  (no payout path exists for men)")


def scenario_sweep(p: EconomicsParams, args) -> None:
    rng_seed = args.seed
    _header("Sweep: payout per eligible woman, by cohort size and women's share")
    _params_line(p)
    print("\nAveraged over", args.trials, "seasons per cell.\n")

    shares = args.women_shares
    print(f"{'entrants':>9} | " + " | ".join(f"{s:>10.0%} women" for s in shares))
    print("-" * (11 + 19 * len(shares)))

    for size in args.sizes:
        cells = []
        for share in shares:
            payouts, rates = [], []
            for trial in range(args.trials):
                rng = random.Random(rng_seed + trial)
                cohort = build_cohort(rng, size, share, p)
                women = [e for e in cohort if e.gender == "female"]
                eligible = [e for e in women if e.eligible]
                split = split_pool(len(cohort) * p.entry_fee_cents, len(eligible), p)
                payouts.append(split.per_person_cents)
                rates.append(len(eligible) / len(women) if women else 0)
            cells.append(f"{money(round(statistics.mean(payouts))):>9} @{statistics.mean(rates):>3.0%}")
        print(f"{size:>9} | " + " | ".join(f"{c:>17}" for c in cells))

    print("\nEach cell is the average payout per eligible woman, and the share of")
    print("women who cleared the bar. Payout scales with the men-to-women ratio")
    print("because everyone funds the pool and only women draw from it.")


def scenario_threshold(p: EconomicsParams, args) -> None:
    _header("Threshold sensitivity: how many women clear the bar")
    print(f"Cohort {args.entrants} entrants, {args.women_share:.0%} women, "
          f"{args.trials} seasons per row, {p.season_days}-day season.\n")

    variants = [
        ("shipped", p.min_runs, p.min_km, p.min_days),
        ("looser km", p.min_runs, 12.0, p.min_days),
        ("looser runs", 3, p.min_km, 2),
        ("much looser", 2, 8.0, 2),
        ("tighter", 6, 30.0, 5),
    ]

    print(f"{'variant':>12}  {'runs':>4}  {'km':>5}  {'days':>4}  {'clears':>7}  {'payout':>10}")
    for label, runs, km, days in variants:
        variant = p.with_(min_runs=runs, min_km=km, min_days=days)
        rates, payouts = [], []
        for trial in range(args.trials):
            rng = random.Random(args.seed + trial)
            cohort = build_cohort(rng, args.entrants, args.women_share, variant)
            women = [e for e in cohort if e.gender == "female"]
            eligible = [e for e in women if e.eligible]
            rates.append(len(eligible) / len(women) if women else 0)
            payouts.append(split_pool(len(cohort) * variant.entry_fee_cents, len(eligible), variant).per_person_cents)
        print(
            f"{label:>12}  {runs:>4}  {km:>5.0f}  {days:>4}  "
            f"{statistics.mean(rates):>6.0%}  {money(round(statistics.mean(payouts))):>10}"
        )

    print("\nA looser bar pays more people less each; a tighter bar concentrates")
    print("the same pool. The bar is a payout-size dial, not only a fairness one.")


def scenario_referral(p: EconomicsParams, args) -> None:
    """What the Runfluence multiplier actually does to each person's payout."""
    rng = random.Random(args.seed)
    cohort = build_cohort(rng, args.entrants, args.women_share, p)

    women = [e for e in cohort if e.gender == "female"]
    men = [e for e in cohort if e.gender == "male"]
    eligible = [e for e in women if e.eligible]

    # Money in: everyone's entry fee, plus guarantees bought by some of the men.
    guarantee_buyers = round(len(men) * args.guarantee_uptake)
    pool = len(cohort) * p.entry_fee_cents + guarantee_buyers * p.mixed_group_guarantee_cents

    _header("Runfluence referral multiplier")
    _params_line(p)
    print(
        f"referral +{p.referral_bonus:.0%} per paid referral, "
        f"+{p.referral_female_bonus:.0%} extra if she is paid, capped at "
        f"{p.max_referral_multiplier:g}x"
    )
    print(
        f"guarantee {money(p.mixed_group_guarantee_cents)}, bought by "
        f"{guarantee_buyers} of {len(men)} men\n"
    )

    # Assign referrals among eligible women, so the referrer is someone who is
    # actually in the payout split.
    referrers = eligible[: max(1, round(len(eligible) * args.referrer_share))]
    weights, detail = {}, {}
    for i, e in enumerate(eligible):
        key = f"w{i}"
        if e in referrers:
            # Referred people only count once paid; assume the same pass rate.
            paid = sum(1 for _ in range(args.referrals_each) if rng.random() < 0.55)
            paid_female = sum(1 for _ in range(paid) if rng.random() < args.women_share)
        else:
            paid, paid_female = 0, 0
        weights[key] = referral_multiplier(paid, paid_female, p)
        detail[key] = (paid, paid_female)

    amounts, split = split_pool_weighted(pool, weights, p)
    flat = split_pool(pool, len(eligible), p)

    print(f"Pool {money(split.pool_cents)} | platform {money(split.platform_cents)} | "
          f"{len(eligible)} of {len(women)} women paid")
    print(f"Flat split (no referrals): {money(flat.per_person_cents)} each\n")

    buckets = {}
    for key, w in weights.items():
        paid, paid_f = detail[key]
        buckets.setdefault((paid, paid_f), []).append(amounts[key])

    print(f"{'referrals':>10}  {'of them women':>13}  {'weight':>7}  {'payout':>10}  {'vs flat':>9}  {'n':>3}")
    for (paid, paid_f), vals in sorted(buckets.items()):
        w = referral_multiplier(paid, paid_f, p)
        avg = round(statistics.mean(vals))
        delta = avg - flat.per_person_cents
        print(f"{paid:>10}  {paid_f:>13}  {w:>7.2f}  {money(avg):>10}  "
              f"{('+' if delta >= 0 else '') + money(delta):>9}  {len(vals):>3}")

    non_ref = [amounts[k] for k, w in weights.items() if w == 1.0]
    if non_ref:
        loss = flat.per_person_cents - round(statistics.mean(non_ref))
        print(f"\nSomeone who referred nobody earns "
              f"{money(round(statistics.mean(non_ref)))}, "
              f"{money(loss)} less than under a flat split.")
    print("The pool is fixed, so every bonus is paid by the other winners.")
    print(f"Guarantees added {money(guarantee_buyers * p.mixed_group_guarantee_cents)} of genuinely new money.")



def scenario_export(p: EconomicsParams, args) -> None:
    """Dump bounty economics as JSON for the visual dashboard."""
    import json

    def season(size, share, guarantee_uptake, seed):
        rng = random.Random(seed)
        cohort = build_cohort(rng, size, share, p)
        women = [e for e in cohort if e.gender == "female"]
        men = [e for e in cohort if e.gender == "male"]
        eligible = [e for e in women if e.eligible]
        buyers = round(len(men) * guarantee_uptake)
        pool = size * p.entry_fee_cents + buyers * p.mixed_group_guarantee_cents
        return cohort, women, men, eligible, buyers, pool

    out = {"params": {
        "entryFeeCents": p.entry_fee_cents,
        "guaranteeCents": p.mixed_group_guarantee_cents,
        "platformFeeRate": p.platform_fee_rate,
        "minRuns": p.min_runs, "minKm": p.min_km, "minDays": p.min_days,
        "seasonDays": p.season_days,
        "referralBonus": p.referral_bonus,
        "referralFemaleBonus": p.referral_female_bonus,
        "maxMultiplier": p.max_referral_multiplier,
    }}

    # 1. Who clears the bar, by archetype.
    cohort, women, men, eligible, buyers, pool = season(
        args.entrants, args.women_share, args.guarantee_uptake, args.seed)
    out["adherence"] = []
    for a in ARCHETYPES:
        band = [e for e in cohort if e.archetype == a.name]
        bw = [e for e in band if e.gender == "female"]
        out["adherence"].append({
            "name": a.name, "n": len(band),
            "medianRuns": statistics.median([e.runs for e in band]) if band else 0,
            "medianKm": round(statistics.median([e.km for e in band]), 1) if band else 0,
            "women": len(bw), "paid": sum(1 for e in bw if e.eligible),
        })

    # 2. Pool composition — what is new money vs redistribution.
    out["pool"] = {
        "entrants": len(cohort), "women": len(women), "men": len(men),
        "paidWomen": len(eligible),
        "entryFeeCents": len(cohort) * p.entry_fee_cents,
        "guaranteeCents": buyers * p.mixed_group_guarantee_cents,
        "guaranteeBuyers": buyers,
        "totalCents": pool,
    }
    flat = split_pool(pool, len(eligible), p)
    out["pool"]["platformCents"] = flat.platform_cents
    out["pool"]["flatPerPersonCents"] = flat.per_person_cents

    # 3. Referral multiplier ladder — payout at each weight, same pool.
    ladder = []
    for refs in range(0, 6):
        for fem in range(0, refs + 1):
            w = referral_multiplier(refs, fem, p)
            # One referrer at this weight, everyone else flat.
            weights = {f"u{i}": 1.0 for i in range(len(eligible))}
            if weights:
                weights["u0"] = w
                amounts, _ = split_pool_weighted(pool, weights, p)
                ladder.append({"referrals": refs, "women": fem, "weight": round(w, 3),
                               "payoutCents": amounts.get("u0", 0),
                               "othersCents": amounts.get("u1", amounts.get("u0", 0))})
    out["ladder"] = ladder

    # 4. Sweep: payout by cohort size and women's share.
    out["sweep"] = []
    for size in args.sizes:
        row = {"entrants": size, "cells": []}
        for share in args.women_shares:
            payouts, rates = [], []
            for t in range(args.trials):
                _, w, m, el, b, pl = season(size, share, args.guarantee_uptake, args.seed + t)
                payouts.append(split_pool(pl, len(el), p).per_person_cents)
                rates.append(len(el) / len(w) if w else 0)
            row["cells"].append({"womenShare": share,
                                 "payoutCents": round(statistics.mean(payouts)),
                                 "passRate": round(statistics.mean(rates), 3)})
        out["sweep"].append(row)

    # 5. Threshold sensitivity.
    out["thresholds"] = []
    for label, runs, km, days in [
        ("much looser", 2, 8.0, 2), ("looser", 3, 12.0, 2),
        ("shipped", p.min_runs, p.min_km, p.min_days),
        ("tighter", 6, 30.0, 5), ("strict", 8, 40.0, 6),
    ]:
        v = p.with_(min_runs=runs, min_km=km, min_days=days)
        rates, payouts = [], []
        for t in range(args.trials):
            rng = random.Random(args.seed + t)
            c = build_cohort(rng, args.entrants, args.women_share, v)
            w = [e for e in c if e.gender == "female"]
            el = [e for e in w if e.eligible]
            b = round(len([e for e in c if e.gender == "male"]) * args.guarantee_uptake)
            pl = len(c) * v.entry_fee_cents + b * v.mixed_group_guarantee_cents
            rates.append(len(el) / len(w) if w else 0)
            payouts.append(split_pool(pl, len(el), v).per_person_cents)
        out["thresholds"].append({
            "label": label, "runs": runs, "km": km, "days": days,
            "passRate": round(statistics.mean(rates), 3),
            "payoutCents": round(statistics.mean(payouts)),
        })

    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {args.out}")
    print(f"{out['pool']['entrants']} entrants, pool {money(out['pool']['totalCents'])}, "
          f"{out['pool']['paidWomen']} paid")


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenario", choices=["cohort", "sweep", "threshold", "referral", "export"])
    ap.add_argument("--entrants", type=int, default=120)
    ap.add_argument("--women-share", type=float, default=0.5)
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--sizes", type=int, nargs="+", default=[30, 60, 120, 300])
    ap.add_argument("--women-shares", type=float, nargs="+", default=[0.3, 0.5, 0.7])

    ap.add_argument("--fee", type=int, help="entry fee in cents")
    ap.add_argument("--platform-fee", type=float, help="platform cut, 0-1")
    ap.add_argument("--min-runs", type=int)
    ap.add_argument("--min-km", type=float)
    ap.add_argument("--min-days", type=int)
    ap.add_argument("--season-days", type=int)
    ap.add_argument("--referral-bonus", type=float)
    ap.add_argument("--referral-female-bonus", type=float)
    ap.add_argument("--max-multiplier", type=float)
    ap.add_argument("--guarantee", type=int, help="mixed-group guarantee price in cents")
    ap.add_argument("--referrer-share", type=float, default=0.25, help="fraction of entrants who refer")
    ap.add_argument("--referrals-each", type=int, default=3, help="referrals per referrer")
    ap.add_argument("--guarantee-uptake", type=float, default=0.5, help="fraction of men buying the guarantee")
    ap.add_argument("--out", default="bounty_economics.json", help="export: output path")
    args = ap.parse_args()

    overrides = {
        k: v
        for k, v in {
            "entry_fee_cents": args.fee,
            "platform_fee_rate": args.platform_fee,
            "min_runs": args.min_runs,
            "min_km": args.min_km,
            "min_days": args.min_days,
            "season_days": args.season_days,
            "referral_bonus": args.referral_bonus,
            "referral_female_bonus": args.referral_female_bonus,
            "max_referral_multiplier": args.max_multiplier,
            "mixed_group_guarantee_cents": args.guarantee,
        }.items()
        if v is not None
    }
    params = EconomicsParams(**overrides)

    {
        "cohort": scenario_cohort,
        "sweep": scenario_sweep,
        "threshold": scenario_threshold,
        "referral": scenario_referral,
        "export": scenario_export,
    }[args.scenario](params, args)


if __name__ == "__main__":
    main()
