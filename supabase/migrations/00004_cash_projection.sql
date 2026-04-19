-- Cash / Income / Combined feature support.
--
-- Adds classification to income_entries and projected_income, creates
-- distribution_schedules + its RLS, adds a cron-idempotent unique index on
-- projected_income(linked_schedule_id, date), and fixes RLS on budgets and
-- budget_categories so non-owner household members with book access (e.g.
-- Re Hardy) can read them for Projected-mode math.
--
-- Note: projected_income.date is the column the spec calls "expected_date".
-- No rename — the DB already uses `date` and changing it would thrash callers.

-- 1. Classification enum + columns ------------------------------------------

create type income_classification as enum (
  'external_income',
  'owner_distribution',
  'internal_transfer'
);

alter table income_entries
  add column classification income_classification not null default 'external_income';

alter table projected_income
  add column classification income_classification not null default 'external_income';

-- Backfill: rows whose linked_transaction_id points at a Plaid transfer txn
-- are internal_transfer. All others stay external_income (the safer default;
-- real owner distributions will be reclassified by the updated sync hook
-- and/or user-initiated override in the Unconfirmed Income widget).
update income_entries ie
set classification = 'internal_transfer'
from transactions t
where ie.linked_transaction_id is not null
  and ie.linked_transaction_id = t.id
  and t.pfc_primary in ('TRANSFER_IN', 'TRANSFER_OUT');

-- 2. distribution_schedules -------------------------------------------------

create type distribution_cadence as enum (
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'custom'
);

create table distribution_schedules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_book book_type not null,
  target_book book_type not null,
  amount numeric(12,2) not null check (amount > 0),
  cadence distribution_cadence not null,
  anchor_date date not null,
  custom_days integer[],
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distribution_schedules_books_distinct
    check (source_book <> target_book),
  constraint distribution_schedules_custom_days_valid
    check (
      cadence <> 'custom'
      or (custom_days is not null and array_length(custom_days, 1) > 0)
    )
);

create index idx_distribution_schedules_active
  on distribution_schedules(is_active)
  where is_active = true;
create index idx_distribution_schedules_user
  on distribution_schedules(user_id);
create index idx_distribution_schedules_target
  on distribution_schedules(target_book);

alter table distribution_schedules enable row level security;

-- Both the schedule owner and any household member with access to the
-- source OR target book can read; writes are scoped to users who have
-- access to both ends of the flow (covers admin wife pattern).
create policy "Users can read schedules touching their books"
  on distribution_schedules for select using (
    user_has_book_access(source_book) or user_has_book_access(target_book)
  );

create policy "Users can manage schedules in their books"
  on distribution_schedules for all using (
    user_has_book_access(source_book) and user_has_book_access(target_book)
  ) with check (
    user_has_book_access(source_book) and user_has_book_access(target_book)
  );

create or replace function distribution_schedules_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger distribution_schedules_updated_at
  before update on distribution_schedules
  for each row execute function distribution_schedules_set_updated_at();

-- 3. projected_income linkage + cron idempotency ----------------------------

alter table projected_income
  add column linked_schedule_id uuid references distribution_schedules(id) on delete set null;

create index idx_projected_income_linked_schedule
  on projected_income(linked_schedule_id)
  where linked_schedule_id is not null;

-- Ensures the daily cron can upsert (schedule, date) pairs safely.
create unique index projected_income_schedule_date_unique
  on projected_income(linked_schedule_id, date)
  where linked_schedule_id is not null;

create index idx_projected_income_book_date
  on projected_income(book, date);

-- 4. income_entries classification indexes ----------------------------------

create index idx_income_entries_book_classification
  on income_entries(book, classification, received_date desc)
  where is_confirmed = true;

create index idx_projected_income_book_classification
  on projected_income(book, classification, date);

-- 5. RLS fix: budgets / budget_categories -----------------------------------
--
-- Current policies scope strictly to auth.uid() = user_id. That breaks the
-- shared-household model: Re Hardy cannot read Shaq's budgets, so Projected
-- mode math on her session would underestimate expected expenses. Add
-- book-scoped SELECT alongside the owner-scoped write policy.

create policy "Users read budgets in their books"
  on budgets for select using (user_has_book_access(book));

create policy "Users read budget categories in their books"
  on budget_categories for select using (
    exists (
      select 1 from budgets b
      where b.id = budget_categories.budget_id
        and user_has_book_access(b.book)
    )
  );
