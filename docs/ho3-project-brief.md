# HO3 — Personal, Business & Nonprofit Money App

A private budgeting and survival app for Shaq Hardy and his wife. Built to track personal, business, and nonprofit finances in one place, with a Plan view that helps prioritize bills when money is tight and a catch-up engine for when seasonal income hits.

**Domain:** `ho3.shaqhardy.com` (new subdomain off existing `shaqhardy.com`, DNS at Squarespace, CNAME to Vercel)

## Stack

- **Frontend:** Next.js (App Router) + Tailwind CSS, deployed to Vercel
- **Backend:** Supabase (PostgreSQL, Auth, Row-Level Security, Storage for uploads, Edge Functions)
- **Bank Sync:** Plaid (fresh developer account needed, user will re-link banks via Plaid Link built into the app)
- **Charts:** Recharts (React charting library, already available in the ecosystem)
- **OCR:** Anthropic Claude API vision for statement and receipt parsing (cheaper and more accurate than Google Document AI for varied document layouts)
- **File Storage:** Supabase Storage for statement PDFs and receipt images

## Users & Access

Two users only. No public signup. Admin creates both accounts manually.

- **Shaq:** full access to all three books (Personal, Business, Nonprofit) plus the Overview dashboard
- **Wife:** access to Personal book only, full read/write within it, cannot see Business or Nonprofit

Enforce with Supabase Row-Level Security policies on every table. The `book` column gates everything.

## The Three Books

All financial data is tagged with a `book` enum: `personal`, `business`, `nonprofit`. Each book has multiple accounts (business has one for now but architect for more). Plaid handles balance refresh and transaction import for all of them.

### Business and Nonprofit (simple)

These two only need:
- Account list with live balances (via Plaid)
- Expense list with categories
- Subscription tracker: name, amount, account it hits, next charge date, frequency
- A simple dashboard showing balances, this month's expenses, and upcoming subscription charges in date order

No budgeting, no plan view, no debt tracking. Just visibility.

### Personal (the heavy lift)

This is the survival tool. It needs:

**Account view.** Live balances across all personal accounts via Plaid.

**Bills tracker.** Every recurring bill with its *actual current due date* (not the original due date, the renegotiated or past-due one). User can edit due dates directly. Each bill knows its amount, account it draws from, and category.

**Subscription tracker.** Same as Business/Nonprofit but for personal subscriptions. Show total monthly subscription cost prominently.

**Debt accounts.** A dedicated section. Each debt account holds:
- Creditor name, account nickname, current balance, APR, minimum payment, statement due date
- Upload slot for monthly statements (PDF or image)
- OCR runs on upload via Claude API vision, extracts new balance, minimum payment, and due date, populates the fields, user confirms with one tap
- Projected payoff date and total interest paid if only making minimum payments (calculate with standard amortization)
- History of statements stored in Supabase Storage

**Expense categorization.** Plaid pulls transactions automatically. Claude Code generates a starter category list on first run (suggested: Housing, Utilities, Transportation, Groceries, Discretionary, Insurance, Medical, Debt Payments, Subscriptions, Giving, Kids, Other). User can edit. Auto-categorization rules: if a merchant has been categorized once, remember it and auto-apply going forward. Discretionary stays as one bucket per user request.

**Receipt uploads.** User can attach a photo to any transaction. OCR extracts merchant, total, and date via Claude API vision. Line-item extraction not required for v1 but the OCR call should request it so we have it if we want it later.

**Income.** Track actual income from Plaid plus a section for projected future income (date, source, amount, confidence level). The projection feeds the Plan view.

**Cost of living display.** Calculated from actual spending: weekly, monthly, yearly averages. Update rolling.

**Surplus/deficit projections.** Show running balance projection through end of month and end of year. Inputs: current cash + projected income - all known bills, subscriptions, and debt minimums on their actual due dates. Output: a clear "you'll be $X short on March 22" or "you'll end the month with $X."

**The Plan view.** This is the centerpiece. Every time it loads, it runs fresh:

1. Pulls current cash across all personal accounts
2. Pulls every bill, subscription, and debt minimum with a due date in the next 30 days
3. Sorts by a priority algorithm:
   - Tier 1 (pay no matter what): rent/mortgage, utilities that can be shut off, car payment, insurance, anything affecting credit, anything with a late fee bigger than the minimum
   - Tier 2: debt minimums, recurring necessary subscriptions
   - Tier 3: discretionary recurring charges
4. Walks through the timeline day by day, applying expected income and expenses
5. Flags the exact dates and amounts of any shortfall
6. Recommends which Tier 3 items to cut and which Tier 2 items to call and push
7. User can override any priority manually

Be opinionated. Don't ask the user what they think. Make a recommendation, let them override.

**Catch-up mode (for summer income).** A separate view that activates when projected income exceeds projected expenses by a meaningful margin. Shows debt payoff plan with a toggle: **Avalanche** (highest APR first) or **Snowball** (smallest balance first). Recalculates payoff dates and total interest saved under each strategy. User picks, app shows the month-by-month plan.

