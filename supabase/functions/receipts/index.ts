import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-receipt-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedKey = Deno.env.get("MOBILE_RECEIPT_API_KEY");
  const receivedKey = req.headers.get("x-receipt-api-key");

  if (!expectedKey || receivedKey !== expectedKey) {
    return json({ error: "Invalid receipt integration key" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const path = new URL(req.url).pathname;

  try {
    if (path.endsWith("/receipts/ocr")) {
      return await handleOcr(req, supabase);
    }

    return await handleExpenseUpload(req, supabase);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function handleOcr(req: Request, supabase: ReturnType<typeof createClient>) {
  const formData = await req.formData();
  const file = formData.get("receipt");

  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "receipt image is required" }, 400);
  }

  const deviceId = cleanString(formData.get("deviceId"));
  const deviceOwner = cleanString(formData.get("deviceOwner")) || "미등록 기기";
  const storagePath = `mobile/${deviceId || "unknown"}/${Date.now()}-${safeFileName(file.name || "receipt.jpg")}`;
  const { error: uploadError } = await supabase.storage.from("receipts").upload(storagePath, file, {
    contentType: file.type || "image/jpeg",
    upsert: true
  });

  if (uploadError) {
    return json({ error: uploadError.message }, 500);
  }

  const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  const ocr = await runOcr(storagePath, supabase);

  return json({
    receipt: {
      merchant: ocr.vendor_name,
      purchasedAt: ocr.transaction_date,
      totalAmount: ocr.total_amount,
      taxAmount: ocr.vat_amount,
      currency: "KRW",
      category: "general",
      rawText: ocr.raw_text
    },
    attachmentId: storagePath,
    deviceId,
    deviceOwner,
    receiptFileUrl: signed?.signedUrl || null
  });
}

async function handleExpenseUpload(req: Request, supabase: ReturnType<typeof createClient>) {
  const body = await req.json();
  const storagePath = cleanString(body.attachmentId);
  const deviceId = cleanString(body.deviceId);
  const deviceOwner = cleanString(body.deviceOwner) || cleanString(body.submittedBy) || "미등록 기기";
  let fileUrl: string | null = null;

  if (storagePath) {
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    fileUrl = signed?.signedUrl || null;
  }

  const purpose = cleanString(body.usageContent) || cleanString(body.merchant) || "영수증 지출";
  const amount = normalizeAmount(body.totalAmount) || 0;
  const usedAt = normalizeDate(body.purchasedAt) || new Date().toISOString().slice(0, 10);

  const expensePayload = {
    used_at: usedAt,
    purpose,
    usage: mapUsage(body.category),
    payment_method: "카드",
    amount,
    evidence_status: storagePath ? "영수증 첨부" : "증빙 필요",
    transfer_status: "해당 없음",
    transfer_summary: null,
    project_id: null,
    requested_by: null,
    review_status: "검토 전",
    review_reason: "모바일 영수증 OCR 등록 확인",
    receipt_file_url: fileUrl,
    receipt_storage_path: storagePath,
    ocr_vendor_name: cleanString(body.merchant),
    ocr_total_amount: amount || null,
    ocr_transaction_date: usedAt,
    is_recurring: false,
    memo: buildMemo(body, deviceOwner, deviceId)
  };

  const { data: expense, error: expenseError } = await supabase
    .from("expense_requests")
    .insert(expensePayload)
    .select("id,purpose,amount,review_reason")
    .single();

  if (expenseError) {
    return json({ error: expenseError.message }, 500);
  }

  const { error: reviewError } = await supabase.from("review_items").insert({
    area: "지출결의",
    title: expense.purpose,
    reason: expense.review_reason || "지출결의 확인",
    amount_or_impact: formatWon(expense.amount),
    owner_label: deviceOwner,
    status: "검토 전",
    target_table: "expense_requests",
    target_id: expense.id,
    checklist: "증빙 첨부 여부, 사용 용도, 결제수단, 금액, 사용 내용을 확인하세요."
  });

  if (reviewError) {
    return json({ error: reviewError.message }, 500);
  }

  return json({ id: expense.id, status: "uploaded", deviceOwner, deviceId });
}

async function runOcr(storagePath: string, supabase: ReturnType<typeof createClient>) {
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OCR_MODEL") || "gpt-4o-mini";

  if (!openAiKey) {
    return normalizeReceiptResult({
      purpose: "OCR API key missing",
      raw_text: "OPENAI_API_KEY is not configured."
    });
  }

  const { data: signed, error: signedError } = await supabase.storage.from("receipts").createSignedUrl(storagePath, 60 * 10);
  if (signedError || !signed?.signedUrl) {
    throw new Error(signedError?.message || "Failed to create signed URL");
  }

  const fileResponse = await fetch(signed.signedUrl);
  const contentType = fileResponse.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await fileResponse.arrayBuffer();
  const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(arrayBuffer)}`;

  const prompt = `
영수증 또는 지출 증빙 이미지를 읽고 JSON만 반환하세요.
필드는 다음과 같습니다.
{
  "vendor_name": "거래처명 또는 null",
  "transaction_date": "YYYY-MM-DD 또는 null",
  "total_amount": 숫자 또는 null,
  "supply_amount": 숫자 또는 null,
  "vat_amount": 숫자 또는 null,
  "purpose": "한 줄 요약",
  "raw_text": "읽은 주요 텍스트"
}
숫자는 쉼표 없이 숫자로만 반환하세요.
`.trim();

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You extract structured receipt data. Return JSON only." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0
    })
  });

  if (!aiResponse.ok) {
    throw new Error(await aiResponse.text());
  }

  const result = await aiResponse.json();
  const content = result.choices?.[0]?.message?.content || "{}";
  return normalizeReceiptResult(JSON.parse(content));
}

function buildMemo(body: Record<string, unknown>, deviceOwner: string, deviceId: string | null) {
  const lines = [
    `업로드 기기 소유자: ${deviceOwner}`,
    deviceId ? `기기 ID: ${deviceId}` : "",
    cleanString(body.rawText) ? `OCR 원문: ${cleanString(body.rawText)}` : "",
    cleanString(body.source) ? `등록 경로: ${cleanString(body.source)}` : "",
    body.batchIndex && body.batchTotal ? `묶음: ${body.batchIndex}/${body.batchTotal}` : ""
  ].filter(Boolean);

  return lines.join("\n") || null;
}

function mapUsage(category: unknown) {
  const value = cleanString(category);
  const map: Record<string, string> = {
    meals: "업무 추진비",
    transport: "여비·출장비",
    supplies: "운영비",
    lodging: "여비·출장비",
    general: "운영비"
  };

  return value ? map[value] || "운영비" : "운영비";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function normalizeReceiptResult(value: Record<string, unknown>) {
  return {
    vendor_name: cleanString(value.vendor_name),
    transaction_date: normalizeDate(value.transaction_date),
    total_amount: normalizeAmount(value.total_amount),
    supply_amount: normalizeAmount(value.supply_amount),
    vat_amount: normalizeAmount(value.vat_amount),
    purpose: cleanString(value.purpose),
    raw_text: cleanString(value.raw_text)
  };
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== "null" ? text : null;
}

function normalizeAmount(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown) {
  const text = cleanString(value);
  if (!text) return null;
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatWon(value: unknown) {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
