# API Contract

The browser app calls same-origin Vercel API routes:

```text
/api/receipts/ocr
/api/receipts
```

The Vercel API routes forward requests to Supabase Edge Functions using server-side environment variables:

```text
RECEIPT_API_BASE=https://PROJECT_REF.supabase.co/functions/v1
RECEIPT_API_KEY=<MOBILE_RECEIPT_API_KEY>
```

## OCR endpoint

```http
POST /receipts/ocr
Content-Type: multipart/form-data
```

Fields:

- `receipt`: image file
- `source`: `receipt-ocr-pwa`
- `workflow`: `expense_approval`
- `deviceId`: stable local device identifier
- `capturedAt`: ISO timestamp

Example response:

```json
{
  "receipt": {
    "merchant": "Coffee Shop",
    "purchasedAt": "2026-06-17",
    "totalAmount": 12800,
    "taxAmount": 1164,
    "currency": "KRW",
    "category": "meals",
    "rawText": "..."
  },
  "attachmentId": "att_123"
}
```

The app also accepts the fields at the top level if `receipt` is omitted.

## Upload endpoint

This endpoint should create or attach a receipt to the dashboard expense approval flow.

When using Supabase Edge Functions, deploy a function named `receipts`.

```text
https://PROJECT_REF.supabase.co/functions/v1
```

Deployment from this repository:

```powershell
supabase functions deploy receipts --project-ref PROJECT_REF
supabase secrets set MOBILE_RECEIPT_API_KEY=긴_랜덤_키 --project-ref PROJECT_REF
```

```http
POST /receipts
Content-Type: application/json
```

Example request:

```json
{
  "merchant": "Coffee Shop",
  "purchasedAt": "2026-06-17",
  "totalAmount": 12800,
  "taxAmount": 1164,
  "currency": "KRW",
  "category": "meals",
  "usageContent": "Client meeting refreshments",
  "rawText": "...",
  "attachmentId": "att_123",
  "source": "receipt-ocr-pwa",
  "workflow": "expense_approval",
  "deviceId": "device-uuid",
  "batchIndex": 1,
  "batchTotal": 3,
  "capturedAt": "2026-06-17T02:00:00.000Z",
  "status": "confirmed"
}
```

Recommended response:

```json
{
  "id": "rcpt_123",
  "status": "uploaded"
}
```
