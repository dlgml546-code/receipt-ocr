# Receipt OCR PWA

Phone-installable receipt capture app for uploading OCR results into a business management dashboard expense approval flow.

## What it does

- Captures or selects a receipt image from a phone
- Supports selecting multiple receipt images from the photo album
- Normalizes receipt images before OCR and auto-rotates landscape images to portrait
- Sends the image to a dashboard OCR endpoint
- Lets the user quickly review extracted fields
- Requires a usage description before upload
- Uploads the confirmed receipt data to the dashboard
- Queues failed uploads locally and retries later
- Installs as a PWA on mobile browsers

## Run locally

This is a static app.

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

For phone testing on the same network, serve it from the machine LAN address and use HTTPS in production.

## API settings

Open the app and set the dashboard API base URL, for example:

```text
https://PROJECT_REF.supabase.co/functions/v1
```

The app currently calls the dashboard API contract below. The dashboard backend must implement these endpoints for real expense approval integration:

- `POST /receipts/ocr` with `multipart/form-data`
- `POST /receipts` with JSON

See [docs/api-contract.md](docs/api-contract.md) for the expected payloads.

## Expense approval integration

This app is the phone capture client. It becomes connected to the management dashboard when the dashboard exposes the API endpoints in `docs/api-contract.md`.

The upload payload includes:

- `workflow: "expense_approval"`
- OCR fields such as merchant, date, total amount, tax, category, and raw text
- `usageContent`, which is required before upload
- `batchIndex` and `batchTotal` when multiple receipts are selected

## Supabase setup

In the dashboard repository, deploy the `receipts` Edge Function:

```powershell
supabase functions deploy receipts
supabase secrets set MOBILE_RECEIPT_API_KEY=긴_랜덤_연동키
```

The phone app settings should use:

```text
API: https://PROJECT_REF.supabase.co/functions/v1
연동 키: the same MOBILE_RECEIPT_API_KEY
```

## Deployment

Deploy the folder contents to any static hosting service. PWA installation and camera capture work best on HTTPS.
