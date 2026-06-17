# API Contract

Set the app API base URL to the dashboard API root, for example:

```text
https://dashboard.example.com/api
```

## OCR endpoint

```http
POST /receipts/ocr
Content-Type: multipart/form-data
```

Fields:

- `receipt`: image file
- `source`: `receipt-ocr-pwa`
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
  "rawText": "...",
  "attachmentId": "att_123",
  "source": "receipt-ocr-pwa",
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

