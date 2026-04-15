import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "documents";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; statementId: string }> }
) {
  const { id, statementId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();

  const admin = await createServiceClient();
  const { data: account } = await admin
    .from("accounts")
    .select("id, book, name")
    .eq("id", id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as string[];
  if (!isAdmin && !allowed.includes(account.book)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: statement } = await admin
    .from("account_statements")
    .select(
      "id, account_id, plaid_statement_id, period_end, storage_path, byte_size"
    )
    .eq("id", statementId)
    .eq("account_id", id)
    .maybeSingle();

  if (!statement || !statement.storage_path) {
    return NextResponse.json({ error: "Statement not found" }, { status: 404 });
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(BUCKET)
    .download(statement.storage_path);

  if (dlErr || !blob) {
    console.error("[statements/download] storage error", dlErr);
    return NextResponse.json(
      { error: "Failed to download statement" },
      { status: 500 }
    );
  }

  const arrayBuf = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  const asAttachment = request.nextUrl.searchParams.get("download") === "1";
  const safeName =
    `${account.name || "account"}-${statement.period_end || statement.id}.pdf`
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, "_");
  const disposition = asAttachment
    ? `attachment; filename="${safeName}"`
    : `inline; filename="${safeName}"`;

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
