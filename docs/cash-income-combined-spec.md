# Cash / Income / Combined Feature — Build Spec

## Why this exists

This is the most important feature in HO3. Income vs. expenses is accounting. Surplus vs. deficit projection over 3/6/9/12 months is navigation. The goal is a realistic, forward-looking view that answers one question: **Are we in a deficit, and for how long?**

Because the user is full 1099, income is sporadic. A two-week "period" might actually be six weeks. Traditional budget apps fail here because they assume predictable income. This feature doesn't assume. It shows cash, income, and the combined picture across time windows the user controls.

**Critical context:** Almost all of the user's personal income is distributed from the LLC (business book). Money flows Business → Personal as owner distributions, not as external income. The spec below accounts for this explicitly. See sections 6, 7, and 14 for the math.

## Scope (one phase, end to end)

Ship everything below in a single coordinated build. If context or complexity threatens correctness, pause and report before splitting. Do not defer pieces silently.

---

## 1. Pages affected

This feature lands on four pages:

1. `/overview` combines all three books (personal + business + nonprofit)
2. `/personal` scoped to personal book only
3. `/business` scoped to business book only
4. `/nonprofit` scoped to nonprofit book only

Each page renders the same feature structure, scoped to that page's book(s). Overview sums across all three with double-count prevention for owner distributions.

---

## 2. The three boxes

Every page shows three stacked boxes (or side-by-side on desktop, whatever the existing layout supports):

### Box 1: Cash

What money is or will be available, based on the active mode (see section 4).

### Box 2: Income

Income only. Past portion uses confirmed `income_entries`. Future portion uses `projected_income`. Split at today's date for spans that cross today. On Overview, owner distributions are excluded to prevent double-counting (the underlying client payment was already counted as external income on the business book).

### Box 3: Combined

Cash + Income - Expected Expenses = Surplus or Deficit for the window. This is the number that answers the deficit question. Green if positive, red if negative.

Each box shows:
- A single headline number (the total for the window)
- A small label under it identifying the mode and window (e.g., "Projected · Next 6 months")
- Green background tint if surplus, red background tint if deficit (Combined box only; Cash and Income are neutral)

---

## 3. The six time toggles

One row of buttons. Only one active at a time. Rolling windows from today, except YTD.

| Label | Window |
|---|---|
| Month | Next 30 days from today |
| Quarter | Next 90 days from today |
| 6 Months | Next 180 days from today |
| 9 Months | Next 270 days from today |
| Year | Next 365 days from today |
| YTD | January 1 of current year through today (backward-looking) |

The selected toggle affects all three boxes simultaneously. Toggle change triggers a recalculation with no page reload.

---

## 4. The global mode toggle (Live / Scheduled / Projected)

A second control, separate from the time toggle. Only one mode active at a time. Applies to all three boxes on the current page. Persists in localStorage as `ho3.cashMode` so the choice survives page reloads and new visits.

### Mode: Live

- **Cash box:** Current sum of live balances across all connected bank accounts assigned to this book, pulled from Plaid. Fall back to the cached balance in the `accounts` table if the live fetch times out (>2s) or fails.
- **Income box:** Confirmed `income_entries` only, for the time window. For future-dated windows this will be zero, which is correct. On Overview, exclude entries classified as `owner_distribution` to prevent double-counting.
- **Combined box:** Cash + Income - (expenses already posted in the window via the `transactions` table)

### Mode: Scheduled

- **Cash box:** Live balance minus all unpaid bills scheduled within the time window (from the `bills` table where `due_date` is in the window and `paid = false`).
- **Income box:** Confirmed `income_entries` for past portion + `projected_income` for future portion, split at today. Classification rules from section 6b apply.
- **Combined box:** Cash (as computed above) + Income - Scheduled bills in window - any already-posted expenses in window.

### Mode: Projected

- **Cash box:** Live balance projected forward. Starts with current balance, subtracts all expected expenses in window (bills + budget allocations), adds all projected income in window. For the Business page, subtracts projected owner distributions (since those leave business cash). For the Personal page, adds projected owner distributions. Ends with cash at the end of this window if nothing changes.
- **Income box:** Same classification logic as Scheduled (confirmed past + projected future, split at today, per-page classification rules).
- **Combined box:** Cash (as projected above) + Income - all expected expenses in window. Owner distributions are NOT counted as expenses; they're handled via the cash flow math above.

---

## 5. Expected expenses (math detail for Scheduled and Projected modes)

For any future time window, expected expenses = union of the following, deduplicated:

