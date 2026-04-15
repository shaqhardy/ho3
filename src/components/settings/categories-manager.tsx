"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ElevatedCard, StatCard } from "@/components/ui/card";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Merge,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { BOOK_LABELS } from "@/lib/books";
import type { Book } from "@/lib/types";

interface CategoryRow {
  id: string;
  book: Book;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  is_shared: boolean;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  txn_count: number;
}

interface Props {
  categories: CategoryRow[];
  allowedBooks: Book[];
}

const PALETTE = [
  "#CC5500", // terracotta
  "#22C55E", // surplus green
  "#EF4444", // deficit red
  "#F59E0B", // warning amber
  "#3B82F6", // blue
  "#A855F7", // purple
  "#EC4899", // pink
  "#9CA3AF", // gray
] as const;

export function CategoriesManager({ categories, allowedBooks }: Props) {
  const router = useRouter();
  const [activeBook, setActiveBook] = useState<Book>(allowedBooks[0] ?? "personal");
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const bookCats = useMemo(
    () =>
      categories.filter(
        (c) => c.book === activeBook && (showArchived || !c.is_archived)
      ),
    [categories, activeBook, showArchived]
  );

  // Group into parent -> children.
  const { parents, childrenByParent } = useMemo(() => {
    const parents: CategoryRow[] = [];
    const childrenByParent = new Map<string, CategoryRow[]>();
    for (const c of bookCats) {
      if (c.parent_id) {
        const arr = childrenByParent.get(c.parent_id) ?? [];
        arr.push(c);
        childrenByParent.set(c.parent_id, arr);
      } else {
        parents.push(c);
      }
    }
    parents.sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
    for (const list of childrenByParent.values()) {
      list.sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      );
    }
    return { parents, childrenByParent };
  }, [bookCats]);

  const allOfBook = useMemo(
    () => categories.filter((c) => c.book === activeBook && !c.is_archived),
    [categories, activeBook]
  );

  const totalCats = bookCats.length;
  const taggedCount = bookCats.reduce((s, c) => s + c.txn_count, 0);
  const emptyCount = bookCats.filter((c) => c.txn_count === 0).length;

  function toggleExpanded(id: string) {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function patch(id: string, patchBody: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/categorize/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Update failed");
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function destroy(id: string, reassignTo: string | null) {
    setBusy(id);
    try {
      const url =
        `/api/categorize/categories/${id}` +
        (reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : "");
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      setDeleteId(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function merge(sourceId: string, targetId: string) {
    setBusy(sourceId);
    try {
      const res = await fetch(`/api/categorize/categories/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Merge failed");
      }
      setMergeId(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(null);
    }
  }

  const deleteTarget = deleteId
    ? categories.find((c) => c.id === deleteId) ?? null
    : null;
  const mergeTarget = mergeId
    ? categories.find((c) => c.id === mergeId) ?? null
    : null;
  const renameTarget = renameId
    ? categories.find((c) => c.id === renameId) ?? null
    : null;

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">Settings</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-xs text-muted">
            Add, rename, recolor, merge, and archive the category set each book
            budgets against.
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-hover"
        >
          <Plus className="h-4 w-4" />
          New category
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {allowedBooks.map((b) => (
          <button
            key={b}
            onClick={() => setActiveBook(b)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              activeBook === b
                ? "border-terracotta bg-terracotta/10 text-terracotta"
                : "border-border-subtle text-muted hover:bg-card-hover"
            }`}
          >
            {BOOK_LABELS[b]}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Categories" value={String(totalCats)} accent="terracotta" />
        <StatCard
          label="Transactions tagged"
          value={taggedCount.toLocaleString()}
          accent="surplus"
        />
        <StatCard
          label="Empty (0 txns)"
          value={String(emptyCount)}
          accent={emptyCount > 0 ? "warning" : "none"}
          color={emptyCount > 0 ? "text-warning" : "text-muted"}
        />
      </div>

      <ElevatedCard accent="terracotta">
        <div className="space-y-1.5">
          {parents.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              No categories yet for {BOOK_LABELS[activeBook]}.
            </p>
          )}
          {parents.map((p) => {
            const kids = childrenByParent.get(p.id) ?? [];
            const isOpen = expanded.has(p.id);
            return (
              <div key={p.id} className="space-y-1.5">
                <CategoryRowView
                  cat={p}
                  hasChildren={kids.length > 0}
                  isExpanded={isOpen}
                  onToggle={() => toggleExpanded(p.id)}
                  onRename={() => setRenameId(p.id)}
                  onColor={(color) => patch(p.id, { color })}
                  onToggleShared={() =>
                    patch(p.id, { is_shared: !p.is_shared })
                  }
                  onToggleArchive={() =>
                    patch(p.id, { is_archived: !p.is_archived })
                  }
                  onSortUp={() =>
                    patch(p.id, { sort_order: p.sort_order - 1 })
                  }
                  onSortDown={() =>
                    patch(p.id, { sort_order: p.sort_order + 1 })
                  }
                  onMerge={() => setMergeId(p.id)}
                  onDelete={() => setDeleteId(p.id)}
                  busy={busy === p.id}
                />
                {isOpen &&
                  kids.map((k) => (
                    <CategoryRowView
                      key={k.id}
                      cat={k}
                      indent
                      onRename={() => setRenameId(k.id)}
                      onColor={(color) => patch(k.id, { color })}
                      onToggleShared={() =>
                        patch(k.id, { is_shared: !k.is_shared })
                      }
                      onToggleArchive={() =>
                        patch(k.id, { is_archived: !k.is_archived })
                      }
                      onSortUp={() =>
                        patch(k.id, { sort_order: k.sort_order - 1 })
                      }
                      onSortDown={() =>
                        patch(k.id, { sort_order: k.sort_order + 1 })
                      }
                      onMerge={() => setMergeId(k.id)}
                      onDelete={() => setDeleteId(k.id)}
                      busy={busy === k.id}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </ElevatedCard>

      {addOpen && (
        <AddCategoryDialog
          book={activeBook}
          parents={allOfBook.filter((c) => !c.parent_id)}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}

      {renameTarget && (
        <RenameDialog
          cat={renameTarget}
          parentOptions={allOfBook.filter(
            (c) => c.id !== renameTarget.id && !c.parent_id
          )}
          onClose={() => setRenameId(null)}
          onSaved={() => {
            setRenameId(null);
            router.refresh();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          cat={deleteTarget}
          reassignOptions={allOfBook.filter((c) => c.id !== deleteTarget.id)}
          onClose={() => setDeleteId(null)}
          busy={busy === deleteTarget.id}
          onConfirm={(reassignTo) => destroy(deleteTarget.id, reassignTo)}
        />
      )}

      {mergeTarget && (
        <MergeDialog
          cat={mergeTarget}
          targetOptions={allOfBook.filter((c) => c.id !== mergeTarget.id)}
          onClose={() => setMergeId(null)}
          busy={busy === mergeTarget.id}
          onConfirm={(targetId) => merge(mergeTarget.id, targetId)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function CategoryRowView({
  cat,
  indent = false,
  hasChildren = false,
  isExpanded = false,
  onToggle,
  onRename,
  onColor,
  onToggleShared,
  onToggleArchive,
  onSortUp,
  onSortDown,
  onMerge,
  onDelete,
  busy = false,
}: {
  cat: {
    id: string;
    name: string;
    color: string | null;
    is_shared: boolean;
    is_archived: boolean;
    txn_count: number;
  };
  indent?: boolean;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  onRename: () => void;
  onColor: (color: string) => void;
  onToggleShared: () => void;
  onToggleArchive: () => void;
  onSortUp: () => void;
  onSortDown: () => void;
  onMerge: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg border border-border-subtle bg-card px-3 py-2 transition hover:bg-card-hover ${
        indent ? "ml-7" : ""
      } ${cat.is_archived ? "opacity-60" : ""}`}
    >
      {hasChildren ? (
        <button
          onClick={onToggle}
          className="text-muted hover:text-foreground"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      ) : (
        <span className="h-4 w-4" />
      )}
      <span
        className="h-3 w-3 flex-shrink-0 rounded-full border border-border-subtle"
        style={{ background: cat.color ?? "#9CA3AF" }}
        aria-hidden
      />
      <span className="flex-1 truncate text-sm font-medium">{cat.name}</span>
      {cat.is_shared && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-accent-blue/10 px-1.5 py-0.5 text-[10px] text-accent-blue"
          title="Shared across books"
        >
          <Users className="h-3 w-3" /> shared
        </span>
      )}
      <span className="w-16 text-right text-xs text-muted num">
        {cat.txn_count}
      </span>

      {/* Action row — always visible on touch, hover-surfaces on desktop */}
      <div className="flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
        <ColorSwatchMenu current={cat.color} onPick={onColor} />
        <IconBtn label="Rename" onClick={onRename}>
          <Pencil className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label={cat.is_shared ? "Unshare" : "Share across books"}
          onClick={onToggleShared}
        >
          <Users className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Move up" onClick={onSortUp}>
          <span className="text-[10px] font-semibold">↑</span>
        </IconBtn>
        <IconBtn label="Move down" onClick={onSortDown}>
          <span className="text-[10px] font-semibold">↓</span>
        </IconBtn>
        <IconBtn label="Merge into…" onClick={onMerge}>
          <Merge className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label={cat.is_archived ? "Restore" : "Archive"}
          onClick={onToggleArchive}
        >
          {cat.is_archived ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        <IconBtn label="Delete" onClick={onDelete} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
        {busy && <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted" />}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded px-1.5 py-1 text-muted transition hover:bg-card hover:text-foreground ${
        danger ? "hover:text-deficit" : ""
      }`}
    >
      {children}
    </button>
  );
}

function ColorSwatchMenu({
  current,
  onPick,
}: {
  current: string | null;
  onPick: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        title="Change color"
        className="rounded px-1.5 py-1 text-muted hover:bg-card hover:text-foreground"
      >
        <span
          className="block h-3.5 w-3.5 rounded-full border border-border-subtle"
          style={{ background: current ?? "#9CA3AF" }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 flex gap-1 rounded-lg border border-border bg-card p-2 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className="h-5 w-5 rounded-full border border-border-subtle hover:scale-110"
              style={{ background: c }}
              aria-label={`Pick ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dialogs
// -----------------------------------------------------------------------------

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm">{children}</div>
      </div>
    </div>
  );
}

function AddCategoryDialog({
  book,
  parents,
  onClose,
  onCreated,
}: {
  book: Book;
  parents: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [parentId, setParentId] = useState<string>("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/categorize/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          name: name.trim(),
          color,
          parent_id: parentId || null,
          is_shared: isShared,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Create failed");
      }
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell title={`New ${BOOK_LABELS[book]} category`} onClose={onClose}>
      <div>
        <label className="label-sm">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
          placeholder="e.g., Rideshare"
        />
      </div>
      <div>
        <label className="label-sm">Color</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full border-2 ${
                color === c ? "border-foreground" : "border-border-subtle"
              }`}
              style={{ background: c }}
              aria-label={`Pick ${c}`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="label-sm">Parent category</label>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
        >
          <option value="">(top level)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={isShared}
          onChange={(e) => setIsShared(e.target.checked)}
        />
        Shared across books
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-muted hover:bg-card-hover"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Create
        </button>
      </div>
    </DialogShell>
  );
}

function RenameDialog({
  cat,
  parentOptions,
  onClose,
  onSaved,
}: {
  cat: { id: string; name: string; parent_id: string | null };
  parentOptions: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [parentId, setParentId] = useState<string>(cat.parent_id ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/categorize/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          parent_id: parentId || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      alert("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell title="Edit category" onClose={onClose}>
      <div>
        <label className="label-sm">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
        />
      </div>
      <div>
        <label className="label-sm">Parent</label>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
        >
          <option value="">(top level)</option>
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-muted hover:bg-card-hover"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Save
        </button>
      </div>
    </DialogShell>
  );
}

function DeleteDialog({
  cat,
  reassignOptions,
  onClose,
  onConfirm,
  busy,
}: {
  cat: { id: string; name: string; txn_count: number };
  reassignOptions: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (reassignTo: string | null) => void;
  busy: boolean;
}) {
  const [reassign, setReassign] = useState<string>("");
  return (
    <DialogShell title={`Delete "${cat.name}"?`} onClose={onClose}>
      <p className="text-sm text-muted">
        {cat.txn_count === 0
          ? "Nothing references this category — safe to delete."
          : `${cat.txn_count} transaction(s) reference this category. Pick a replacement or leave them uncategorized.`}
      </p>
      <div>
        <label className="label-sm">Reassign transactions to</label>
        <select
          value={reassign}
          onChange={(e) => setReassign(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
        >
          <option value="">(leave uncategorized)</option>
          {reassignOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-muted hover:bg-card-hover"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(reassign || null)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-deficit px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete
        </button>
      </div>
    </DialogShell>
  );
}

function MergeDialog({
  cat,
  targetOptions,
  onClose,
  onConfirm,
  busy,
}: {
  cat: { id: string; name: string; txn_count: number };
  targetOptions: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (targetId: string) => void;
  busy: boolean;
}) {
  const [target, setTarget] = useState<string>("");
  return (
    <DialogShell title={`Merge "${cat.name}" into…`} onClose={onClose}>
      <p className="text-sm text-muted">
        All {cat.txn_count} transaction(s), bill links, subscription links, and
        rules will migrate to the target. &ldquo;{cat.name}&rdquo; is deleted after.
      </p>
      <div>
        <label className="label-sm">Target category</label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-subtle bg-card px-3 py-1.5"
        >
          <option value="">Choose…</option>
          {targetOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-muted hover:bg-card-hover"
        >
          Cancel
        </button>
        <button
          onClick={() => target && onConfirm(target)}
          disabled={!target || busy}
          className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Merge className="h-3 w-3" />
          )}
          Merge
        </button>
      </div>
    </DialogShell>
  );
}
