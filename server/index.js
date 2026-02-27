const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

dotenv.config();

const {
  APP_BASE_URL = 'http://localhost:3000',
  PORT = 5050,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  PUSH_CONTACT_EMAIL = 'mailto:notifications@xera.app'
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn('Warning: Missing VAPID keys. Push notifications will not be sent.');
} else {
  webpush.setVapidDetails(PUSH_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(express.json());
const allowedOrigins = APP_BASE_URL.split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST'] }));

const PRIMARY_ORIGIN = allowedOrigins[0] || APP_BASE_URL.split(',')[0] || 'http://localhost:3000';

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

// Enregistrer / mettre à jour un abonnement Web Push pour un utilisateur
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { userId, subscription } = req.body;
    if (!userId || !subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription payload' });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys || null,
      }, { onConflict: 'endpoint' });

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('push subscribe error', err);
    res.status(400).json({ error: err.message });
  }
});

// Relais temps-réel : envoie une notification push pour chaque nouvelle ligne dans public.notifications
async function startPushRelay() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const channel = supabase.channel('server-push-relay');

  channel
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications'
    }, async (payload) => {
      const notif = payload.new;
      try {
        await sendPushForNotification(notif);
      } catch (err) {
        console.error('push relay error', err);
      }
    })
    .subscribe((status) => {
      console.log('Push relay status:', status);
    });
}

async function sendPushForNotification(notification) {
  if (!notification?.user_id) return;

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', notification.user_id);

  if (error) throw error;
  if (!subs || subs.length === 0) return;

  const payload = buildPushPayload(notification);
  const payloadString = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payloadString);
    } catch (err) {
      // Purger les abonnements invalides
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', sub.endpoint);
        console.log('Removed stale subscription', sub.endpoint);
      } else {
        console.error('send push error', err);
      }
    }
  }
}

function buildPushPayload(notification) {
  const typeTitleMap = {
    follow: 'Nouvel abonné',
    encouragement: 'Nouvel encouragement',
    new_trace: 'Nouvelle trace',
    new_arc: 'Nouvel ARC',
    live_start: 'Live en cours',
    collaboration: 'Demande de collaboration',
    like: 'Nouveau like',
    comment: 'Nouveau commentaire',
    mention: 'Mention'
  };

  const title = typeTitleMap[notification.type] || 'Notification XERA';
  const icon = `${PRIMARY_ORIGIN.replace(/\/$/, '')}/icons/logo.png`;
  const link = normalizeNotificationLink(notification) || `${PRIMARY_ORIGIN.replace(/\/$/, '')}/profile.html?user=${notification.user_id}`;

  return {
    title,
    body: notification.message || '',
    icon,
    link,
    tag: notification.id,
    renotify: false
  };
}

function normalizeNotificationLink(notification) {
  const base = PRIMARY_ORIGIN.replace(/\/$/, '');
  const raw = (notification && notification.link) || '';
  if (!raw) return '';
  const streamMatch = raw.match(/\/stream\/?([\w-]{8,})/i);
  if (streamMatch) {
    return `${base}/stream.html?id=${streamMatch[1]}`;
  }
  const profileMatch = raw.match(/\/profile\/?([\w-]{8,})/i);
  if (profileMatch) {
    return `${base}/profile.html?user=${profileMatch[1]}`;
  }
  const profileHtmlMatch = raw.match(/profile\.html\?user=([\w-]{8,})/i);
  if (profileHtmlMatch) {
    return `${base}/profile.html?user=${profileHtmlMatch[1]}`;
  }
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

app.use((_req, res) => {
  res.status(501).json({ error: 'Paiements désactivés. Stripe sera ajouté plus tard.' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  startPushRelay();
});
