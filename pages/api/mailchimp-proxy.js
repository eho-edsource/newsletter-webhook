// pages/api/mailchimp-proxy.js

// 這支只是把 form-urlencoded 轉成 JSON 丟給主 handler
async function getRawBody(req, timeoutMs = 2000) {
  return await Promise.race([
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    }),
    new Promise(resolve => setTimeout(() => resolve('[body timeout expired]'), timeoutMs))
  ]);
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

export default async function handler(req, res) {
  console.log('🔥 proxy invoked', { method: req.method, url: req.url });

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  // 讀 form-urlencoded 原始 body
  let parsed = {};
  try {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    console.log('[proxy] content-type:', contentType);

    const raw = await getRawBody(req);
    console.log('[proxy] raw body:', raw);

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(raw);
      parsed = expandNested(params);
      console.log('[proxy] expanded:', parsed);
    } else if (contentType.includes('application/json')) {
      // 萬一直接打 JSON 也可以傳過去
      parsed = req.body || {};
      console.log('[proxy] got JSON directly:', parsed);
    } else {
      console.warn('[proxy] unexpected content-type, forwarding empty');
    }
  } catch (err) {
    console.warn('[proxy] parse error', err);
  }

  // Forward 給原本的 JSON handler
  try {
    const targetUrl = process.env.MAILCHIMP_WEBHOOK_URL || 'https://newsletter-webhook-3ogm.vercel.app/api/mailchimp-webhook';
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });

    console.log('[proxy] forwarded to main handler, status:', resp.status);
  } catch (e) {
    console.error('[proxy] forward error', e);
  }

  // 給 Mailchimp 200
  res.status(200).json({ proxied: true, timestamp: new Date().toISOString() });
}
