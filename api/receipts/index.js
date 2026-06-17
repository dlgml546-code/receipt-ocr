module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiBase = normalizeApiBase(process.env.RECEIPT_API_BASE);
  const apiKey = process.env.RECEIPT_API_KEY;

  if (!apiBase || !apiKey) {
    res.status(500).json({ error: "Receipt upload server is not configured" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch(`${apiBase}/receipts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-receipt-api-key": apiKey
      },
      body
    });

    await forwardResponse(upstream, res);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
};

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function forwardResponse(upstream, res) {
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
}
