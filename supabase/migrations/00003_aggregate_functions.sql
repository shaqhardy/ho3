-- Aggregate RPCs. Replace unbounded select-then-sum client loops so we
-- stop losing rows to Supabase's 1000-row cap. Both functions exclude
-- split parents — children carry the real categorized amounts.

create or replace function monthly_flows(
  p_books book_type[],
  p_since date
) returns table (
  book book_type,
  year_month text,
  income_total numeric,
  expense_total numeric,
  income_count int,
  expense_count int
) as $$
  select
    t.book,
    to_char(date_trunc('month', t.date), 'YYYY-MM') as year_month,
    coalesce(sum(t.amount) filter (where t.is_income), 0)::numeric as income_total,
    coalesce(sum(t.amount) filter (where not t.is_income), 0)::numeric as expense_total,
    count(*) filter (where t.is_income)::int as income_count,
    count(*) filter (where not t.is_income)::int as expense_count
  from transactions t
  where t.book = any(p_books)
    and t.date >= p_since
    and not exists (
      select 1 from transactions c where c.split_parent_id = t.id
    )
  group by t.book, date_trunc('month', t.date)
  order by t.book, date_trunc('month', t.date);
$$ language sql stable;

grant execute on function monthly_flows(book_type[], date) to authenticated;
grant execute on function monthly_flows(book_type[], date) to service_role;

-- Per-category rollup used by the settings categories count widget and the
-- daily cron's budget-period overspend check. p_from / p_to are nullable —
-- omit both for a lifetime count, pass both for a period window.
create or replace function category_txn_counts(
  p_books book_type[],
  p_from date default null,
  p_to date default null
) returns table (
  book book_type,
  category_id uuid,
  expense_total numeric,
  income_total numeric,
  txn_count int
) as $$
  select
    t.book,
    t.category_id,
    coalesce(sum(t.amount) filter (where not t.is_income), 0)::numeric as expense_total,
    coalesce(sum(t.amount) filter (where t.is_income), 0)::numeric as income_total,
    count(*)::int as txn_count
  from transactions t
  where t.book = any(p_books)
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and not exists (
      select 1 from transactions c where c.split_parent_id = t.id
    )
  group by t.book, t.category_id;
$$ language sql stable;

grant execute on function category_txn_counts(book_type[], date, date) to authenticated;
grant execute on function category_txn_counts(book_type[], date, date) to service_role;
