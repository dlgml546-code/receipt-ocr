# Receipt OCR PWA

Phone-installable receipt capture app for uploading OCR results into a business management dashboard.

## What it does

- Captures or selects a receipt image from a phone
- Sends the image to a dashboard OCR endpoint
- Lets the user quickly review extracted fields
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
https://dashboard.example.com/api
```

The app calls:

- `POST /receipts/ocr` with `multipart/form-data`
- `POST /receipts` with JSON

See [docs/api-contract.md](docs/api-contract.md) for the expected payloads.

## Deployment

Deploy the folder contents to any static hosting service. PWA installation and camera capture work best on HTTPS.

