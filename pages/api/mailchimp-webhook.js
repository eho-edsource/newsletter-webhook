import crypto from "crypto";
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Only POST allowed");
  }

  const expectedToken = process.env.WEBHOOK_SECRET || "";
  const receivedToken = req.query.token || "";
  if (expectedToken && receivedToken !== expectedToken) {
    return res.status(403).send("invalid token");
  }

  try {
    const body = req.body;
    if (body.type !== "subscribe") {
      return res.status(200).send("ignored event");
    }

    const email = body?.data?.email;
    if (!email) return res.status(400).send("missing email");

    const emailHash = crypto
      .createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex");

    const clientId = `${Math.floor(Math.random() * 1e9)}.${Math.floor(
      Math.random() * 1e9
    )}`;

    const payload = {
      client_id: clientId,
      user_id: emailHash,
      events: [
        {
          name: "newsletter_subscribe",
          params: {
            source: "mailchimp",
            email_hash: emailHash,
            list_id: body?.data?.list_id || "",
          },
        },
      ],
    };

    const measurementId = process.env.GA4_MEASUREMENT_ID;
    const apiSecret = process.env.GA4_API_SECRET;

    if (!measurementId || !apiSecret) {
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
