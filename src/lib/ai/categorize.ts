import Anthropic from "@anthropic-ai/sdk";
import type { Book } from "@/lib/types";

/**
 * Thin categorization service over the Anthropic Messages API.
 *
 * Strategy:
 *  - Group inputs by book; each book has its own category list.
 *  - For each book, chunk the transactions into batches of <= 50 and ask
 *    Claude to emit a single tool-call returning a JSON array of
 *    {transaction_id, category_name, confidence}.
 *  - System prompt + category list are marked with `cache_control` so
 *    Claude's prompt cache absorbs them across batches for the same book.
 *  - Resolve category_name -> category_id case-insensitively against the
 *    book's category list. Skip rows Claude doesn't return.
 */

export const AI_CATEGORIZE_MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 50;
const MAX_TOKENS = 4096;

export interface CategorizeInputTxn {
  id: string;
  book: Book;
  merchant: string | null;
  description: string | null;
  amount: number | string;
  date: string;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  is_income?: boolean;
}

export interface CategoryHint {
  id: string;
  name: string;
}

export interface CategorizationResult {
  categoryId: string;
  confidence: number;
  model: string;
}

export type CategorizationMap = Map<string, CategorizationResult>;

interface ToolRow {
  transaction_id: string;
  category_name: string;
  confidence: number;
}

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const SYSTEM_PROMPT = `You are a precise personal-finance transaction categorizer for a three-book bookkeeping system (personal, business, nonprofit).

For each transaction you'll get:
- merchant (normalized name from Plaid, may be null)
- description (raw statement line)
- amount (USD, always positive; is_income flag tells direction)
- date
- pfc_primary / pfc_detailed (Plaid's Personal Finance Category taxonomy — use it as a strong prior but not gospel)

You'll also get the complete list of categories for the transaction's book. Pick the SINGLE best category NAME from that list (exact spelling and case). If nothing fits, choose the book's "Other" category — do not invent new categories.

Confidence guidance:
- 0.95+ : merchant is unambiguous and matches the category perfectly (e.g., "WHOLE FOODS" -> Groceries)
- 0.75-0.94 : good signal from merchant or Plaid PFC
- 0.50-0.74 : plausible but ambiguous — use "Other" with confidence 0.5 if genuinely unsure
- Below 0.5 : you are guessing; prefer "Other"

Return results via the emit_categorizations tool. Always return one row per transaction_id you received.`;

const TOOL_DEFINITION = {
  name: "emit_categorizations",
  description:
    "Return category assignments for a batch of transactions. Every transaction_id provided in the user message must appear exactly once in results.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transaction_id: { type: "string" },
            category_name: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["transaction_id", "category_name", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function buildCategoriesBlock(book: Book, cats: CategoryHint[]): string {
  const names = cats.map((c) => `- ${c.name}`).join("\n");
  return `Book: ${book}\nCategories:\n${names}`;
}

function buildBatchBlock(txns: CategorizeInputTxn[]): string {
  const lines = txns.map((t) => {
    const amt = Number(t.amount);
    const merchant = (t.merchant || "").replace(/\s+/g, " ").trim();
    const desc = (t.description || "").replace(/\s+/g, " ").trim();
    const parts = [
      `id=${t.id}`,
      `merchant=${merchant || "(none)"}`,
      desc && desc !== merchant ? `desc=${desc.slice(0, 160)}` : null,
      `amount=${amt.toFixed(2)}`,
      `date=${t.date}`,
      t.is_income ? `type=income` : `type=expense`,
      t.pfc_primary ? `pfc=${t.pfc_primary}` : null,
      t.pfc_detailed ? `pfc_detailed=${t.pfc_detailed}` : null,
    ].filter(Boolean);
    return parts.join(" | ");
  });
  return `Transactions to categorize (${txns.length}):\n${lines.join("\n")}`;
}

/**
 * Core entry point.
 *
 * @param transactions     flat list; will be grouped by book internally.
 * @param categoriesByBook map from Book to that book's category list.
 * @returns                Map<txnId, {categoryId, confidence, model}>.
 */
export async function categorizeBatch(
  transactions: CategorizeInputTxn[],
  categoriesByBook: Record<Book, CategoryHint[]>
): Promise<CategorizationMap> {
  const out: CategorizationMap = new Map();
  if (transactions.length === 0) return out;

  if (!process.env.ANTHROPIC_API_KEY) {
    // Fail soft: no API key, no AI categorization. Caller can fall back.
    return out;
  }

  const client = getClient();

  // Bucket by book so the cached prompt prefix stays stable within a book.
  const byBook = new Map<Book, CategorizeInputTxn[]>();
  for (const t of transactions) {
    const arr = byBook.get(t.book) ?? [];
    arr.push(t);
    byBook.set(t.book, arr);
  }

  for (const [book, txns] of byBook) {
    const cats = categoriesByBook[book] ?? [];
    if (cats.length === 0) continue;

    const nameToId = new Map<string, string>();
    for (const c of cats) nameToId.set(c.name.toLowerCase(), c.id);

    const categoriesBlock = buildCategoriesBlock(book, cats);

    for (const batch of chunk(txns, BATCH_SIZE)) {
      try {
        const resp = await client.messages.create({
          model: AI_CATEGORIZE_MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: categoriesBlock,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [TOOL_DEFINITION],
          tool_choice: { type: "tool", name: "emit_categorizations" },
          messages: [
            {
              role: "user",
              content: buildBatchBlock(batch),
            },
          ],
        });

        const toolBlock = resp.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );
        if (!toolBlock) continue;
        const input = toolBlock.input as { results?: ToolRow[] };
        const rows = input.results ?? [];

        for (const r of rows) {
          if (!r.transaction_id || !r.category_name) continue;
          const catId = nameToId.get(r.category_name.trim().toLowerCase());
          if (!catId) continue;
          const confidence = Math.max(
            0,
            Math.min(1, Number(r.confidence) || 0)
          );
          out.set(r.transaction_id, {
            categoryId: catId,
            confidence,
            model: AI_CATEGORIZE_MODEL,
          });
        }
      } catch (err) {
        // Don't let one failed batch take down a multi-book run.
        console.error("[ai/categorize] batch failed", err);
      }
    }
  }

  return out;
}
