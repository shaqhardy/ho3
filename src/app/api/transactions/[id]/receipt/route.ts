import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Book = "personal" | "business" | "nonprofit";

// Uploads a single receipt file to the `documents` bucket and writes the
// resulting path into transactions.receipt_url.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });

  const admin = await createServiceClient();
  const { data: txn } = await admin
    .from("transactions")
    .select("id, book")
    .eq("id", id)
    .maybeSingle();
  if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, allowed_books")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const allowed = (profile?.allowed_books ?? []) as Book[];
  if (!isAdmin && !allowed.includes(txn.book as Book))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ext = file.name.split(".").pop() || "bin";
  const path = `receipts/${id}/${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("documents")
    .upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr)
    return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: signed } = await admin.storage
    .from("documents")
    .createSignedUrl(path, 60 * 60 * 24 * 365);

  const url = signed?.signedUrl || path;
  await admin
    .from("transactions")
    .update({ receipt_url: url })
    .eq("id", id);

  return NextResponse.json({ success: true, receipt_url: url });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await createServiceClient();
  await admin.from("transactions").update({ receipt_url: null }).eq("id", id);
  return NextResponse.json({ success: true });
}
