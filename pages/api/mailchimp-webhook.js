import crypto from "crypto";

function extractMailchimpEmail(body) {
  return (
    body?.data?.email ||
    body["data[email]"] ||
    body["data[merges][EMAIL]"] ||
    null
  );
}

function extractListId(body) {
  return body?.data?.list_id || body["data[list_id]"] || "";
}

function extractMailchimpId(body) {
  return body?.data?.id || body["data[id]"] || "";
}

function extractMergeValue(body, key) {
  return (
    body?.data?.merges?.[key] ||
    body[`data[merges][${key}]`] || 
    ""
  );
}


export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("ok");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }

  if (req.method !== "POST") return res.status(405).send("Only POST allowed");

  try {
    const body = req.body;
    const rawId = extractMailchimpId(body);
    console.log(`📩 incoming ID: ${rawId}`);
    console.log("📦 incoming body:", JSON.stringify(body));

    if (body?.type !== "subscribe") {
      return res.status(200).send("ignored event");
    }

    const email = extractMailchimpEmail(body);
    if (!email) return res.status(400).send("missing email");

    const list_id = extractListId(body);
    const mailchimp_id = extractMailchimpId(body);

    const emailHash = crypto
      .createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex");

    const clientId = `${Math.floor(Math.random() * 1e9)}.${Math.floor(Math.random() * 1e9)}`;

    const recent = global.__recent_subscribes__ || (global.__recent_subscribes__ = new Map());
    const now = Date.now();
    if (recent.has(emailHash) && now - recent.get(emailHash) < 30000) {
      return res.status(200).send("deduped");
    }
    recent.set(emailHash, now);

    const payload = {
      client_id: clientId,
      user_id: emailHash,
      events: [
        {
          name: "newsletter_subscribe",
          params: {
            source: "mailchimp",
            email_hash: emailHash,
            list_id: list_id,
            id: mailchimp_id, // ✅ 顯示在 GA4 的 params.id
            email: email, // ✅ 明文 email，僅供測試用，若日後要上 production 建議移除或 hash
            company: extractMergeValue(body, "COMPANY"),
            job_title: extractMergeValue(body, "JOBTITLE"),
            interests: extractMergeValue(body, "INTERESTS"),
          },
        },
      ],
    };

    const measurementId = process.env.GA4_MEASUREMENT_ID;
    const apiSecret = process.env.GA4_API_SECRET;

    if (!measurementId || !apiSecret) {
      console.error("Missing GA4 config");
      return res.status(500).send("GA4 config missing");
    }

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("GA4 error:", resp.status, text);
      return res.status(502).send("GA4 failed");
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("handler error:", err);
    return res.status(500).send("internal error");
  }
}
