import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { file_url, debt_id } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  // Download the file from Supabase Storage to get base64
  const { createClient: createSC } = await import("@supabase/supabase-js");
  const adminSupabase = createSC(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

  // Determine media type
  const extension = file_url.split(".").pop()?.toLowerCase();
  let mediaType = "image/jpeg";
  if (extension === "png") mediaType = "image/png";
  else if (extension === "pdf") mediaType = "application/pdf";
  else if (extension === "webp") mediaType = "image/webp";

  // Call Claude Vision API
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
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: `Analyze this financial statement image. Extract the following information and return it as JSON only (no other text):

{
  "current_balance": <number - the current balance or amount owed>,
  "minimum_payment": <number - the minimum payment due>,
  "due_date": "<YYYY-MM-DD format - the payment due date>",
  "statement_date": "<YYYY-MM-DD format - the statement date>",
  "apr": <number - the annual percentage rate if visible, null if not>,
  "line_items": [{"description": "<string>", "amount": <number>}]
}

If a field cannot be found, use null. For amounts, return numbers without currency symbols. Parse dates into YYYY-MM-DD format.`,
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

  // Parse the response
  const content = aiResponse.content?.[0]?.text || "";

  let parsed;
  try {
    // Extract JSON from the response (in case it's wrapped in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return NextResponse.json(
      { error: "Failed to parse OCR response", raw: content },
      { status: 500 }
    );
  }

  if (!parsed) {
    return NextResponse.json(
      { error: "No structured data found", raw: content },
      { status: 500 }
    );
  }

  // Store the parsed statement
  const { data: statement, error } = await adminSupabase
    .from("debt_statements")
    .insert({
      debt_id,
      file_url,
      parsed_balance: parsed.current_balance,
      parsed_minimum: parsed.minimum_payment,
      parsed_due_date: parsed.due_date,
      statement_date:
        parsed.statement_date || new Date().toISOString().split("T")[0],
      confirmed: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ statement, parsed });
}
