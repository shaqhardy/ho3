import { PlaidLinkButton } from "@/components/plaid-link-button";
import type { Book } from "@/lib/types";

/**
 * Page-level header rendered above the CashProjectionSection on each book
 * page. Replaces the old per-dashboard header so the page title sits at
 * the top of the scroll and the projection toggles anchor the rest.
 */
export function BookPageHeader({
  book,
  label,
  showConnect = true,
}: {
  book: Book;
  label: string;
  showConnect?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="label-sm">Book</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {label}
        </h1>
      </div>
      {showConnect && (
        <PlaidLinkButton book={book} label="Connect Bank Account" />
      )}
    </header>
  );
}
