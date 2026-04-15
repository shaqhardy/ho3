"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import type { Book } from "@/lib/types";
import { BOOK_LABELS } from "@/lib/books";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "outline";

interface LinkedAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  book: Book;
}

interface Props {
  /**
   * The book the linked accounts should default to. When omitted, the button
   * prompts the user to pick a book before opening Plaid Link (used on the
   * Overview dashboard and the global /accounts page).
   */
  book?: Book;
  /** Subset of books the current user can assign to. Defaults to all three. */
  allowedBooks?: Book[];
  /** Route to visit after the post-link modal is confirmed. Defaults to /{book}. */
  returnTo?: string;
  label?: string;
  variant?: Variant;
  className?: string;
}

const ALL_BOOKS: Book[] = ["personal", "business", "nonprofit"];

export function PlaidLinkButton({
  book: initialBook,
  allowedBooks = ALL_BOOKS,
  returnTo,
  label = "Connect Bank Account",
  variant = "primary",
  className = "",
}: Props) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookPrompt, setBookPrompt] = useState<Book | null>(
    initialBook ?? null
  );
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [postLink, setPostLink] = useState<{
    accounts: LinkedAccount[];
    defaultBook: Book;
  } | null>(null);

  const baseClass =
    variant === "primary"
      ? "rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta-hover disabled:opacity-50"
      : "rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-50";

  // --- Plaid Link ----------------------------------------------------------

  const requestLinkToken = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
      });
      const data = await res.json();
      if (data.link_token) setLinkToken(data.link_token);
      else setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      const bookForExchange = bookPrompt ?? "personal";
      const res = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_token,
          institution: metadata.institution,
          book: bookForExchange,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accounts?: LinkedAccount[];
      };
      setLinkToken(null);
      setLoading(false);
      const accounts = data.accounts ?? [];
      if (accounts.length > 0) {
        setPostLink({ accounts, defaultBook: bookForExchange });
      } else {
        // No accounts returned — just refresh whatever view we're on.
        router.refresh();
      }
    },
    onExit: () => {
      setLinkToken(null);
      setLoading(false);
    },
  });

  // Auto-open Plaid as soon as the link token arrives.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // --- Trigger -------------------------------------------------------------

  const handleClick = () => {
    if (initialBook) {
      setBookPrompt(initialBook);
      requestLinkToken();
      return;
    }
    if (bookPrompt) {
      requestLinkToken();
      return;
    }
    setShowBookPicker(true);
  };

  const startWithBook = (b: Book) => {
    setBookPrompt(b);
    setShowBookPicker(false);
    requestLinkToken();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`${baseClass} ${className}`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing…
          </span>
        ) : (
          label
        )}
      </button>

      {showBookPicker && (
        <BookPicker
          allowedBooks={allowedBooks}
          onPick={startWithBook}
          onCancel={() => setShowBookPicker(false)}
        />
      )}

      {postLink && (
        <PostLinkModal
          accounts={postLink.accounts}
          defaultBook={postLink.defaultBook}
          allowedBooks={allowedBooks}
          onClose={() => {
            setPostLink(null);
            setBookPrompt(initialBook ?? null);
            router.push(returnTo ?? `/${postLink.defaultBook}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Book picker (shown when no starting book is implied, e.g. Overview page)
// -----------------------------------------------------------------------------

function BookPicker({
  allowedBooks,
  onPick,
  onCancel,
}: {
  allowedBooks: Book[];
  onPick: (b: Book) => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell onClose={onCancel}>
      <h2 className="text-lg font-semibold text-foreground">
        Which book are these accounts for?
      </h2>
      <p className="mt-1 text-sm text-muted">
        You can reassign individual accounts on the next step — this just sets
        the default.
      </p>
      <div className="mt-5 grid gap-2">
        {allowedBooks.map((b) => (
          <button
            key={b}
            onClick={() => onPick(b)}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-card-hover"
          >
            <span>{BOOK_LABELS[b]}</span>
            <span className="text-xs text-muted">→</span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

// -----------------------------------------------------------------------------
// Post-link modal: one row per returned account with a book picker
// -----------------------------------------------------------------------------

function PostLinkModal({
  accounts,
  defaultBook,
  allowedBooks,
  onClose,
}: {
  accounts: LinkedAccount[];
  defaultBook: Book;
  allowedBooks: Book[];
  onClose: () => void;
}) {
  const [assignments, setAssignments] = useState<Record<string, Book>>(
    Object.fromEntries(accounts.map((a) => [a.id, a.book as Book]))
  );
  const [saving, setSaving] = useState(false);

  const setBook = (id: string, b: Book) =>
    setAssignments((prev) => ({ ...prev, [id]: b }));

  const save = async () => {
    setSaving(true);
    try {
      // Reassign any account whose chosen book differs from what the
      // exchange-token defaulted to.
      const mutations = accounts
        .filter((a) => assignments[a.id] !== a.book)
        .map((a) =>
          fetch(`/api/accounts/${a.id}/reassign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: assignments[a.id] }),
          })
        );
      if (mutations.length > 0) await Promise.all(mutations);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-lg font-semibold text-foreground">
        Assign accounts to books
      </h2>
      <p className="mt-1 text-sm text-muted">
        Defaulted to <span className="font-medium text-foreground">
          {BOOK_LABELS[defaultBook]}
        </span>
        . Change any account that actually belongs to a different book.
      </p>

      <div className="mt-4 divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {a.name}
                {a.mask && (
                  <span className="ml-1 text-xs font-normal text-muted">
                    ••{a.mask}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {a.subtype || a.type}
              </p>
            </div>
            <select
              value={assignments[a.id]}
              onChange={(e) => setBook(a.id, e.target.value as Book)}
              className="rounded-lg border border-border-subtle bg-card px-2 py-1.5 text-xs"
            >
              {allowedBooks.map((b) => (
                <option key={b} value={b}>
                  {BOOK_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          Skip
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
      </div>
    </ModalShell>
  );
}

// -----------------------------------------------------------------------------
// Thin modal shell (no external dep, consistent look)
// -----------------------------------------------------------------------------

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card-elevated p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
