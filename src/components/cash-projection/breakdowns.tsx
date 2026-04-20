"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { INCOME_CLASSIFICATION_LABELS } from "@/lib/types";
import type {
  CashProjectionDetail,
  DetailAccountRow,
  DetailBillRow,
  DetailBudgetAllocation,
  DetailDedupMatch,
  DetailDistributionOutflow,
  DetailIncomeLine,
  DetailOutflowLine,
} from "@/lib/cash-projection/detail-types";
import type { CashProjectionResponse } from "./types";

// ---- Navigation helpers ----

export type NavigateHandler = (path: string) => void;

export function safeNavigate(
  router: ReturnType<typeof useRouter>,
  targetKind: string,
  path: string
) {
  if (!path) {
    console.warn(`TODO: navigation target for ${targetKind}`);
    return;
  }
  router.push(path);
}

function useNav() {
  const router = useRouter();
  return (kind: string, path: string | null) => {
    if (!path) {
      console.warn(`TODO: navigation target for ${kind}`);
      return;
    }
    router.push(path);
  };
}

// ---- Shared UI ----

function SectionHeader({
  title,
  subtotal,
  subtotalLabel = "Subtotal",
  hint,
}: {
  title: string;
  subtotal?: number;
  subtotalLabel?: string;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border-subtle pb-1">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </div>
      {subtotal !== undefined && (
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {subtotalLabel}
          </p>
          <p className="num text-sm font-semibold text-foreground">
            {formatCurrency(subtotal)}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const interactive = !!onClick;
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        interactive
          ? "cursor-pointer hover:bg-card-hover"
          : ""
      }`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-muted">
      {children}
    </p>
  );
}

function MathLine({
  label,
  amount,
  final,
}: {
  label: string;
  amount: number;
  final?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${
        final ? "border-t border-border pt-2" : ""
      }`}
    >
      <span
        className={`${final ? "text-sm font-semibold" : "text-xs"} text-foreground`}
      >
        {label}
      </span>
      <span
        className={`num ${
          final
            ? amount < 0
              ? "text-base font-bold text-deficit"
              : "text-base font-bold text-surplus"
            : "text-sm font-medium text-foreground"
        }`}
      >
        {amount < 0 ? "-" : ""}
        {formatCurrency(Math.abs(amount))}
      </span>
    </div>
  );
}

// ---- Account row ----

