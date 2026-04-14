import type { Book } from "@/lib/types";

/**
 * User-facing display labels for the three books. The DB enum stays as
 * personal/business/nonprofit for code + data stability — this module is the
 * single place to translate those codes into the entity names Shaq actually
 * uses. If either entity is later renamed, change it here and the whole app
 * picks it up.
 */
export const BOOK_LABELS: Record<Book, string> = {
  personal: "Personal",
  business: "Shaq Hardy LLC",
  nonprofit: "Orphan No More",
};

export const BOOK_SHORT_LABELS: Record<Book, string> = {
  personal: "Personal",
  business: "Shaq Hardy",
  nonprofit: "ONM",
};

export function bookLabel(book: Book): string {
  return BOOK_LABELS[book];
}
