import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { file_url, transaction_id } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Download file
  const { data: fileData } = await adminSupabase.storage
    .from("documents")
    .download(file_url);

  if (!fileData) {
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 400 }
    );
  }

  const buffer = await fileData.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const extension = file_url.split(".").pop()?.toLowerCase();
  let mediaType = "image/jpeg";
  if (extension === "png") mediaType = "image/png";
  else if (extension === "webp") mediaType = "image/webp";

  // Call Claude Vision
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `Analyze this receipt image. Extract the following and return as JSON only:

{
  "merchant": "<store/business name>",
  "total": <total amount as number>,
  "date": "<YYYY-MM-DD>",
  "line_items": [{"description": "<item>", "amount": <price>}]
}

If a field cannot be found, use null.`,
            },
          ],
        },
      ],
    }),
  });

  const aiResponse = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: aiResponse.error?.message || "OCR failed" },
      { status: 500 }
    );
  }

  const content = aiResponse.content?.[0]?.text || "";
  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return NextResponse.json({ error: "Parse failed", raw: content }, { status: 500 });
  }

  // Update the transaction with receipt URL and parsed data
  if (transaction_id) {
    const updates: Record<string, unknown> = { receipt_url: file_url };
    if (parsed?.merchant) updates.merchant = parsed.merchant;
    if (parsed?.total) updates.amount = parsed.total;
    if (parsed?.date) updates.date = parsed.date;

    await adminSupabase
      .from("transactions")
      .update(updates)
      .eq("id", transaction_id);
  }

  return NextResponse.json({ parsed, file_url });
}