### Business-to-Personal Bridge

Business income flows through the business account before paying Shaq. Handle it like this: in the Business book, create an "Owner Pay" expense category. When a transfer goes from business to personal, Plaid sees it on both sides. The app matches them by amount and date (within a 3-day window) and links them as a single logical event. The Personal book sees it as income. The Business book sees it as Owner Pay expense. No double counting in the Overview dashboard.

## Dashboards

**Overview (Shaq only, landing page).** Net worth across all three books. This month's surplus/deficit per book. Upcoming bills and subscriptions across all books in the next 14 days, sorted by date. Quick links into each book.

**Personal dashboard.** Interactive. Cards for: current cash, this month surplus/deficit, end-of-year projection, total monthly subscription cost, total monthly debt payments, total monthly necessary expenses, cost of living (weekly/monthly/yearly toggle). The Plan view lives here as the primary action.

**Business dashboard.** Account balances, upcoming subscription charges, this month's expenses by category.

**Nonprofit dashboard.** Same as Business.

## Database Schema (Supabase)

Core tables, all with RLS policies enforcing book-level access:

- `profiles` (extends auth.users, includes `role` and `allowed_books` array)
- `accounts` (book, name, plaid_account_id, current_balance, type)
- `transactions` (account_id, book, date, amount, merchant, category_id, notes, receipt_url, plaid_transaction_id)
- `categories` (book scope, name, parent_id for nesting)
- `category_rules` (merchant pattern, category_id, book)
- `bills` (book, name, amount, due_date, account_id, category_id, status, priority_tier)
- `subscriptions` (book, name, amount, next_charge_date, frequency, account_id)
- `debts` (account_id, creditor, current_balance, apr, minimum_payment, statement_due_date, payoff_strategy_override)
- `debt_statements` (debt_id, file_url, parsed_balance, parsed_minimum, parsed_due_date, statement_date)
- `projected_income` (book, date, amount, source, confidence)
- `bridge_links` (business_transaction_id, personal_transaction_id)
- `plan_overrides` (user-set priority tweaks)

## Build Order

1. Initialize Next.js + Tailwind, set up Supabase project, write SQL migrations for the schema above
2. Deploy skeleton to Vercel, wire up `ho3.shaqhardy.com` DNS at Squarespace
3. Build auth (manual user creation, no public signup) and RLS policies
4. Wire up Plaid for all existing connected accounts, pull transactions and balances
5. Build the Personal book: accounts, transactions, categorization, bills, subscriptions
6. Build the debt module with statement upload and Claude API vision OCR
7. Build the Plan view with the priority algorithm
8. Build the surplus/deficit projection engine
9. Build the catch-up mode with avalanche/snowball toggle
10. Build the Business and Nonprofit books (lighter scope)
11. Build the business-to-personal bridge matching logic
12. Build the Overview dashboard
13. Add receipt upload + OCR to transactions
14. QA with real data, hand off

## Environment Variables Needed

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `ANTHROPIC_API_KEY` (for OCR)

Ask Shaq for each as you reach the step that needs it.

## Tone & Visual Style

This is a private tool, but it should look good. The user opens this app daily, sometimes multiple times. It needs to feel clean, modern, and motivating, not punishing.

**Design direction:** Dark mode default (deep charcoal background, not pure black). Crisp white and light gray text. Terracotta (#CC5500) as the primary accent for buttons and active states. Green for surplus and positive trends. Red for deficit and shortfalls. Subtle card-based layout with rounded corners and light shadows. Generous whitespace. The font stack should feel premium (Inter for body, a clean geometric sans for headings).

**Charts and graphs (use Recharts throughout).** Place them wherever data tells a story better as a picture than a number:

- **Personal dashboard:** Monthly spending by category (donut chart). Income vs expenses trend (area chart, last 6 months). Surplus/deficit projection through year-end (line chart with a zero line). Debt payoff progress (stacked bar showing each debt shrinking over time).
- **Plan view:** Cash flow waterfall chart showing balance day by day through end of month with income bumps and bill drops.
- **Debt module:** Per-debt payoff curve (line chart showing balance over time under current payments). Side-by-side comparison chart for avalanche vs snowball showing total interest paid and months to payoff.
- **Subscription view:** Pie chart showing subscription cost by category. Monthly subscription spend trend.
- **Business and Nonprofit dashboards:** Simple bar chart for monthly expenses by category. Account balance trend line.
- **Overview dashboard:** Three-book net worth stacked area chart over time. Combined monthly cash flow bar chart.

All charts should be interactive (tooltips on hover, clickable segments to drill down). Animate on load. Responsive on mobile.

**Mobile-first.** Shaq will open this on his phone more than his laptop. Every view must work at 375px wide. The Plan view especially needs to be thumb-friendly.

## Project Documentation

Commit both `ho3-project-brief.md` and `claude-code-kickoff.md` to a `/docs` folder in the GitHub repo. These are the founding documents for the project and should live with the codebase permanently for future reference.

End of brief.
