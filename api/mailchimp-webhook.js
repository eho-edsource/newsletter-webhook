export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    console.log('Received webhook:', req.body);
    
    const { type, data } = req.body;
    
    if (type === 'subscribe') {
      console.log('New subscription:', data.email);
      
      // TODO: 發送到 GA4
      await sendToGA4(data);
    }
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendToGA4(data) {
  // GA4 tracking code will go here
  console.log('Sending to GA4:', data.email);
}