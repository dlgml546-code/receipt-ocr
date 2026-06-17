# Receipt OCR PWA

Phone-installable receipt capture app for uploading OCR results into the LUPL finance dashboard expense approval flow.

## What It Does

- Captures or selects receipt images from a phone
- Supports selecting multiple receipt images from the photo album
- Normalizes receipt images before OCR and auto-rotates landscape images to portrait
- Sends images through Vercel serverless API routes, so Supabase keys are never shown in the browser
- Lets the user review OCR fields and add required usage content
- Uploads confirmed receipt data to Supabase Edge Function `receipts`
- Queues failed uploads locally and retries later
- Keeps recent upload history on the device

## User Flow

Employees do not enter API URLs or keys.

1. Open the PWA
2. Capture or select a receipt
3. Wait for OCR analysis
4. Enter usage content
5. Upload

The app sends a stable local `deviceId` with every upload. The finance dashboard can later map that device ID to an employee.

## Vercel Environment Variables

Set these in the Vercel project `receipt-ocr`.

```text
RECEIPT_API_BASE=https://PROJECT_REF.supabase.co/functions/v1
RECEIPT_API_KEY=the same value as Supabase MOBILE_RECEIPT_API_KEY
```

For the current finance Supabase project:

```text
RECEIPT_API_BASE=https://iocdligckxakvvbjldkz.supabase.co/functions/v1
```

After setting or changing Vercel environment variables, redeploy the `receipt-ocr` project.

## Supabase Setup

Deploy the `receipts` Edge Function from this repository:

```powershell
cd C:\Users\LUPL-2\Documents\Codex\2026-06-17\ocr\receipt-ocr-pwa
npx.cmd supabase functions deploy receipts --project-ref iocdligckxakvvbjldkz
```

Register required Supabase secrets:

```powershell
npx.cmd supabase secrets set MOBILE_RECEIPT_API_KEY="your-long-random-key" --project-ref iocdligckxakvvbjldkz
npx.cmd supabase secrets set OPENAI_API_KEY="sk-..." --project-ref iocdligckxakvvbjldkz
```

Do not put `MOBILE_RECEIPT_API_KEY`, `OPENAI_API_KEY`, or service role keys in browser code.

## Local Development

The static page can be served locally:

```powershell
python -m http.server 4173
```

Local OCR/upload calls require compatible `/api/receipts` serverless routes, so full integration testing should happen on Vercel or with a Vercel-compatible local dev setup.
