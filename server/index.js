const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const {
  APP_BASE_URL = 'http://localhost:3000',
  PORT = 5050,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(express.json());
const allowedOrigins = APP_BASE_URL.split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST'] }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, payments: 'disabled', message: 'PayPal removed, ready to add Stripe later.' });
});

// Simple user upsert to keep Supabase usable while payments are disabled
app.post('/api/users/upsert', async (req, res) => {
  try {
    const { id, email, paypalEmail } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing user id' });

    const { error } = await supabase
      .from('users')
      .upsert({ id, email: email || null, paypal_email: paypalEmail || null });

    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use((_req, res) => {
  res.status(501).json({ error: 'Paiements désactivés. Stripe sera ajouté plus tard.' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
