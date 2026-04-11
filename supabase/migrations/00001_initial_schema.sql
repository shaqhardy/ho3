-- HO3 Initial Schema
-- All tables use RLS with book-level access control

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- Custom types
create type book_type as enum ('personal', 'business', 'nonprofit');
create type bill_status as enum ('upcoming', 'paid', 'overdue', 'skipped');
create type subscription_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type priority_tier as enum ('1', '2', '3');
create type payoff_strategy as enum ('avalanche', 'snowball');
create type confidence_level as enum ('confirmed', 'expected', 'tentative');
create type user_role as enum ('admin', 'user');

-- Profiles (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role user_role not null default 'user',
  allowed_books book_type[] not null default '{personal}',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Admins can read all profiles"
  on profiles for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update profiles"
  on profiles for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Helper function: check if user has access to a book
create or replace function user_has_book_access(check_book book_type)
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
    and check_book = any(allowed_books)
  );
$$ language sql security definer stable;

-- Plaid items (stores access tokens, admin-only)
create table plaid_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id text not null unique,
  plaid_access_token text not null,
  institution_name text,
  cursor text,
  created_at timestamptz not null default now()
);

alter table plaid_items enable row level security;

create policy "Admins can manage plaid items"
  on plaid_items for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Accounts
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  book book_type not null,
  name text not null,
  plaid_account_id text unique,
  plaid_item_id text references plaid_items(plaid_item_id),
  current_balance numeric(12,2) not null default 0,
  available_balance numeric(12,2),
  type text not null default 'depository',
  subtype text,
  mask text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;

create policy "Users can read accounts in their books"
  on accounts for select using (user_has_book_access(book));

create policy "Admins can manage all accounts"
  on accounts for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Categories
create table categories (
  id uuid primary key default uuid_generate_v4(),
  book book_type not null,
  name text not null,
  parent_id uuid references categories(id) on delete set null,
  icon text,
  created_at timestamptz not null default now(),
  unique(book, name)
);

alter table categories enable row level security;

create policy "Users can read categories in their books"
  on categories for select using (user_has_book_access(book));

create policy "Users can manage categories in their books"
  on categories for all using (user_has_book_access(book));

-- Category rules (auto-categorization)
create table category_rules (
  id uuid primary key default uuid_generate_v4(),
  merchant_pattern text not null,
  category_id uuid not null references categories(id) on delete cascade,
  book book_type not null,
  created_at timestamptz not null default now()
);

alter table category_rules enable row level security;

create policy "Users can read rules in their books"
  on category_rules for select using (user_has_book_access(book));

create policy "Users can manage rules in their books"
  on category_rules for all using (user_has_book_access(book));

-- Transactions
create table transactions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id) on delete cascade,
  book book_type not null,
  date date not null,
  amount numeric(12,2) not null,
  merchant text,
  description text,
  category_id uuid references categories(id) on delete set null,
  notes text,
  receipt_url text,
  plaid_transaction_id text unique,
  is_income boolean not null default false,
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "Users can read transactions in their books"
  on transactions for select using (user_has_book_access(book));

create policy "Users can manage transactions in their books"
  on transactions for all using (user_has_book_access(book));

create index idx_transactions_date on transactions(date desc);
create index idx_transactions_book on transactions(book);
create index idx_transactions_account on transactions(account_id);
create index idx_transactions_category on transactions(category_id);
create index idx_transactions_merchant on transactions(merchant);

-- Bills
create table bills (
  id uuid primary key default uuid_generate_v4(),
  book book_type not null,
  name text not null,
  amount numeric(12,2) not null,
  due_date date not null,
  account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  status bill_status not null default 'upcoming',
  priority_tier priority_tier not null default '2',
  is_recurring boolean not null default true,
  frequency subscription_frequency,
  notes text,
  created_at timestamptz not null default now()
);

alter table bills enable row level security;

create policy "Users can read bills in their books"
  on bills for select using (user_has_book_access(book));

create policy "Users can manage bills in their books"
  on bills for all using (user_has_book_access(book));

create index idx_bills_due_date on bills(due_date);
create index idx_bills_book on bills(book);

