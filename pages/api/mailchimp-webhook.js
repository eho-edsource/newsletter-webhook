// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  // 先快速回 200 不阻塞 Mailchimp（避免超時）
  res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });

  // non-blocking 處理（錯誤也不會影響已回的 response）
  try {
    // 解析 body（Next.js pages route：JSON 已在 req.body）
    let body = {};
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      body = req.body;
    } else {
      const text = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', err => reject(err));
      });
      body = Object.fromEntries(new URLSearchParams(text));
    }

    console.log('=== Mailchimp Webhook Received ===');
    console.log('Headers:', req.headers);
    console.log('Parsed Body:', body);

    const type = (body.type || body.event || '').toString().toLowerCase();
    const data = body.data || {};

    if (type.includes('subscribe')) {
      const email = data.email || data.email_address || '';
      const listId = data.list_id || data.id || '';
      console.log('✅ New subscription detected', { email, listId });

      // 推到 GA4（fire-and-forget）
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

// 下面保持你之前的 sendToGA4 和 generateClientId（含 debug_mode 可選）
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
    // debug_mode: true, // 測試時可開，正式可以註解掉
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

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`;

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
