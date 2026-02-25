-- ========================================
-- Table des abonnements Web Push
-- ========================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keys JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- RLS : seules les opérations service_role (backend) sont autorisées
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Autoriser le service_role (backend) uniquement
DROP POLICY IF EXISTS "service role manage push" ON push_subscriptions;
CREATE POLICY "service role manage push" ON push_subscriptions
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