### 5a. Bills

Every unpaid bill from the `bills` table where `due_date` falls inside the window. Sum the amounts.

### 5b. Budget category allocations

For each budget category attached to this book, calculate the expected monthly expenditure and apply to the window as follows:

**For months that overlap today:** Use remaining allocation only. If current month's budget for groceries is $800 and $400 has already posted this month, the forecast subtracts $400 for the rest of this month, not $800.

**For fully future months in the window:** Use the full monthly allocation.

Example: Today is April 19. Window is 6 months (April 19 through October 19).
- April remainder: $400 (remaining allocation for April)
- May through September: $800 × 5 = $4,000 (full monthly allocation)
- October 1-19: prorate 19/31 × $800 = $490
- Total for groceries in window: $400 + $4,000 + $490 = $4,890

### 5c. Avoid double-counting

If a bill exists in both the `bills` table AND as part of a budget category allocation (e.g., Rent is a bill AND Housing is a budget category), only count the bill. Bills are more precise than budget allocations.

**Implementation:** When summing budget allocations, subtract any bill amounts whose category matches. This requires a `category_id` or `category_name` field on `bills` to join on. If that field doesn't exist, add it and default any existing rent/mortgage/utility bills to their matching category.

### 5d. Owner distributions are not expenses

Owner distributions (LLC → personal) are not operating expenses. They're internal cash flow. Handle them in the Cash box math, NOT in expected expenses. Specifically:

- Business Cash box in Projected mode: subtract projected owner distributions from the forward calculation
- Personal Cash box in Projected mode: add projected owner distributions to the forward calculation
- Business Combined box: does NOT count owner distributions as an expense
- Personal Combined box: counts owner distributions as income (via Income box, see section 6b)
- Overview Cash box: biz decrease and personal increase cancel out, so Overview Cash is unaffected

---

## 6. Expected income (math detail)

### 6a. Classification

Every income entry (both actual `income_entries` and projected `projected_income`) has a `classification` field with one of three values:

- `external_income`: money entering from outside your household (client payments, 1099 income, refunds, gifts, speaking honoraria, grants)
- `owner_distribution`: money moving from the LLC/business book to the personal book. Real income from the personal book's perspective, but already counted as external_income on the business book when the client originally paid.
- `internal_transfer`: money moving between accounts without changing household totals (checking to savings within the same book, or business-to-business between two business accounts). Never counted as income anywhere.

### 6b. Income box math per page

**Personal page:** Sum of `external_income` + `owner_distribution` in window. Exclude `internal_transfer`.

