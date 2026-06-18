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
  const cardLast4 = cleanString(ocr.card_last4);
  const paymentMethod = isCorporateCardLast4(cardLast4) ? "corporate_card" : null;

  return json({
    receipt: {
      merchant: ocr.vendor_name,
      purchasedAt: ocr.transaction_date,
      totalAmount: ocr.total_amount,
      taxAmount: ocr.vat_amount,
      currency: "KRW",
      category: guessSubcategory(ocr.purpose, ocr.raw_text),
      paymentMethod,
      cardLast4,
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
  const deviceOwner =
    await findDeviceOwner(supabase, deviceId)
    || cleanString(body.deviceOwner)
    || cleanString(body.submittedBy)
    || "미등록 기기";
  await rememberDevice(supabase, deviceId, deviceOwner);
  let fileUrl: string | null = null;

  if (storagePath) {
    const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    fileUrl = signed?.signedUrl || null;
  }

  const purpose = cleanString(body.usageContent) || cleanString(body.merchant) || "영수증 지출";
  const amount = normalizeAmount(body.totalAmount) || 0;
  const usedAt = normalizeDate(body.purchasedAt) || new Date().toISOString().slice(0, 10);
  const subcategory = normalizeSubcategory(body.category);
  const usage = mapUsage(subcategory);
  const payment = normalizePayment(body.paymentMethod, body.cardLast4);
  const transfer = getTransferState(payment);

  const expensePayload = {
    used_at: usedAt,
    purpose,
    usage,
    payment_method: payment.expensePaymentMethod,
    category: mapLegacyExpenseCategory(subcategory),
    amount,
    evidence_status: storagePath ? "영수증 첨부" : "증빙 필요",
    transfer_status: transfer.status,
    transfer_summary: transfer.summary,
    project_id: null,
    requested_by: null,
    review_status: "검토 전",
    review_reason: payment.reviewReason,
    receipt_file_url: fileUrl,
    receipt_storage_path: storagePath,
    ocr_vendor_name: cleanString(body.merchant),
    ocr_total_amount: amount || null,
    ocr_transaction_date: usedAt,
    is_recurring: false,
    memo: buildMemo(body, usage, subcategory, payment)
  };

  const { data: expense, error: expenseError } = await insertWithColumnHealing(
    supabase,
    "expense_requests",
    expensePayload,
    "id"
  );

  if (expenseError) {
    return json({ error: expenseError.message }, 500);
  }

  const reviewPayload = {
    area: "지출결의",
    title: purpose,
    reason: "모바일 영수증 OCR 등록 확인",
    amount_or_impact: formatWon(amount),
    owner_label: deviceOwner,
    status: "검토 전",
    target_table: "expense_requests",
    target_id: expense?.id,
    checklist: "증빙 첨부 여부, 소분류, 결제수단, 개인카드 정산 여부, 금액, 사용 내용을 확인하세요."
  };

  const { error: reviewError } = await insertWithColumnHealing(supabase, "review_items", reviewPayload);

  if (reviewError) {
    return json({ error: reviewError.message }, 500);
  }

  return json({ id: expense?.id || null, status: "uploaded", deviceOwner, deviceId });
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
  "card_last4": "카드번호 뒷자리 4자리 또는 null",
  "purpose": "한 줄 요약",
  "raw_text": "읽은 주요 텍스트"
}
숫자는 쉼표 없이 숫자로만 반환하세요.
카드번호 전체가 보여도 마지막 4자리만 card_last4에 넣으세요.
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
    if (aiResponse.status === 401 || aiResponse.status === 403) {
      throw new Error("OpenAI API key is invalid or unauthorized.");
    }

    if (aiResponse.status === 400 || aiResponse.status === 413) {
      throw new Error("OpenAI OCR request failed because the image could not be processed.");
    }

    throw new Error(`OpenAI OCR request failed with status ${aiResponse.status}.`);
  }

  const result = await aiResponse.json();
  const content = result.choices?.[0]?.message?.content || "{}";
  return normalizeReceiptResult(JSON.parse(content));
}

