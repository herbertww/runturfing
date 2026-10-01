# Rundating — the bounty

Spec for the optional bounty men can post to be placed in a mixed group.
Public-facing version of this lives in the "Rundating · optional" slab on
`landing/index.html`.

## The model

| | |
|---|---|
| Season entry | **Free.** Entering a season costs nothing, for anyone. |
| Bounty | Optional, men only. Posted at season start, on top of the free entry. |
| What it buys | A guaranteed mixed group of six: three men, three women. |
| Split | **Half and half.** 50% is the platform's and funds the app; the other 50% becomes the payout pool. |
| Custody | The payout half is held in escrow for the whole season, not spent on the match. |
| Payout | At the close, that half is split between the top women runners. Every qualifying runner receives the **same fixed amount**. |

The payout is deliberately flat rather than weighted. A weighted split ranks
women against each other by activity and pays the winner most, which turns the
bounty into a prize someone can chase. A fixed amount per qualifying runner
makes the bounty a floor, and there is nothing to farm past clearing the bar.

## The bar — internal only

**Where the qualifying bar sits is kept out of this repository.** It is set in server configuration.

This number is not published, and must not appear in app copy, on the landing
site, in support replies, or in any API response. The landing footnote says
only that activity is measured on distance and frequency and that where the bar
sits stays private. A payout rule published in full is a payout rule someone
works out how to farm.

Activity for the purpose of ranking is distance covered and how often you ran
across the season, the same two inputs the season threshold already uses.

## What the code does

Entry is implemented as specified.

- Free: `season_entry_fee_cents` is gone from `Backend/api/config.py` — removed
  rather than zeroed, so no env var can put a price back on entry.
  `POST /seasons/join` charges nothing and is idempotent.
- Automatic: `SeasonService.auto_enter_for_run`, called from
  `POST /runs/import`, enters a runner into whichever open season their run
  falls inside. The entry is written in the same transaction as the run.
- Migration `011_free_season_entry.sql` zeroes `seasons.entry_fee_cents`,
  defaults it to 0, and settles the entries that were left stranded waiting on
  a Stripe webhook that will never arrive.

## What still diverges

The **payout** side is still the old model. `season_economics.split_pool_weighted`
divides the pool between all eligible entrants weighted by referrals, rather
than paying every qualifying woman the same fixed amount. There is no top-40%
gate in the code; `calculate_payouts` in `season_service.py` selects women who
clear the season activity threshold and have Stripe Connect enabled, and splits
the pool between them by weight.

So the payout is already women-only and already activity-gated. What is missing
is the flat per-person amount and the 40% cut-off. Changing that touches live
money, so it has not been done off the back of a copy change.
