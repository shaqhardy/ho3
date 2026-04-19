// Drain every row matching a Supabase select query. Works around the
// server-side 1000-row cap by looping .range() until a short page returns.
//
// Callers pass a factory because a PostgrestFilterBuilder is one-shot — once
// awaited it cannot be reused for a second page. Each page rebuilds the
// query with a fresh (from, to) range.
//
//   const rows = await fetchAllPaginated<Txn>((from, to) =>
//     admin.from("transactions")
//       .select("id, date, amount")
//       .eq("book", "personal")
//       .order("date", { ascending: false })
//       .range(from, to)
//   );
//
// Order clause matters: without it, the server may return the same row twice
// or skip rows across pages. Always set an order before .range().

// Generic on the *output* type; the input accepts any PostgREST response shape
// (Supabase's generated builder types disagree on embedded-relation shape
// between codegen and runtime, so we accept unknown-data and cast at push).
type PgResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

export async function fetchAllPaginated<T>(
  buildPage: (from: number, to: number) => PromiseLike<PgResponse>,
  pageSize: number = 1000
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Hard cap at 500 pages (500k rows) — defensive against an unbounded
  // query with no order clause accidentally looping forever.
  const MAX_PAGES = 500;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