-- Subscriptions
create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  book book_type not null,
  name text not null,
  amount numeric(12,2) not null,
  next_charge_date date not null,
  frequency subscription_frequency not null default 'monthly',
  account_id uuid references accounts(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "Users can read subscriptions in their books"
  on subscriptions for select using (user_has_book_access(book));

create policy "Users can manage subscriptions in their books"
  on subscriptions for all using (user_has_book_access(book));

-- Debts (personal book only in practice, but schema allows any)
create table debts (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references accounts(id) on delete set null,
  book book_type not null default 'personal',
  creditor text not null,
  nickname text,
  current_balance numeric(12,2) not null,
  apr numeric(5,2) not null default 0,
  minimum_payment numeric(12,2) not null default 0,
  statement_due_date date not null,
  payoff_strategy_override payoff_strategy,
  created_at timestamptz not null default now()
);

alter table debts enable row level security;

create policy "Users can read debts in their books"
  on debts for select using (user_has_book_access(book));

create policy "Users can manage debts in their books"
  on debts for all using (user_has_book_access(book));

-- Debt statements (uploads + OCR results)
create table debt_statements (
  id uuid primary key default uuid_generate_v4(),
  debt_id uuid not null references debts(id) on delete cascade,
  file_url text not null,
  parsed_balance numeric(12,2),
  parsed_minimum numeric(12,2),
  parsed_due_date date,
  statement_date date not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table debt_statements enable row level security;

create policy "Users can read statements for debts in their books"
  on debt_statements for select using (
    exists (
      select 1 from debts
      where debts.id = debt_statements.debt_id
      and user_has_book_access(debts.book)
    )
  );

create policy "Users can manage statements for debts in their books"
  on debt_statements for all using (
    exists (
      select 1 from debts
      where debts.id = debt_statements.debt_id
      and user_has_book_access(debts.book)
    )
  );

-- Projected income
create table projected_income (
  id uuid primary key default uuid_generate_v4(),
  book book_type not null,
  date date not null,
  amount numeric(12,2) not null,
  source text not null,
  confidence confidence_level not null default 'expected',
  created_at timestamptz not null default now()
);

alter table projected_income enable row level security;

create policy "Users can read projected income in their books"
  on projected_income for select using (user_has_book_access(book));

create policy "Users can manage projected income in their books"
  on projected_income for all using (user_has_book_access(book));

-- Bridge links (business-to-personal transfer matching)
create table bridge_links (
  id uuid primary key default uuid_generate_v4(),
  business_transaction_id uuid not null references transactions(id) on delete cascade,
  personal_transaction_id uuid not null references transactions(id) on delete cascade,
  amount numeric(12,2) not null,
  matched_at timestamptz not null default now(),
  unique(business_transaction_id),
  unique(personal_transaction_id)
);

alter table bridge_links enable row level security;

create policy "Admins can manage bridge links"
  on bridge_links for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can read bridge links for their books"
  on bridge_links for select using (
    exists (
      select 1 from transactions t
      where (t.id = bridge_links.business_transaction_id or t.id = bridge_links.personal_transaction_id)
      and user_has_book_access(t.book)
    )
  );

-- Plan overrides (user-set priority tweaks)
create table plan_overrides (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid references bills(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete cascade,
  debt_id uuid references debts(id) on delete cascade,
  override_tier priority_tier not null,
  created_at timestamptz not null default now(),
  constraint one_target check (
    (bill_id is not null)::int +
    (subscription_id is not null)::int +
    (debt_id is not null)::int = 1
  )
);

alter table plan_overrides enable row level security;

create policy "Users can manage their own overrides"
  on plan_overrides for all using (auth.uid() = user_id);

-- Create storage bucket for statements and receipts
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false);

create policy "Authenticated users can upload documents"
  on storage.objects for insert with check (
    bucket_id = 'documents' and auth.role() = 'authenticated'
  );

create policy "Users can read their own documents"
  on storage.objects for select using (
    bucket_id = 'documents' and auth.role() = 'authenticated'
  );

-- Trigger: auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name, role, allowed_books)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'user'),
    coalesce(
      (select array_agg(val::book_type) from jsonb_array_elements_text(new.raw_user_meta_data->'allowed_books') as val),
      '{personal}'::book_type[]
    )
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