function buildMemo(
  body: Record<string, unknown>,
  usage: string,
  subcategory: string,
  payment: ReturnType<typeof normalizePayment>
) {
  const lines = [
    `지출 대분류: ${usage}`,
    `지출 소분류: ${subcategory}`,
    `결제 방식: ${payment.label}`
  ];
  if (payment.cardLast4) {
    lines.push(`카드 뒷자리: ${payment.cardLast4}`);
  }
  if (payment.kind === "personal_card") {
    lines.push("개인 카드 월말 일괄 정산 대상");
  }
  const userMemo = cleanString(body.memo) || cleanString(body.usageContent);
  if (userMemo) {
    lines.push("", userMemo);
  }
  return lines.join("\n");
}

function normalizeSubcategory(category: unknown) {
  const value = cleanString(category);
  const legacyMap: Record<string, string> = {
    meals: "외부 미팅 식대",
    transport: "교통비",
    supplies: "소모품",
    lodging: "숙박비",
    general: "정기구독"
  };
  const allSubcategories = new Set(Object.values(EXPENSE_SUBCATEGORY_MAP).flat());
  if (!value) return "정기구독";
  return allSubcategories.has(value) ? value : legacyMap[value] || "정기구독";
}

function mapUsage(category: unknown) {
  const value = normalizeSubcategory(category);
  for (const [usage, subcategories] of Object.entries(EXPENSE_SUBCATEGORY_MAP)) {
    if (subcategories.includes(value)) {
      return usage;
    }
  }
  return "운영비";
}

function guessSubcategory(...values: Array<string | null>) {
  const text = values.filter(Boolean).join(" ");
  if (/식대|식사|음식|카페|커피|다과|베이커리|도시락/.test(text)) return "외부 미팅 식대";
  if (/택시|버스|지하철|KTX|SRT|교통|주차|통행/.test(text)) return "교통비";
  if (/호텔|숙박|모텔/.test(text)) return "숙박비";
  if (/문구|소모품|사무용품/.test(text)) return "사무용품";
  if (/구독|소프트웨어|서버|도메인|cloud|software/i.test(text)) return "정기구독";
  return "정기구독";
}

function normalizePayment(method: unknown, rawCardLast4: unknown) {
  const value = cleanString(method) || "corporate_card";
  const cardLast4 = normalizeCardLast4(rawCardLast4);
  const isCorporate = isCorporateCardLast4(cardLast4);
  const kind = isCorporate ? "corporate_card" : value;
  const map: Record<string, { label: string; expensePaymentMethod: string; reviewReason: string }> = {
    corporate_card: {
      label: "법인 카드",
      expensePaymentMethod: "카드",
      reviewReason: "모바일 영수증 OCR 등록 확인"
    },
    personal_card: {
      label: "개인 카드",
      expensePaymentMethod: "카드",
      reviewReason: "개인 카드 사용분 월말 정산 검토"
    },
    corporate_transfer: {
      label: "법인 계좌이체",
      expensePaymentMethod: "법인 계좌이체",
      reviewReason: "모바일 영수증 OCR 법인 계좌이체 등록 확인"
    },
    transfer_request: {
      label: "이체 요청",
      expensePaymentMethod: "계좌이체",
      reviewReason: "모바일 영수증 OCR 이체 요청 확인"
    }
  };
  return {
    kind,
    cardLast4,
    ...(map[kind] || map.corporate_card)
  };
}

function getTransferState(payment: ReturnType<typeof normalizePayment>) {
  if (payment.kind === "personal_card") {
    return {
      status: "결제 필요",
      summary: "개인 카드 사용분 월말 일괄 정산"
    };
  }
  if (payment.kind === "transfer_request") {
    return {
      status: "결제 필요",
      summary: "이체 요청"
    };
  }
  if (payment.kind === "corporate_transfer") {
    return {
      status: "결제 완료",
      summary: "법인 계좌이체"
    };
  }
  return {
    status: "해당 없음",
    summary: null
  };
}