function AccountRow({
  row,
  onOpen,
}: {
  row: DetailAccountRow;
  onOpen: () => void;
}) {
  const displayName = row.nickname || row.name;
  const balance = row.available_balance ?? row.current_balance;
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{displayName}</p>
        <p className="text-[10px] text-muted">
          {[
            row.subtype ?? row.book,
            row.mask ? `••${row.mask}` : null,
            row.last_synced_at
              ? `Synced ${formatShortDate(row.last_synced_at.slice(0, 10))}`
              : "Cached",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <span className="num font-medium text-foreground">
        {formatCurrency(balance)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

// ---- Income line row ----

function IncomeLineRow({
  row,
  onOpen,
}: {
  row: DetailIncomeLine;
  onOpen: () => void;
}) {
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">
          {row.source || "Unknown source"}
        </p>
        <p className="text-[10px] text-muted">
          {formatShortDate(row.date)} ·{" "}
          <span className="uppercase tracking-wide">
            {INCOME_CLASSIFICATION_LABELS[row.classification]}
          </span>
          {row.linked_schedule_id ? " · schedule" : ""}
          {row.linked_transaction_id ? " · Plaid" : ""}
        </p>
      </div>
      <span className="num font-medium text-surplus">
        +{formatCurrency(row.amount)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

// ---- Outflow / Bill / Budget rows ----

function OutflowRow({
  row,
  onOpen,
}: {
  row: DetailOutflowLine;
  onOpen: () => void;
}) {
  const kindLabel = {
    bill: "Bill",
    budget_allocation: "Budget",
    distribution_outflow: "Distribution",
    posted_expense: "Posted",
  }[row.kind];
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{row.name}</p>
        <p className="text-[10px] text-muted">
          {row.date_end
            ? `${formatShortDate(row.date_start)}–${formatShortDate(row.date_end)}`
            : formatShortDate(row.date_start)}{" "}
          · {kindLabel}
          {row.category_name ? ` · ${row.category_name}` : ""}
          {row.status ? ` · ${row.status}` : ""}
        </p>
      </div>
      <span className="num font-medium text-deficit">
        -{formatCurrency(row.amount)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

function BillRowDisplay({
  row,
  onOpen,
}: {
  row: DetailBillRow;
  onOpen: () => void;
}) {
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{row.name}</p>
        <p className="text-[10px] text-muted">
          {formatShortDate(row.due_date)} · {row.status}
          {row.category_name ? ` · ${row.category_name}` : ""}
        </p>
      </div>
      <span className="num font-medium text-deficit">
        -{formatCurrency(row.amount)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

function BudgetAllocationRow({
  row,
  onOpen,
}: {
  row: DetailBudgetAllocation;
  onOpen: () => void;
}) {
  const math = row.segments
    .map((s) => `${s.label}: ${formatCurrency(s.amount)}`)
    .join(" + ");
  const dedupNote =
    row.bill_dedup_applied > 0
      ? ` − bill dedup ${formatCurrency(row.bill_dedup_applied)}`
      : "";
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">
          {row.category_name ?? row.budget_name}
        </p>
        <p className="text-[10px] text-muted">
          {math || "No segments in window"}
          {dedupNote} = {formatCurrency(row.final_total)}
        </p>
      </div>
      <span className="num font-medium text-deficit">
        -{formatCurrency(row.final_total)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

function DistributionOutflowRow({
  row,
  onOpen,
}: {
  row: DetailDistributionOutflow;
  onOpen: () => void;
}) {
  return (
    <Row onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">
          {row.notes ?? "Owner distribution"}
        </p>
        <p className="text-[10px] text-muted">
          {formatShortDate(row.date)} · {row.source_book} → {row.target_book}
        </p>
      </div>
      <span className="num font-medium text-deficit">
        -{formatCurrency(row.amount)}
      </span>
      <ChevronRight className="h-3 w-3 text-muted" />
    </Row>
  );
}

// ---- Skeleton ----

export function BreakdownSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-border-subtle/60" />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              className="h-6 animate-pulse rounded bg-border-subtle/40"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- Cash breakdown ----

export function CashBreakdown({
  summary,
  detail,
  onNavigateBox,
}: {
  summary: CashProjectionResponse;
  detail: CashProjectionDetail;
  onNavigateBox?: (target: "income" | "expenses") => void;
}) {
  const nav = useNav();
  const starting = detail.cash.starting_balance.total;
  const inflows = detail.cash.inflows.subtotal;
  const outflows = detail.cash.outflows.subtotal;
  void onNavigateBox;

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader
          title="Starting balance"
          subtotal={starting}
          subtotalLabel="Sum"
          hint="Current balance across every depository account in scope."
        />
        {detail.cash.starting_balance.accounts.length === 0 ? (
          <EmptyRow>No depository accounts in scope.</EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.cash.starting_balance.accounts.map((a) => (
              <AccountRow
                key={a.id}
                row={a}
                onOpen={() => nav("account", `/accounts/${a.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Inflows in window"
          subtotal={inflows}
          hint={
            summary.mode === "live"
              ? "Confirmed income already received in the window."
              : "Confirmed past + projected future income in the window."
          }
        />
        {detail.cash.inflows.entries.length === 0 ? (
          <EmptyRow>No income in this window.</EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.cash.inflows.entries.map((row) => (
              <IncomeLineRow
                key={`${row.kind}:${row.id}`}
                row={row}
                onOpen={() => {
                  if (row.kind === "projected_income") {
                    if (row.linked_schedule_id) {
                      nav("schedule", "/personal/plan");
                    } else {
                      nav("projected_income", "/personal/plan");
                    }
                  } else {
                    // Existing income edit dialog lives in the Unconfirmed
                    // Income widget & income list. No direct deep-link
                    // available yet; drop user on the income surface.
                    nav("income_entry", "/personal#income");
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Outflows in window"
          subtotal={outflows}
          hint={
            summary.mode === "projected"
              ? "Bills + budget allocations + owner-distribution outflows (business scope)."
              : summary.mode === "scheduled"
                ? "Unpaid bills scheduled in the window."
                : "Posted expenses that hit the account in the window."
          }
        />
        {detail.cash.outflows.entries.length === 0 ? (
          <EmptyRow>No outflows in this window.</EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.cash.outflows.entries.map((row) => (
              <OutflowRow
                key={`${row.kind}:${row.id}`}
                row={row}
                onOpen={() => {
                  if (row.kind === "bill") {
                    nav("bill", null);
                  } else if (row.kind === "budget_allocation") {
                    nav("budget", "/personal/budgets");
                  } else if (row.kind === "distribution_outflow") {
                    nav("schedule", "/personal/plan");
                  } else {
                    nav("transaction", null);
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-card-hover/40 p-3">
        <MathLine label="Starting balance" amount={starting} />
        <MathLine label="+ Inflows" amount={inflows} />
        <MathLine label="− Outflows" amount={-outflows} />
        <div className="mt-2">
          <MathLine
            label="= Cash box total"
            amount={summary.cash.amount}
            final
          />
        </div>
      </section>
    </div>
  );
}

// ---- Income breakdown ----

export function IncomeBreakdown({
  summary,
  detail,
}: {
  summary: CashProjectionResponse;
  detail: CashProjectionDetail;
}) {
  const nav = useNav();
  const [showPastExcluded, setShowPastExcluded] = useState(false);
  const [showFutureExcluded, setShowFutureExcluded] = useState(false);

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader
          title="Past portion (window start → today)"
          subtotal={detail.income.past.subtotal}
          hint="Confirmed income_entries received in the past portion of the window."
        />
        {detail.income.past.entries.length === 0 ? (
          <EmptyRow>No confirmed income in this portion.</EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.income.past.entries.map((row) => (
              <IncomeLineRow
                key={row.id}
                row={row}
                onOpen={() =>
                  nav("income_entry", "/personal#income")
                }
              />
            ))}
          </div>
        )}
        {detail.income.past.excluded_owner_distributions_count > 0 && (
          <ExcludedNote
            count={detail.income.past.excluded_owner_distributions_count}
            amount={detail.income.past.excluded_owner_distributions_amount}
            expanded={showPastExcluded}
            onToggle={() => setShowPastExcluded((v) => !v)}
          />
        )}
      </section>

      <section>
        <SectionHeader
          title="Future portion (today → window end)"
          subtotal={detail.income.future.subtotal}
          hint="Projected_income entries in the future portion of the window."
        />
        {detail.income.future.entries.length === 0 ? (
          <EmptyRow>
            {summary.mode === "live"
              ? "Live mode does not include projected future income."
              : "No projected income in this portion."}
          </EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.income.future.entries.map((row) => (
              <IncomeLineRow
                key={row.id}
                row={row}
                onOpen={() =>
                  nav(
                    "projected_income",
                    row.linked_schedule_id
                      ? "/personal/plan"
                      : "/personal/plan"
                  )
                }
              />
            ))}
          </div>
        )}
        {detail.income.future.excluded_owner_distributions_count > 0 && (
          <ExcludedNote
            count={detail.income.future.excluded_owner_distributions_count}
            amount={detail.income.future.excluded_owner_distributions_amount}
            expanded={showFutureExcluded}
            onToggle={() => setShowFutureExcluded((v) => !v)}
          />
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-card-hover/40 p-3">
        <MathLine
          label="Past confirmed"
          amount={detail.income.past.subtotal}
        />
        <MathLine
          label="+ Future projected"
          amount={detail.income.future.subtotal}
        />
        <div className="mt-2">
          <MathLine
            label="= Income box total"
            amount={summary.income.amount}
            final
          />
        </div>
      </section>
    </div>
  );
}

function ExcludedNote({
  count,
  amount,
  expanded,
  onToggle,
}: {
  count: number;
  amount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-2 rounded border border-border-subtle bg-card-hover/50 px-3 py-2 text-xs text-muted">
      <div className="flex items-center gap-2">
        <Info className="h-3 w-3 flex-shrink-0" />
        <span>
          {count} owner distribution{count === 1 ? "" : "s"} ({formatCurrency(amount)})
          excluded from Overview to prevent double-counting.
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto text-accent-blue hover:underline"
        >
          {expanded ? "Hide" : "View anyway"}
        </button>
      </div>
      {expanded && (
        <p className="mt-1.5 text-[11px] text-muted">
          Owner distributions net to zero on Overview — they move cash from
          one book to another inside the household. The underlying client
          payment was already counted on the business book when it came in.
        </p>
      )}
    </div>
  );
}

// ---- Expenses breakdown ----

export function ExpensesBreakdown({
  summary,
  detail,
}: {
  summary: CashProjectionResponse;
  detail: CashProjectionDetail;
}) {
  const nav = useNav();
  const [showDedup, setShowDedup] = useState(false);

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader
          title="Bills"
          subtotal={detail.expenses.bills_subtotal}
          hint="Unpaid, active-lifecycle bills due in the window."
        />
        {detail.expenses.bills.length === 0 ? (
          <EmptyRow>No bills in this window.</EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.expenses.bills.map((b) => (
              <BillRowDisplay
                key={b.id}
                row={b}
                onOpen={() => nav("bill", null)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Budget allocations"
          subtotal={detail.expenses.budget_allocations_subtotal}
          hint="Prorated across months in window. Current month uses remaining allocation."
        />
        {detail.expenses.budget_allocations.length === 0 ? (
          <EmptyRow>
            {summary.mode === "projected"
              ? "No active budget categories in scope."
              : "Budget allocations apply only in Projected mode."}
          </EmptyRow>
        ) : (
          <div className="space-y-0.5">
            {detail.expenses.budget_allocations.map((row) => (
              <BudgetAllocationRow
                key={`${row.budget_id}:${row.category_id ?? "_"}`}
                row={row}
                onOpen={() =>
                  nav(
                    "budget",
                    `/personal/budgets/${row.budget_id}`
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {detail.expenses.distribution_outflows.length > 0 && (
        <section>
          <SectionHeader
            title="Owner distribution outflows"
            subtotal={detail.expenses.distribution_outflows_subtotal}
            hint="Occurrences of active distribution schedules leaving this book in the window."
          />
          <div className="space-y-0.5">
            {detail.expenses.distribution_outflows.map((row) => (
              <DistributionOutflowRow
                key={`${row.schedule_id}:${row.date}`}
                row={row}
                onOpen={() => nav("schedule", "/personal/plan")}
              />
            ))}
          </div>
        </section>
      )}

      {detail.expenses.dedup_applied.length > 0 && (
        <section className="rounded border border-border-subtle bg-card-hover/50 p-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <Info className="h-3 w-3 flex-shrink-0" />
            <span>
              Bills already counted in matching budget categories have been
              excluded from allocations to prevent double-counting.
            </span>
            <button
              type="button"
              onClick={() => setShowDedup((v) => !v)}
              className="ml-auto text-accent-blue hover:underline"
            >
              {showDedup ? "Hide details" : "View details"}
            </button>
          </div>
          {showDedup && (
            <ul className="mt-2 space-y-1 border-t border-border-subtle pt-2">
              {detail.expenses.dedup_applied.map((m: DetailDedupMatch) => (
                <li
                  key={`${m.bill_id}:${m.category_id}`}
                  className="flex items-center justify-between"
                >
                  <span>
                    {m.bill_name} → {m.category_name}
                  </span>
                  <span className="num">{formatCurrency(m.bill_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border-subtle bg-card-hover/40 p-3">
        <MathLine label="Bills" amount={detail.expenses.bills_subtotal} />
        <MathLine
          label="+ Budget allocations"
          amount={detail.expenses.budget_allocations_subtotal}
        />
        {detail.expenses.distribution_outflows_subtotal > 0 && (
          <MathLine
            label="+ Distribution outflows"
            amount={detail.expenses.distribution_outflows_subtotal}
          />
        )}
        <div className="mt-2">
          <MathLine
            label="= Expenses total"
            amount={detail.expenses.grand_total}
            final
          />
        </div>
      </section>
    </div>
  );
}

// ---- Combined summary ----

export function CombinedBreakdown({
  summary,
  onOpenCash,
  onOpenIncome,
  onOpenExpenses,
}: {
  summary: CashProjectionResponse;
  onOpenCash: () => void;
  onOpenIncome: () => void;
  onOpenExpenses: () => void;
}) {
  const cash = summary.cash.starting_balance;
  const income = summary.income.amount;
  const expenses = summary.expected_expenses.deduplicated_total;
  const combined = summary.combined.amount;
  const deficit = summary.combined.is_deficit;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Combined = starting cash + income in window − expenses in window.
        Click any line below to drill into it.
      </p>
      <div className="space-y-1 rounded-lg border border-border-subtle bg-card p-3">
        <FormulaLine label="Cash" amount={cash} onClick={onOpenCash} />
        <FormulaLine
          label="+ Income"
          amount={income}
          onClick={onOpenIncome}
        />
        <FormulaLine
          label="− Expenses"
          amount={-expenses}
          onClick={onOpenExpenses}
        />
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-foreground">
              = Combined
            </span>
            <span
              className={`num text-base font-bold ${
                deficit ? "text-deficit" : "text-surplus"
              }`}
            >
              {deficit ? "-" : "+"}
              {formatCurrency(Math.abs(combined))}{" "}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                {deficit ? "Deficit" : "Surplus"}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormulaLine({
  label,
  amount,
  onClick,
}: {
  label: string;
  amount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-hover"
    >
      <span className="text-sm text-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="num text-sm font-medium text-foreground">
          {amount < 0 ? "-" : ""}
          {formatCurrency(Math.abs(amount))}
        </span>
        <ChevronRight className="h-3 w-3 text-muted" />
      </span>
    </button>
  );
}
