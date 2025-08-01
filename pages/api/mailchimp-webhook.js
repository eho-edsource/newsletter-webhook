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

function getMerge(body, field) {
  return body[`data[merges][${field}]`] || "";
}

function extractGroupings(body) {
  const group = body["data[merges][GROUPINGS][0][groups]"];
  return typeof group === "string" ? group : "";
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
    console.log("incoming body:", JSON.stringify(body));

    if (body?.type !== "subscribe") return res.status(200).send("ignored event");

    const email = extractMailchimpEmail(body);
    if (!email) return res.status(400).send("missing email");
    const emailKey = email.trim().toLowerCase(); // for dedup
    const list_id = extractListId(body);

    // 去重（30 秒內同一 email 不重送）
    const recent = global.__recent_subscribes__ || (global.__recent_subscribes__ = new Map());
    const now = Date.now();
    if (recent.has(emailKey) && now - recent.get(emailKey) < 30000) {
      return res.status(200).send("deduped");
    }
    recent.set(emailKey, now);

    // 組 GA4 payload
    const payload = {
      client_id: `${Math.floor(Math.random() * 1e9)}.${Math.floor(Math.random() * 1e9)}`,
      events: [
        {
          name: "newsletter_subscribe",
          params: {
            source: "mailchimp",
            email: email,  // ✅ 用原始 email
            list_id: list_id,
            job_title: getMerge(body, "JOBTITLE"),
            interest_topic: getMerge(body, "INTERESTS"),
            segment_group: extractGroupings(body),
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
