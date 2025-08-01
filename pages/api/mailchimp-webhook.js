// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  console.log('🔥 webhook invoked', { method: req.method, url: req.url });

  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed', requestId });
  }

  // 1. 解析 body（加個上限避免卡太久）
  let body = {};
  try {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    console.log('[handler]', requestId, 'content-type:', contentType);

    const parseBody = async () => {
      if (contentType.includes('application/json')) {
        console.log('[handler]', requestId, 'parsed as JSON');
        return req.body;
      } else {
        const raw = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => (data += chunk));
          req.on('end', () => resolve(data));
          req.on('error', err => reject(err));
        });
        console.log('[handler]', requestId, 'raw body string:', raw);
        const params = new URLSearchParams(raw);
        const expanded = expandNested(params);
        console.log('[handler]', requestId, 'expanded form body:', expanded);
        return expanded;
      }
    };

    // 2秒上限
    body = await Promise.race([
      parseBody(),
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000))
    ]);
  } catch (err) {
    console.warn('[handler]', requestId, 'body parse failed or timed out', err);
    body = {}; // fallback
  }

  const type = (body.type || '').toString().toLowerCase();
  const data = body.data || {};
  console.log('[handler]', requestId, 'event type:', type, 'data snapshot:', data);

  if (type.includes('subscribe')) {
    const email = (data.email || data.email_address || '').toString();
    const listId = (body.list_id || data.list_id || '').toString();
    console.log('[handler]', requestId, '✅ New subscription detected', { email, listId });

    // 立刻回 200 給 webhook sender（non-blocking）
    res.status(200).json({ status: 'received', requestId, timestamp: new Date().toISOString() });

    // fire-and-forget GA4 call
    const eventId = generateEventId(email, listId);
    setImmediate(() => {
      sendToGA4({
        email,
        listId,
        timestamp: new Date().toISOString(),
        eventId
      })
        .then(success => console.log('[handler]', requestId, 'GA4 tracking result:', success ? 'Success' : 'Failed'))
        .catch(e => console.warn('[handler]', requestId, 'sendToGA4 unexpected error', e));
    });
    return;
  }

  // 非 subscribe 也回 200，但標記 ignored
  res.status(200).json({ status: 'ignored', requestId });
}

function expandNested(params) {
  const obj = {};
  for (const [rawKey, value] of params.entries()) {
    const path = rawKey.replace(/\]/g, '').split('[');
    let curr = obj;
    for (let i = 0; i < path.length; i++) {
      const key = path[i];
      if (i === path.length - 1) {
        curr[key] = tryParseJSON(value) ?? value;
      } else {
        if (!curr[key]) curr[key] = {};
        curr = curr[key];
      }
    }
  }
  return obj;
}
function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function sendToGA4({ email, listId, timestamp, eventId }) {
  const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
  const GA4_API_SECRET = process.env.GA4_API_SECRET;

  console.log('[sendToGA4] Env vars present:', {
    GA4_MEASUREMENT_ID: !!GA4_MEASUREMENT_ID,
    GA4_API_SECRET: !!GA4_API_SECRET
  });

  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    console.warn('[sendToGA4] Missing GA4 credentials');
    return false;
  }

  const clientId = generateClientId(email);
  const payload = {
    client_id: clientId,
    events: [
      {
        name: 'mailchimp_newsletter_signup',
        event_id: eventId,
        params: {
          source: 'mailchimp',
          method: 'webhook',
          email_hash: clientId,
          list_id: listId,
          timestamp
        }
      }
    ]
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
  const bodyStr = JSON.stringify(payload);

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const backoff = 500 * attempt;
      console.log(`[sendToGA4] Retry attempt ${attempt}, waiting ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }

    try {
      const controller = new AbortController();
      const timeoutMs = 5000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      console.log('[sendToGA4] Sending payload attempt', attempt, payload);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timer);

      console.log('[sendToGA4] GA4 response status:', resp.status);
      const respText = await resp.text();
      console.log('[sendToGA4] GA4 response body:', respText);

      if (resp.ok || resp.status === 204) {
        return true;
      }
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        console.error('[sendToGA4] Non-retryable error', resp.status);
        break;
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[sendToGA4] Request timed out');
      } else {
        console.warn('[sendToGA4] Error sending to GA4:', e);
      }
    }
  }

  return false;
}

function generateClientId(email) {
  if (!email) return `unknown_${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const chr = email.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return 'mc_' + Math.abs(hash);
}

function generateEventId(email, listId) {
  const base = `${email || 'unknown'}:${listId || 'unknown'}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const chr = base.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return 'mc_evt_' + Math.abs(hash);
}
