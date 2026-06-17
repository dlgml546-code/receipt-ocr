# API Contract

Set the app API base URL to the management dashboard API root, for example:

```text
https://PROJECT_REF.supabase.co/functions/v1
```

Every request should include:

```http
x-receipt-api-key: <MOBILE_RECEIPT_API_KEY>
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
- `deviceOwner`: admin-registered phone owner
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

When using Supabase Edge Functions, deploy a function named `receipts` and set the app API base to:

```text
https://PROJECT_REF.supabase.co/functions/v1
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
  "deviceOwner": "Hong Gil Dong",
  "submittedBy": "Hong Gil Dong",
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
