// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed', requestId });
  }

  // 驗證 token（如果有設定的話）
  const expectedToken = process.env.WEBHOOK_TOKEN;
  if (expectedToken) {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (token !== expectedToken) {
      console.warn('[handler]', requestId, 'Invalid token', { provided: token });
      return res.status(403).json({ error: 'Forbidden', requestId });
    }
  }

  // 先回 200 不阻塞主流程
  res.status(200).json({ status: 'received', timestamp: new Date().toISOString(), requestId });

  try {
    // 解析 body（支援 JSON 與 Mailchimp 那種 nested form-urlencoded）
    let body = {};
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
      body = req.body;
    } else {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', err => reject(err));
      });
      const params = new URLSearchParams(raw);
      body = expandNested(params);
    }

    console.log('[handler]', requestId, 'Parsed Body:', JSON.stringify(body));

    const type = (body.type || '').toString().toLowerCase();
    const data = body.data || {};
    const listId = body.list_id || data.list_id || '';
    const email = (data.email || data.email_address || '').toString();

    if (type.includes('subscribe')) {
      const eventId = generateEventId(email, listId);
      console.log('[handler]', requestId, '✅ New subscription', { email, listId, eventId });

      // extract key merge fields
      const merges = data.merges || {};
      const fname = merges.FNAME || '';
      const lname = merges.LNAME || '';
      const company = merges.COMPANY || '';
      const jobtitle = merges.JOBTITLE || '';
      const interestsText = merges.INTERESTS || '';
      const groupingsArr = (merges.GROUPINGS && Array.isArray(merges.GROUPINGS)) ? merges.GROUPINGS : [];
      const newsletters = groupingsArr.find(g => g.name === 'Newsletters')?.groups || '';
      const legacy = groupingsArr.find(g => g.name === 'Legacy segments')?.groups || '';

      const ga4Result = await sendToGA4({
        email,
        listId,
        timestamp: new Date().toISOString(),
        eventId,
        extraParams: {
          merge_fname: fname,
          merge_lname: lname,
          merge_company: company,
          merge_jobtitle: jobtitle,
          interests_text: interestsText,
          groupings_newsletters: newsletters,
          groupings_legacy_segments: legacy,
          email_type: data.email_type || '',
          web_id: data.web_id || ''
        }
      });

      console.log('[handler]', requestId, 'GA4 tracking result:', ga4Result ? 'Success' : 'Failed');
    } else {
      console.log('[handler]', requestId, 'ℹ️ Non-subscribe event:', type);
    }
  } catch (err) {
    console.error('[handler]', requestId, 'Processing error:', err);
  }
}

/** 展開 nested form-urlencoded keys like data[merges][EMAIL] into object */
function expandNested(params) {
  const obj = {};
  for (const [rawKey, value] of params.entries()) {
    const path = rawKey.replace(/\]/g, '').split('['); // e.g. ["data","merges","EMAIL"]
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

async function sendToGA4({ email, listId, timestamp, eventId, extraParams = {} }) {
  const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
  const GA4_API_SECRET = process.env.GA4_API_SECRET;
  const debugMode = process.env.GA4_DEBUG === 'true';

  console.log('[sendToGA4] Env vars:', {
    GA4_MEASUREMENT_ID: !!GA4_MEASUREMENT_ID,
    GA4_API_SECRET: !!GA4_API_SECRET,
    debug_mode: debugMode
  });

  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    console.warn('[sendToGA4] Missing GA4 credentials');
    return false;
  }

  const clientId = generateClientId(email);
  const baseParams = {
    source: 'mailchimp',
    method: 'webhook',
    email_hash: clientId,
    list_id: listId,
    timestamp,
    ...extraParams
  };

  const payload = {
    client_id: clientId,
    ...(debugMode ? { debug_mode: true } : {}),
    events: [
      {
        name: 'mailchimp_newsletter_signup',
        event_id: eventId,
        params: baseParams
      }
    ]
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
  const bodyStr = JSON.stringify(payload);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      const jitter = Math.random() * 200;
      const wait = backoff + jitter;
      console.log(`[sendToGA4] Retry ${attempt}, waiting ${Math.round(wait)}ms`);
      await new Promise(r => setTimeout(r, wait));
    }

    const controller = new AbortController();
    const timeoutMs = 5000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    console.log('[sendToGA4] Sending payload attempt', attempt, payload);
    try {
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
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        console.warn('[sendToGA4] Request timed out');
      } else {
        console.warn('[sendToGA4] Error sending to GA4:', err);
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
