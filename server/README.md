Rize Backend (paiements désactivés)

Setup
- Copier .env.example en .env
- Renseigner SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
- Ajuster APP_BASE_URL (domaines front autorisés)

Run
- npm install
- npm run api

Endpoints actifs
- GET /api/health : indique que les paiements sont désactivés
- POST /api/users/upsert : crée/met à jour un utilisateur (id, email, paypal_email)

Note
- Toute la logique PayPal a été retirée. On réintroduira Stripe plus tard.