**Business page:** Sum of `external_income` only. Exclude `owner_distribution` (that's money leaving business, not income entering). Exclude `internal_transfer`.

**Nonprofit page:** Sum of `external_income` only. Exclude `owner_distribution` (nonprofit typically won't have these but guard against it). Exclude `internal_transfer`.

**Overview page:** Sum of `external_income` across all three books. Exclude `owner_distribution` entirely (double-count prevention). Exclude `internal_transfer`.

### 6c. Past vs. future split

For any window crossing today, split at today's date:

- Past portion (window start to today): sum confirmed `income_entries` matching the classification rules above. Only confirmed. Unconfirmed entries stay out of the math until the user reviews them.
- Future portion (today to window end): sum `projected_income` entries matching the classification rules above.

### 6d. Auto-classification on Plaid sync

Update the existing Plaid income auto-detect hook with these rules, applied in order. **Confirmed distribution flow:** direct ACH from the LLC's business bank to personal bank (no payroll provider). Rules 1–3 are the critical path; rule 4 is defensive/backup. See section 22 for details.

1. If the transaction's `pfc_primary` is `TRANSFER_IN` or `TRANSFER_OUT`, and the counterpart account is in the same book → classify `internal_transfer`
2. If the transaction's `pfc_primary` is `TRANSFER_IN` or `TRANSFER_OUT`, and the counterpart account is in a different book (typically business → personal) → classify `owner_distribution`
3. **Primary rule for this user.** If a counterpart debit exists on a business account within $0.01 and ±3 days of a personal credit, and no Plaid transfer tag fired → classify `owner_distribution`. Because distributions cross institutions via ACH, Plaid often won't tag them as TRANSFER_*, so this amount+date pairing is the main detector.
4. Backup only (no payroll provider in current flow). If the merchant name or description on a personal credit matches a payroll provider pattern (Gusto, ADP, Paychex, Rippling, OnPay, QuickBooks Payroll, Wave Payroll, Square Payroll, Justworks) → classify `owner_distribution`
5. Otherwise → classify `external_income`, flagged as unconfirmed for user review

Store the classification in `income_entries.classification`. The user can override any auto-classification manually via the Unconfirmed Income widget. Add a classification dropdown to the edit dialog with the three options.

---

## 7. Distribution schedule (new feature within this build)

Because owner distributions are the user's primary personal income, the app needs a way to project them forward beyond what gets auto-detected from Plaid.

### 7a. Data model

New table: `distribution_schedules`

```
id                  uuid primary key
user_id             uuid references auth.users
source_book         enum ('business', 'personal', 'nonprofit')  -- almost always 'business'
target_book         enum ('business', 'personal', 'nonprofit')  -- almost always 'personal'
amount              numeric(12,2)
cadence             enum ('weekly', 'biweekly', 'semimonthly', 'monthly', 'custom')
anchor_date         date  -- first occurrence
custom_days         integer[]  -- for custom cadence, days of month (e.g., [1, 15])
is_active           boolean default true
notes               text
created_at          timestamptz default now()
updated_at          timestamptz default now()
```

RLS: user can CRUD their own schedules. Wife has full access per existing policy pattern.

### 7b. Daily cron

Extend the existing `/api/cron/daily` route to regenerate projected owner distributions:

1. For each active distribution schedule, calculate next 12 months of occurrences based on cadence and anchor_date
2. Upsert corresponding `projected_income` rows with `classification = 'owner_distribution'`, `expected_date = occurrence date`, `amount = schedule amount`, `book = target_book` of schedule, `linked_schedule_id = schedule.id`
3. Delete any future projected_income rows linked to a schedule that was deleted or deactivated

Use a composite unique constraint on (`linked_schedule_id`, `expected_date`) where `linked_schedule_id IS NOT NULL` so the upsert is idempotent.

### 7c. UI

Add a new section on the Plan page titled "Distribution Schedule." List current active schedules. "Add Schedule" button opens a modal:

- Source book dropdown (defaults to Business)
- Target book dropdown (defaults to Personal)
- Amount input
- Cadence dropdown (Weekly / Biweekly / Semimonthly / Monthly / Custom)
- Anchor date picker
- Custom days input (visible only when cadence = Custom)
- Notes field
- Active toggle

Edit and deactivate from an inline action menu on each row.

### 7d. Relationship to `projected_income`

Distribution schedules generate `projected_income` rows. They don't replace manual entries. The user can still add one-off projected income items manually (a known upcoming grant, a bonus). Manual entries have `linked_schedule_id = null`. Schedule-generated entries have it set.

When a user logs actual income against a projected distribution (using the Log Actual button from the existing Plan integration), the actual `income_entries` row should inherit `classification = 'owner_distribution'` from the linked projected row.

---

## 8. Sticky header UI

Both toggles (time + mode) live inside a sticky header that stays pinned to the top of the page as the user scrolls.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Month] [Quarter] [6mo] [9mo] [Year] [YTD]            │  time toggle row
│                                                          │
│  Mode:  [Live] [Scheduled] [Projected]                  │  mode toggle row
└─────────────────────────────────────────────────────────┘
```

On mobile: stack the two rows vertically. Time toggle row can scroll horizontally if it doesn't fit.

### Behavior

- Time toggle selection persists in localStorage as `ho3.cashWindow` (values: `month`, `quarter`, `6mo`, `9mo`, `year`, `ytd`).
- Mode toggle selection persists as `ho3.cashMode` (values: `live`, `scheduled`, `projected`).
- Defaults on first visit: `month` and `projected`.
- Header shadow appears when user scrolls past the boxes.

---

## 9. Deficit banner

When any mode/window combination produces a deficit in the Combined box, show a persistent banner at the very top of the page content, above the three boxes.

### Banner content

- Red background
- Text pattern: "Deficit of $X,XXX over the next [window name]. Review bills, income, or budget to close the gap."
- Overview page banner reflects the Overview Combined box (all three books summed with owner_distribution exclusion)
- Book-specific page banner reflects that book's Combined box

### Banner rules

- Banner fires on any deficit (no threshold)
- Banner is not dismissable
- Banner hides when the deficit resolves (Combined ≥ 0)
- Banner updates instantly as toggles change

---

## 10. Empty state (zero data)

If a book has no data (no transactions, no bills, no budgets, no projected_income, no income_entries):

- The three boxes still render
- All values show $0.00
- The deficit banner does NOT fire (since 0 - 0 = 0, not a deficit)
- A small grey helper line appears below the three boxes: "No data yet. Connect an account or set up your Plan to see projections."

---

## 11. Loading state

Use skeleton loaders for the three boxes while data fetches. Gray placeholder blocks matching the final box dimensions. No blank state, no cached flash.

The sticky header renders immediately with whatever toggle state localStorage provides.

---

## 12. What-If interaction (explicit non-integration)

This feature does NOT automatically pull from the What-If scenario state. The three boxes always reflect the real, active Plan data.

If the What-If feature lets the user commit a scenario to the actual Plan (add a bill, add a projected income item, change a budget, add a distribution schedule), the Cash/Income/Combined boxes pick that up automatically because they read from the same underlying tables.

Do not add any toggle or checkbox to apply What-If scenario to these boxes. Keep them clean and reflecting reality.

---

## 13. Data sources summary

| Data | Source Table | Used For |
|---|---|---|
| Live bank balance | `accounts` (cached) + Plaid API (live) | Cash box, all modes |
| Posted transactions | `transactions` | Cash box in Live mode for past windows |
| Unpaid bills | `bills` where `paid = false` | Scheduled, Projected modes |
| Paid bills | `bills` where `paid = true` | YTD math if past |
| Budget allocations | `budgets` + `budget_categories` | Projected mode |
| Confirmed income | `income_entries` where `is_confirmed = true`, classification-aware | Income box past portion, all modes |
| Unconfirmed income | `income_entries` where `is_confirmed = false` | Excluded from all math |
| Projected income | `projected_income`, classification-aware | Income box future portion, Scheduled/Projected modes |
| Distribution schedules | `distribution_schedules` | Generates projected_income rows via cron |

---

## 14. RLS verification step (do this before coding)

User's wife now has full access to all three books. Before building this feature, verify that RLS policies on these tables allow her user_id to read all three books:

- `transactions`
- `accounts`
- `income_entries`
- `projected_income`
- `bills`
- `budgets`
- `budget_categories`
- `distribution_schedules` (new, will be created in this build)

If any policy still scopes to personal only, update the policy in a migration as part of this build. Policies should check against the `user_book_access` table (or equivalent mechanism) that the app already uses for role permissions.

Report which policies needed updating before making changes. If all pass, say so.

---

## 15. API endpoints to build

### 15a. `GET /api/cash-projection`

Returns the full box data for a given page in one call. This keeps the sticky header responsive and avoids three separate round-trips on every toggle change.

**Query parameters:**
- `book`: one of `personal`, `business`, `nonprofit`, or `all` (for overview)
- `window`: one of `month`, `quarter`, `6mo`, `9mo`, `year`, `ytd`
- `mode`: one of `live`, `scheduled`, `projected`

**Response:**
```json
{
  "cash": {
    "amount": 12450.33,
    "source_breakdown": { "account_id_1": 8200.33, "account_id_2": 4250.00 }
  },
  "income": {
    "amount": 5200.00,
    "past_portion_confirmed": 1200.00,
    "future_portion_projected": 4000.00,
    "breakdown_by_classification": {
      "external_income": 1800.00,
      "owner_distribution": 3400.00
    }
  },
  "combined": {
    "amount": -780.50,
    "is_deficit": true
  },
  "expected_expenses": {
    "bills_total": 6200.00,
    "budget_allocations_total": 12230.83,
    "deduplicated_total": 18430.83
  },
  "window": {
    "start": "2026-04-19",
    "end": "2026-10-19",
    "label": "Next 6 months"
  },
  "mode": "projected",
  "book_scope": "personal"
}
```

The frontend reads this and renders the three boxes. Toggling triggers a fresh call with new params.

### 15b. Distribution schedule CRUD

- `POST /api/distribution-schedules` (create)
- `GET /api/distribution-schedules` (list for current user)
- `PATCH /api/distribution-schedules/[id]` (update)
- `DELETE /api/distribution-schedules/[id]` (soft delete via `is_active = false`)

Standard CRUD. All scoped to user's access per RLS.

### Performance notes

- Target response time: <500ms for any page on the cash-projection endpoint
- Cache live Plaid balance calls for 60 seconds per account; don't hammer Plaid on every toggle
- Use the `monthly_flows` and `category_txn_counts` RPCs from migration 00003 where possible, they're already optimized
- Push math into Postgres if response time exceeds 500ms; do not compute big sums in JavaScript

---

## 16. Components to build

1. **`<CashProjectionHeader />`**: sticky header with both toggles. Reads/writes localStorage. Emits state changes to parent.

2. **`<CashBox />`**: renders the Cash box. Takes amount, mode label, window label as props.

3. **`<IncomeBox />`**: renders the Income box. Same props shape, plus optional classification breakdown for tooltips.

4. **`<CombinedBox />`**: renders the Combined box. Extra props: `isDeficit`, styling switches between green/red tint.

5. **`<DeficitBanner />`**: persistent red banner, top of page when Combined is negative.

6. **`<CashProjectionSection />`**: parent component that composes the above. Calls `/api/cash-projection`, handles loading skeletons, passes data down. This is what each of the four pages imports.

7. **`<DistributionScheduleManager />`**: lives on the Plan page. Lists schedules, provides Add/Edit/Deactivate actions.

8. **`<DistributionScheduleDialog />`**: modal for creating or editing a schedule.

Each of the four pages (`/overview`, `/personal`, `/business`, `/nonprofit`) imports `<CashProjectionSection />` and passes the correct `book` scope.

---

## 17. Migration needs

### 17a. Schema additions

1. Add `classification` enum to `income_entries` with values `external_income`, `owner_distribution`, `internal_transfer`. Backfill all existing rows:
   - Rows where `linked_transaction_id` points to a transaction with `pfc_primary IN ('TRANSFER_IN', 'TRANSFER_OUT')` → `internal_transfer`
   - All others → `external_income` (safest default; user can reclassify manually)

2. Add `classification` enum to `projected_income` with same values. Backfill existing rows to `external_income`.

3. Add `linked_schedule_id uuid` to `projected_income` (nullable, FK to `distribution_schedules.id` with `ON DELETE SET NULL`).

4. Create `distribution_schedules` table per section 7a.

5. Add `category_id` or `category_name` column to `bills` if it doesn't already exist. Needed for dedup against budget allocations.

### 17b. RLS policies

Add policies for `distribution_schedules` matching the existing `user_book_access` pattern. Verify all other tables listed in section 14 have policies granting wife's user_id access to all three books.

### 17c. Unique constraint for cron idempotency

On `projected_income`: unique constraint on (`linked_schedule_id`, `expected_date`) where `linked_schedule_id IS NOT NULL`. This lets the daily cron upsert distribution rows safely.

### 17d. Report before coding

Inspect the current schema for `bills`, `budgets`, `budget_categories`, `projected_income`, `income_entries`. Report anything missing or misnamed BEFORE writing migrations. Do not silently add fields. Surface them and confirm.

---

## 18. Build order

1. **Schema audit.** Inspect current tables. Report findings.
2. **RLS audit.** Verify wife's access to all relevant tables. Report findings.
3. **Migration.** Add all schema changes in a single migration file (`00004_cash_projection.sql`).
4. **Classification backfill.** Run the backfill logic from 17a. Report counts.
5. **Update Plaid sync hook.** Implement the 5-rule auto-classification from section 6d.
6. **Distribution schedule API.** CRUD endpoints from 15b.
7. **Distribution cron.** Extend `/api/cron/daily` to generate `projected_income` from active schedules.
8. **Cash projection API.** Build `/api/cash-projection` with all three modes and six windows working.
9. **Components.** Header, three boxes, banner, section parent, distribution schedule manager, dialog.
10. **Wire into pages.** Overview, Personal, Business, Nonprofit. Add schedule manager to Plan page.
11. **Testing checklist** (see section 19).

Report after steps 1, 2, and 4 before moving on. These are the steps most likely to reveal surprises.

---

## 19. Testing checklist

After build, verify each of these manually on the deployed app:

### Core math
- [ ] Overview page in Live mode, Month window: Cash box matches sum of all live bank balances across all books
- [ ] Personal page in Projected mode, 6-month window: Combined box equals (Cash) + (Income) - (Expected Expenses), where each value is visible in the raw API response
- [ ] YTD toggle on Overview shows confirmed income entries totaling since Jan 1
- [ ] Business page with zero data shows all $0.00, no deficit banner

### Classification and distributions
- [ ] Log a $10,000 external_income on the business book and a $6,000 owner_distribution from business to personal. Overview Income shows $10,000 (not $16,000). Personal Income shows $6,000. Business Income shows $10,000.
- [ ] Set a standing distribution schedule: $3,000 monthly, biz → personal, anchor date = 1st of month. Run the daily cron. Verify 12 new `projected_income` rows with `classification = 'owner_distribution'` and `linked_schedule_id` set.
- [ ] Deactivate that schedule. Re-run cron. Verify future projected rows are deleted.
- [ ] Manually override an auto-classified entry from `external_income` to `owner_distribution`. Verify Overview Income updates to exclude it.
- [ ] Trigger Plaid sync with a payroll provider transaction (e.g., Gusto). Verify it auto-classifies as `owner_distribution`.
- [ ] Trigger Plaid sync with a business-to-business transfer. Verify it auto-classifies as `internal_transfer`, not `owner_distribution`.

### Toggle behavior
- [ ] Switching time window on any page recalculates all three boxes
- [ ] Switching mode on any page recalculates all three boxes
- [ ] Toggle state persists across page refresh (localStorage)
- [ ] Toggle state carries across pages (switch from Personal to Overview keeps the same mode/window)
- [ ] Mobile: sticky header stays pinned when scrolling

### Deficit banner
- [ ] Banner appears in red when Combined < 0
- [ ] Banner hides when Combined ≥ 0
- [ ] Banner text correctly names the window
- [ ] Banner is not dismissable

### Edge cases
- [ ] Plaid timeout: cached balance fallback works within 2 seconds
- [ ] Wife's login: can see all three pages with real data
- [ ] Wife can CRUD distribution schedules
- [ ] Budget allocation deduplication: rent bill does not double-count against housing budget
- [ ] Window spanning today: income splits confirmed/projected at today correctly
- [ ] Owner distribution on Business Projected Cash box: reduces forward cash balance
- [ ] Owner distribution on Personal Projected Cash box: increases forward cash balance
- [ ] Overview Cash box is unaffected by owner distributions (biz and personal cancel out)

### Performance
- [ ] API response <500ms on each page
- [ ] No layout shift when toggles change
- [ ] Skeleton loaders show during initial load

---

## 20. Acceptance criteria

The feature is done when:

1. All four pages render the sticky header, three boxes, and (when applicable) deficit banner.
2. Both toggles work on all four pages.
3. Distribution schedule manager is live on the Plan page, fully CRUD.
4. Daily cron generates `projected_income` rows from active schedules, idempotently.
5. Plaid auto-classification applies the 5-rule logic from section 6d.
6. Overview Income correctly excludes owner distributions, preventing double-counting.
7. All test cases in section 19 pass.
8. API response time is under 500ms on each page.
9. Wife can log in and see all three books' projections, including managing schedules.
10. Empty books show zeros without firing the banner.
11. No regressions in the existing income feature, Plan page, or overview dashboard.

---

## 21. Out of scope (explicitly NOT in this build)

- Custom date range picker (phase 2)
- Editable pay periods as a first-class concept (phase 3)
- Separate fixed YTD box that doesn't move with the toggle (phase 4)
- Syncing toggle state to user profile across devices (phase 2)
- What-If scenario integration (stays independent by design)
- Alerts/notifications when deficit is forecasted (phase 2)
- Linking distribution amounts to a percentage of business revenue (phase 2)
- Multi-member LLC distributions across multiple owners (not applicable yet)

---

## 22. Distribution flow — confirmed answer

**Answer: (a) Direct ACH from the LLC's business bank to the personal bank (owner's draw).**

No payroll provider in the loop. Distributions land as ACH transfers from the LLC's business checking directly into personal checking.

### Implications for section 6d

- **Rules 1, 2, 3 are the critical path.** Rule 3 (counterpart debit on a business account within $0.01 and ±3 days of a personal credit) is the primary detector for owner distributions, since Plaid may not always tag ACH-out/ACH-in as TRANSFER_OUT/TRANSFER_IN when the source and destination institutions differ.
- **Rule 4 (payroll provider merchant name) is backup / defensive only.** Keep it in the code for future-proofing, but do not expect it to fire in normal operation.
- **Rule 5 (external_income default, unconfirmed)** remains the safety net.

### Tuning guidance for rule 3

- The ±3 day window is generous on purpose — ACH between two different banks routinely lands the next business day, sometimes +2 over a weekend. Do NOT tighten this to ±1 day without a specific reason.
- The $0.01 tolerance is for rounding only. ACH amounts match exactly in virtually all cases.
- When a match fires, link both the business debit and personal credit `transactions.id` on the resulting classification record so the user can audit the pairing from the Unconfirmed Income widget.

---

## 23. Questions for the user during the build

If any schema gap, RLS surprise, math ambiguity, or UI conflict comes up, pause and report before making a judgment call. This feature is too important to guess on.
