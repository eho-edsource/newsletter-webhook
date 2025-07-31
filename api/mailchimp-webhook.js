// api/mailchimp-webhook.js
export default async function handler(req, res) {
  // 只接受 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    console.log('=== Mailchimp Webhook Received ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    const { type, data } = req.body;
    
    // 只處理訂閱事件
    if (type === 'subscribe') {
      console.log('✅ New subscription detected');
      console.log('Email:', data.email);
      console.log('List ID:', data.list_id);
      
      // 發送到 GA4
      const result = await sendToGA4({
        email: data.email,
        listId: data.list_id,
        timestamp: new Date().toISOString()
      });
      
      console.log('GA4 tracking result:', result ? 'Success' : 'Failed');
    } else {
      console.log('ℹ️ Received non-subscribe event:', type);
    }
    
    // 必須回應 200，告訴 Mailchimp 已收到
    res.status(200).json({ 
      status: 'success', 
      message: 'Webhook processed',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

// 發送到 GA4 的函數
async function sendToGA4(data) {
  // 請替換成你的實際值
  const GA4_MEASUREMENT_ID = 'G-475QR6J62K'; // 你的 GA4 Measurement ID
  const GA4_API_SECRET = '9CPNecTzQVOHEhJCHky6tA';   // 你的 API Secret
  
  if (GA4_MEASUREMENT_ID === 'G-XXXXXXXXXX') {
    console.log('⚠️ Warning: Please update GA4_MEASUREMENT_ID and GA4_API_SECRET');
    return false;
  }
  
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
  
  const eventData = {
    client_id: generateClientId(data.email),
    events: [{
      name: 'generate_lead',
      parameters: {
        event_category: 'engagement',
        event_label: 'newsletter_signup',
        method: 'mailchimp_webhook',
        form_type: 'webhook_confirmed',
        source: 'mailchimp'
      }
    }]
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData)
    });
    
    console.log('GA4 Response Status:', response.status);
    
    if (!response.ok) {
      console.error('GA4 API error:', response.status, response.statusText);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error sending to GA4:', error);
    return false;
  }
}

// 生成一致的 client ID
function generateClientId(email) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString();
}