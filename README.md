# 📬 Mailchimp to GA4 Webhook

This project enables automatic tracking of newsletter subscriptions from **Mailchimp** directly into **Google Analytics 4 (GA4)** via **Measurement Protocol v2**.

When a new contact subscribes to a Mailchimp list, a webhook sends the payload to a Vercel-hosted endpoint, which formats the data and pushes it as a custom event (`newsletter_subscribe`) to GA4.

---

## 🔧 Tech Stack

- **Mailchimp Webhooks** (Event source)
- **Vercel** (Serverless function hosting)
- **Node.js (API handler in `/api/mailchimp-webhook`)**
- **GA4 Measurement Protocol v2** (Event ingestion)

---

## 🚀 How It Works

1. **Subscription Event**  
   A user subscribes to your Mailchimp audience.

2. **Webhook Fires**  
   Mailchimp sends a POST request with the user’s data to your webhook endpoint on Vercel.

3. **Serverless Function Handles Event**  
   The handler extracts relevant fields (email, job title, interests, etc.), deduplicates recent events, and sends a custom GA4 event.

4. **GA4 Receives `newsletter_subscribe`**  
   The event appears in Realtime reports instantly, and in standard GA4 reports within 24–48 hours.

---

## 📌 Webhook Endpoint(Vercel)

- https://newsletter-webhook-3ogm.vercel.app/api/mailchimp-webhook
### Vercel Project
To view logs, redeploy, or edit env vars:
1. Go to [vercel.com](https://vercel.com/)
2. Log in with ""
3. Navigate to `newsletter-webhook` project

**Parameters:**

| Param          | Description                     |
|----------------|---------------------------------|
| `email`        | User's email (plaintext)        |
| `job_title`    | From Mailchimp merge field      |
| `company`      | From Mailchimp merge field      |
| `interests`    | Newsletter topics selected      |
| `list_id`      | Mailchimp list ID               |
| `debug_mode`   | Set to `true` in dev mode       |

---

## 📁 Project Structure
```newsletter-webhook/
├── pages/
│   └── api/
│       └── mailchimp-webhook.js   # Webhook endpoint for Mailchimp (deployed via Vercel Serverless Function)
├── package.json                   # Project metadata and dependencies
└── README.md                      # Project documentation (you’re reading it!)
```

---

## 🛠 Environment Variables

In Vercel project settings:

- `GA4_MEASUREMENT_ID= G-475QR6J62K`
- `GA4_API_SECRET=9CPNecTzQVOHEhJCHky6tA`

---

## 🧪 Testing (Optional with curl)

```bash
curl -X POST https://newsletter-webhook-3ogm.vercel.app/api/mailchimp-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "subscribe",
    "data[email]": "test@example.com",
    "data[merges][JOBTITLE]": "Engineer",
    "data[merges][COMPANY]": "Test Inc",
    "data[merges][INTERESTS]": "EdSource daily newsletter",
    "data[list_id]": "a54dc0b8a6"
  }'

