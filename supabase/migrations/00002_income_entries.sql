-- Income tracking: manual entry + Plaid auto-detect. Separate from
-- projected_income (which remains the future-forecast input written by the
-- scenarios→promote flow). income_entries is the ledger of actual money
-- received. The two are linked via linked_plan_item_id so the Plan view can
-- render actual-vs-expected.

create type income_category as enum (
  'consulting',
  'speaking',
  'royalties',
  'product',
  'refund',
  'gift',
  'other'
);

create table income_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book book_type not null,
  account_id uuid references accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  received_date date,
  expected_date date,
  source text,
  category income_category not null default 'other',
  notes text,
  linked_transaction_id uuid references transactions(id) on delete set null,
  linked_plan_item_id uuid references projected_income(id) on delete set null,
  is_confirmed boolean not null default true,
  -- likely_transfer is a *flag*, never auto-suppression. Shaq wants to see
  -- these in the Unconfirmed widget and dismiss manually.
  likely_transfer boolean not null default false,
  transfer_match_txn_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint income_entries_has_date check (
    received_date is not null or expected_date is not null
  ),
  -- One income_entry per Plaid transaction. Manual entries have NULL link.
  constraint income_entries_linked_txn_unique unique (linked_transaction_id)
);

alter table income_entries enable row level security;

create policy "Users can read income in their books"
  on income_entries for select using (user_has_book_access(book));

create policy "Users can insert income in their books"
  on income_entries for insert with check (user_has_book_access(book));

create policy "Users can update income in their books"
  on income_entries for update using (user_has_book_access(book));

create policy "Users can delete income in their books"
  on income_entries for delete using (user_has_book_access(book));

create index idx_income_entries_book_received
  on income_entries(book, received_date desc);
create index idx_income_entries_pending
  on income_entries(is_confirmed) where is_confirmed = false;
create index idx_income_entries_account on income_entries(account_id);
create index idx_income_entries_linked_txn on income_entries(linked_transaction_id);
create index idx_income_entries_linked_plan on income_entries(linked_plan_item_id);

create or replace function income_entries_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger income_entries_updated_at
  before update on income_entries
  for each row execute function income_entries_set_updated_at();
