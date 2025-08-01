// pages/api/mailchimp-webhook.js
export default async function handler(req, res) {
  console.log('🔥 minimal body-debug webhook invoked', { method: req.method, url: req.url });

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST allowed' });
  }

  // 讀 raw body
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
  });
  req.on('end', () => {
    console.log('📥 [minimal] raw body received:', raw);
  });
  req.on('error', err => {
    console.error('❌ [minimal] error reading body:', err);
  });

  // 立刻回 200，不等 body 完全處理（只是確認它有到）
  res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });
}
