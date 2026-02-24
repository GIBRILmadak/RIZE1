-- ========================================
-- SCHÉMA POUR LE LIVE STREAMING
-- ========================================

-- Table des sessions de streaming
CREATE TABLE IF NOT EXISTS streaming_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('live', 'ended', 'scheduled')) DEFAULT 'live',
    viewer_count INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des messages de chat
CREATE TABLE IF NOT EXISTS stream_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des viewers actifs
CREATE TABLE IF NOT EXISTS stream_viewers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(stream_id, user_id)
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_user_id ON streaming_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_status ON streaming_sessions(status);
CREATE INDEX IF NOT EXISTS idx_stream_messages_stream_id ON stream_messages(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_messages_created_at ON stream_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_viewers_stream_id ON stream_viewers(stream_id);

-- Politique de sécurité RLS
ALTER TABLE streaming_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_viewers ENABLE ROW LEVEL SECURITY;

-- Politiques pour streaming_sessions
CREATE POLICY "Les sessions publiques sont visibles par tous" ON streaming_sessions
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent créer leurs sessions" ON streaming_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leurs sessions" ON streaming_sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent supprimer leurs sessions" ON streaming_sessions
    FOR DELETE USING (auth.uid() = user_id);

-- Politiques pour stream_messages
CREATE POLICY "Les messages sont visibles par tous" ON stream_messages
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs authentifiés peuvent envoyer des messages" ON stream_messages
    FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent supprimer leurs messages" ON stream_messages
    FOR DELETE USING (auth.uid() = user_id);

-- Politiques pour stream_viewers
CREATE POLICY "Les viewers sont visibles par tous" ON stream_viewers
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent rejoindre un stream" ON stream_viewers
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur présence" ON stream_viewers
    FOR UPDATE USING (auth.uid() = user_id);

-- Fonction pour mettre à jour le nombre de viewers
CREATE OR REPLACE FUNCTION update_viewer_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE streaming_sessions
    SET viewer_count = (
        SELECT COUNT(DISTINCT user_id)
        FROM stream_viewers
        WHERE stream_id = NEW.stream_id
        AND last_seen > NOW() - INTERVAL '30 seconds'
    )
    WHERE id = NEW.stream_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour le nombre de viewers
DROP TRIGGER IF EXISTS trigger_update_viewer_count ON stream_viewers;
CREATE TRIGGER trigger_update_viewer_count
    AFTER INSERT OR UPDATE ON stream_viewers
    FOR EACH ROW
    EXECUTE FUNCTION update_viewer_count();

-- Fonction pour notifier les followers d'un nouveau stream
CREATE OR REPLACE FUNCTION notify_followers_on_stream()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (user_id, type, message, link)
    SELECT 
        follower_id,
        'stream',
        (SELECT name FROM users WHERE id = NEW.user_id) || ' est en live !',
        '/stream/' || NEW.id
    FROM followers
    WHERE following_id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour notifier les followers
DROP TRIGGER IF EXISTS trigger_notify_followers_on_stream ON streaming_sessions;
CREATE TRIGGER trigger_notify_followers_on_stream
    AFTER INSERT ON streaming_sessions
    FOR EACH ROW
    WHEN (NEW.status = 'live')
    EXECUTE FUNCTION notify_followers_on_stream();
    