const EXPENSE_SUBCATEGORY_MAP: Record<string, string[]> = {
  "여비·출장비": ["교통비", "유류비", "주차비", "택시비", "숙박비", "출장 식대", "출장 다과", "통행료", "기타 출장비"],
  "업무 추진비": ["외부 미팅 식대", "외부 미팅 다과", "거래처 선물", "회의비", "접대비", "기타 업무추진비"],
  "내부 사업비": ["교육 재료비", "행사 다과", "행사 식대", "인쇄·출력", "운반비", "촬영·편집", "작가·강사료", "기타 내부사업비"],
  "외부 사업비(외주용역)": ["외주 강사료", "외주 재료비", "외주 인쇄·출력", "외주 행사 다과", "외주 운반비", "외주 촬영·편집", "기타 외주용역비"],
  "복리후생비": ["직원 식대", "직원 간식", "회식비", "워크샵", "복지 소모품", "경조사", "기타 복리후생비"],
  "운영비": ["정기구독", "소모품", "사무용품", "서류 발급", "우편·택배", "통신비", "소프트웨어", "서버·도메인", "기타 운영비"],
  "차량비": ["차량 유류비", "차량 소모품", "정비비", "차량 주차비", "차량 통행료", "보험료", "기타 차량비"],
  "홍보비(광고비)": ["온라인 광고", "SNS 광고", "인쇄 홍보물", "촬영·콘텐츠", "홍보 대행", "기타 홍보비"],
  "자산취득비": ["비품 구입", "장비 구입", "가구", "전자기기", "소프트웨어 라이선스", "기타 자산취득"]
};

function legacyUsageMap(category: unknown) {
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

function mapLegacyExpenseCategory(category: unknown) {
  const usage = mapUsage(category) || legacyUsageMap(category);
  const map: Record<string, string> = {
    "여비·출장비": "여비교통비",
    "업무 추진비": "운영비",
    "내부 사업비": "내부 사업비",
    "외부 사업비(외주용역)": "외부 사업비",
    "복리후생비": "운영비",
    "운영비": "운영비",
    "차량비": "운영비",
    "홍보비(광고비)": "운영비",
    "자산취득비(비품 구입 등)": "운영비"
  };

  return map[usage] || "운영비";
}

function isCorporateCardLast4(cardLast4: string | null) {
  if (!cardLast4) return false;
  const configured = Deno.env.get("CORPORATE_CARD_LAST4S") || Deno.env.get("CORPORATE_CARD_LAST4") || "";
  const cards = configured.split(",").map((value) => normalizeCardLast4(value)).filter(Boolean);
  return cards.includes(cardLast4);
}

async function findDeviceOwner(supabase: ReturnType<typeof createClient>, deviceId: string | null) {
  if (!deviceId) return null;

  try {
    const { data, error } = await supabase
      .from("mobile_receipt_devices")
      .select("owner_name,is_active")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (error || !data || data.is_active === false) return null;
    return cleanString(data.owner_name);
  } catch {
    return null;
  }
}

async function rememberDevice(supabase: ReturnType<typeof createClient>, deviceId: string | null, ownerName: string | null) {
  if (!deviceId) return;

  try {
    const { data } = await supabase
      .from("mobile_receipt_devices")
      .select("device_id")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (data) return;

    await supabase.from("mobile_receipt_devices").insert({
      device_id: deviceId,
      owner_name: ownerName || "미등록 기기",
      is_active: true
    });
  } catch {
    // The finance DB may not have the optional management table yet.
  }
}

async function insertWithColumnHealing(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  payload: Record<string, unknown>,
  selectColumns?: string
) {
  let nextPayload = { ...payload };
  const removedColumns = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const query = supabase.from(tableName).insert(nextPayload);
    const result = selectColumns ? await query.select(selectColumns).single() : await query;

    if (!result.error) {
      return result;
    }

    const missingColumn = parseMissingColumn(result.error.message);
    if (!missingColumn || removedColumns.has(missingColumn) || !(missingColumn in nextPayload)) {
      return result;
    }

    removedColumns.add(missingColumn);
    const { [missingColumn]: _unused, ...rest } = nextPayload;
    nextPayload = rest;
  }

  return {
    data: null,
    error: new Error(`Failed to insert ${tableName} after removing incompatible columns.`)
  };
}

function parseMissingColumn(message: string) {
  const match = message.match(/'([^']+)' column/);
  return match?.[1] || null;
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
    card_last4: normalizeCardLast4(value.card_last4),
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

function normalizeCardLast4(value: unknown) {
  const text = cleanString(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
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
