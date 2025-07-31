// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  try {
    let body;
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      body = Object.fromEntries(new URLSearchParams(text));
    }

    console.log('=== Mailchimp Webhook Received ===');
    console.log('Headers:', req.headers);
    console.log('Parsed Body:', body);

    const type = (body.type || body.event || '').toLowerCase();
    const data = body.data || {};

    if (type.includes('subscribe')) {
      const email = data.email || data.email_address || '';
      const listId = data.list_id || data.id || '';

      console.log('✅ New subscription detected', { email, listId });

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

    res.status(200).json({
      status: 'received',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({
      error: 'internal error',
      message: error?.message || 'unknown'
    });
  }
}

// 以下 sendToGA4 & generateClientId 跟之前一樣
async function sendToGA4({ email, listId, timestamp }) {
  const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
  const GA4_API_SECRET = process.env.GA4_API_SECRET;

  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    console.warn('⚠️ Missing GA4 env vars');
    return false;
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
  const clientId = generateClientId(email);
  const payload = {
    client_id: clientId,
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

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('GA4 response status:', resp.status);
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('GA4 API error:', resp.status, txt);
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
