// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  console.log('🔥 webhook invoked', { method: req.method, url: req.url, headers: req.headers });

  if (req.method === 'GET') {
    console.log('➡ GET ping');
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    console.log('⚠️ wrong method', req.method);
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  console.log('➡ Handling POST, about to immediately respond 200');
  res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });

  try {
    // 最早的 subscribe 判斷前 log
    console.log('📦 begin parsing body');

    let body = {};
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    console.log('📌 content-type:', contentType);

    if (contentType.includes('application/json')) {
      body = req.body;
      console.log('📥 parsed as JSON', body);
    } else {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', err => reject(err));
      });
      console.log('📥 raw body string:', raw);
      const params = new URLSearchParams(raw);
      body = expandNested(params);
      console.log('📥 expanded form body:', body);
    }

    const type = (body.type || '').toString().toLowerCase();
    const data = body.data || {};
    console.log('🔍 event type:', type, 'data:', data);

    if (type.includes('subscribe')) {
      const email = data.email || data.email_address || '';
      const listId = body.list_id || data.list_id || '';
      console.log('✅ New subscription detected', { email, listId });
      // 這裡暫時不呼叫 GA4，先確認這段有跑到
      // await sendToGA4({ email, listId, timestamp: new Date().toISOString() });
    } else {
      console.log('ℹ️ Non-subscribe event:', type);
    }
  } catch (e) {
    console.error('❌ 解析/處理錯誤', e);
  }
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
