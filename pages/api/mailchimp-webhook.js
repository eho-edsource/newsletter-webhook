// pages/api/mailchimp-webhook.js

export const config = {
  api: {
    bodyParser: true, // 让 Next.js 解析 JSON body
  },
};

export default async function handler(req, res) {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  console.log('🔥🔥 webhook invoked', { method: req.method, url: req.url, requestId });

  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed', requestId });
  }

  let body = {};
  try {
    body = req.body || {};
    console.log('[handler]', requestId, 'parsed JSON body:', body);
  } catch (e) {
    console.warn('[handler]', requestId, 'failed to parse JSON body', e);
    body = {};
  }

  const type = (body.type || '').toString().toLowerCase();
  const data = body.data || {};
  const listId = (body.list_id || data.list_id || '').toString();
  const email = (data.email || data.email_address || '').toString();

  console.log('[handler]', requestId, 'event type:', type, 'email:', email, 'listId:', listId);

  if (type.includes('subscribe')) {
    console.log('[handler]', requestId, '✅ New subscription detected', { email, listId });
    // 先回 200
    res.status(200).json({ status: 'received', requestId, timestamp: new Date().toISOString() });

    // fire-and-forget GA4
    const eventId = generateEventId(email, listId);
    setImmediate(() => {
      sendToGA4({
        email,
        listId,
        timestamp: new Date().toISOString(),
        eventId
      })
        .then(success => console.log('[handler]', requestId, 'GA4 tracking result:', success ? 'Success' : 'Failed'))
        .catch(err => console.warn('[handler]', requestId, 'sendToGA4 error', err));
    });
    return;
  }

  res.status(200).json({ status: 'ignored', requestId });
}

/* 保留你的 GA4 发送逻辑和 helper（粘过来不变） */
function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function sendToGA4({ email, listId, timestamp, eventId }) {
  const GA4_MEASUREMENT_ID = 'G-475QR6J62K'; // 你的 GA4 Measurement ID 
  const GA4_API_SECRET = '9CPNecTzQVOHEhJCHky6tA'; // 你的 API Secret

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
        name: 'mchimp_newsletter_signup',
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

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      const backoff = 500 * attempt;
      console.log(`[sendToGA4] Retry ${attempt}, waiting ${backoff}ms`);
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

      if (resp.ok || resp.status === 204) return true;
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        console.error('[sendToGA4] Non-retryable error', resp.status);
        break;
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[sendToGA4] Timeout');
      } else {
        console.warn('[sendToGA4] Error', e);
      }
    }
  }
  return false;
}

function generateClientId(email) {
  if (!email) return `unknown_${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  return 'mc_' + Math.abs(hash);
}

function generateEventId(email, listId) {
  const base = `${email || 'unknown'}:${listId || 'unknown'}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }
  return 'mc_evt_' + Math.abs(hash);
}
