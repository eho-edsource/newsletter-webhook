// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  // 先快速回 200 避免超時
  res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });

  try {
    let body = {};
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      body = req.body;
    } else {
      // 解析 form-urlencoded raw body
      const text = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', err => reject(err));
      });

      // 轉成 key/value，再把 nested data[...] 展開成物件
      const params = new URLSearchParams(text);
      body = expandNested(params);
    }

    console.log('=== Mailchimp Webhook Received ===');
    console.log('Parsed Body:', JSON.stringify(body));

    const type = (body.type || '').toString().toLowerCase();
    const data = body.data || {};

    if (type.includes('subscribe')) {
      const email = data.email || data.email_address || '';
      const listId = body.list_id || data.list_id || '';
      console.log('✅ New subscription detected', { email, listId });

      // fire-and-forget 推到 GA4
      sendToGA4({
        email,
        listId,
        timestamp: new Date().toISOString()
      }).then(success => {
        console.log('GA4 tracking result:', success ? 'Success' : 'Failed');
      });
    } else {
      console.log('ℹ️ Received non-subscribe event:', type);
    }
  } catch (e) {
    console.error('非同步處理錯誤', e);
  }
}

/**
 * 將 form-urlencoded 裡像 data[merges][EMAIL]=... 的 nested key 展開成巢狀物件
 */
function expandNested(params) {
  const obj = {};

  for (const [rawKey, value] of params.entries()) {
    // 例如 rawKey: data[merges][EMAIL]
    const path = rawKey
      .replace(/\]/g, '')
      .split('['); // ["data", "merges", "EMAIL"]
    let curr = obj;
    for (let i = 0; i < path.length; i++) {
      const key = path[i];
      if (i === path.length - 1) {
        // 最後一層賦值
        curr[key] = parsePotentialJSON(value) || value;
      } else {
        if (!curr[key]) curr[key] = {};
        curr = curr[key];
      }
    }
  }

  return obj;
}

// 嘗試 parse JSON 字串（某些欄位可能是 JSON encoded）
function parsePotentialJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// sendToGA4 & generateClientId 保留你原本的邏輯（略過這段同前面）
async function sendToGA4({ email, listId, timestamp }) {
  const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
  const GA4_API_SECRET = process.env.GA4_API_SECRET;

  console.log('🔍 Env vars present:', {
    GA4_MEASUREMENT_ID: !!GA4_MEASUREMENT_ID,
    GA4_API_SECRET: !!GA4_API_SECRET
  });

  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    console.warn('⚠️ Missing GA4 env vars, aborting send');
    return false;
  }

  const clientId = generateClientId(email);
  const payload = {
    client_id: clientId,
    // debug_mode: true, // 測試時打開
    events: [
      {
        name: 'mailchimp_newsletter_signup',
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

  console.log('📤 Sending to GA4 payload:', JSON.stringify(payload));

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('GA4 response status:', resp.status);
    const respText = await resp.text();
    console.log('GA4 response body:', respText);
    if (!resp.ok) {
      console.error('GA4 API error:', resp.status, respText);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error sending to GA4:', e);
    return false;
  }
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
