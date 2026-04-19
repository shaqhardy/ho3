# Follow-up tickets

## Transactions 1000-row cap — remaining sites

The audit on 2026-04-19 identified 15 unbounded `.from("transactions").select(...)`
reads. This pass fixed 8 of them (#1, #10, #11, #15 via aggregate RPCs; #6, #12,
#13, #14 via `fetchAllPaginated`). The remaining 7 budget-related reads are
still unbounded and will silently truncate at 1000 rows when any of them trip
the cap.

Priority listed worst first.

### P0 — unbounded, most likely to miss rows today

- **`src/app/api/budgets/route.ts:46-48`** — `.select("*").in("book", booksNeeded)`
  across every active book. Worst offender, fully unbounded. Used to compute
  per-book spent/allocated on the budgets index page.

### P1 — date-scoped unbounded reads that currently truncate

- **`src/app/(dashboard)/personal/budgets/trends/page.tsx:37-43`** — 3/6/**12**
  months of expenses. The 12-month variant is the biggest offender.
- **`src/lib/budgets/suggestions.ts:101-108`** — per-category period scan (one
  query per category). Individual queries are usually small, but the overall
  shape depends on #-of-categories × period length.
- **`src/lib/budgets/load.ts:37-47`** — last 3 months of expenses per book.
  Used by the budgets index. At risk during heavy months.

### P2 — budget-period reads (usually <1000 but unbounded)

- **`src/app/(dashboard)/personal/budgets/[id]/page.tsx:36-43`** — budget period
  txns.
- **`src/app/api/budgets/[id]/route.ts:34-38`** — same as above, API version.
- **`src/app/(dashboard)/personal/plan/page.tsx:68-80`** — 1 month of
  expenses for budget context on the Plan.

### Recommended fix

Most of these want sum-per-category over a period — a natural fit for a third
aggregate RPC (`category_spend_by_period` or extend `category_txn_counts` with
an `is_income` filter, which it already partially supports via the expense_total
column). For #8 specifically (unfiltered cross-book) the aggregate path is
much cheaper than paginating every txn in every book.

## Explicit-limit sites — proper UI pagination

These are the `.limit(5000)` / `.limit(2000)` sites flagged as "safe today but
not long-term" in the 2026-04-19 audit. Safe while per-book counts stay below
those limits. When they start bumping, convert the UI to a "Load More" button
with `.range(from, to)` instead of a one-shot fetch.

- `src/lib/transactions/load.ts:82` — main transactions list (.limit(5000))
- `src/app/(dashboard)/personal/page.tsx:29` — personal dashboard (.limit(5000))
- `src/app/(dashboard)/business/page.tsx:26` — business dashboard (.limit(5000))
- `src/app/(dashboard)/nonprofit/page.tsx:26` — nonprofit dashboard (.limit(5000))
- `src/app/(dashboard)/accounts/[id]/page.tsx:79` — account detail (.limit(5000))
- `src/app/(dashboard)/personal/categorize/page.tsx:37` — uncategorized (.limit(2000))
- `src/app/(dashboard)/business/categorize/page.tsx:35` — uncategorized (.limit(2000))
- `src/app/(dashboard)/nonprofit/categorize/page.tsx:35` — uncategorized (.limit(2000))

## Verification

After deploying the 2026-04-19 cap fix, hit `/api/admin/txn-count?book=personal`
(and business / nonprofit) while signed in as an admin. Expect:

- `delta_rpc` = 0
- `delta_paginated` = 0
- `pass` = true

If any delta is non-zero, a truncation path still exists — check the raw count
vs the two computed counts and file a regression.
