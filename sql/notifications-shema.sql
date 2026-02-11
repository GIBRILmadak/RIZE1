-- ========================================
-- SCHÉMA POUR LES NOTIFICATIONS
-- ========================================

-- Table des notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('follow', 'like', 'comment', 'mention', 'achievement', 'stream')),
    message TEXT NOT NULL,
    link TEXT,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Politique de sécurité RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs peuvent voir leurs propres notifications
CREATE POLICY "Les utilisateurs peuvent voir leurs notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id);

-- Les utilisateurs peuvent marquer leurs notifications comme lues
CREATE POLICY "Les utilisateurs peuvent mettre à jour leurs notifications" ON notifications
    FOR UPDATE USING (auth.uid() = user_id);

-- Autoriser la création de notifications par les déclencheurs applicatifs
-- (stream en direct, follow, etc.) tout en limitant le spam
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer des notifications" ON notifications;
CREATE POLICY "Les utilisateurs peuvent créer des notifications" ON notifications
    FOR INSERT
    WITH CHECK (
        -- Cas 1 : l'utilisateur écrit pour lui-même (notifications manuelles éventuelles)
        auth.uid() = user_id
        OR
        -- Cas 2 : un utilisateur notifie ses followers (trigger sur streaming_sessions)
        EXISTS (
            SELECT 1 FROM followers f
            WHERE f.following_id = auth.uid()
              AND f.follower_id = user_id
        )
        OR
        -- Cas 3 : un utilisateur notifie la personne qu'il suit (trigger sur followers)
        EXISTS (
            SELECT 1 FROM followers f
            WHERE f.follower_id = auth.uid()
              AND f.following_id = user_id
        )
        OR
        -- Cas 4 : appels côté serveur (service_role)
        auth.role() = 'service_role'
    );

-- Fonction pour créer une notification automatiquement lors d'un follow
CREATE OR REPLACE FUNCTION notify_on_follow()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (user_id, type, message, link)
    VALUES (
        NEW.following_id,
        'follow',
        (SELECT name FROM users WHERE id = NEW.follower_id) || ' a commencé à vous suivre',
        '/profile/' || NEW.follower_id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour les notifications de follow
DROP TRIGGER IF EXISTS trigger_notify_on_follow ON followers;
CREATE TRIGGER trigger_notify_on_follow
    AFTER INSERT ON followers
    FOR EACH ROW
    EXECUTE FUNCTION notify_on_follow();

-- Fonction pour nettoyer les anciennes notifications (optionnel)
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void AS $$
BEGIN
    DELETE FROM notifications
    WHERE created_at < NOW() - INTERVAL '30 days'
    AND read = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Vous pouvez programmer cette fonction pour s'exécuter périodiquement
-- avec pg_cron ou l'appeler manuellement
