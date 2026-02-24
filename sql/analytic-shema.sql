-- ========================================
-- SCHÉMA POUR LES ANALYTICS
-- ========================================

-- Table des métriques quotidiennes
CREATE TABLE IF NOT EXISTS daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    posts_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    pause_count INTEGER DEFAULT 0,
    followers_gained INTEGER DEFAULT 0,
    followers_lost INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Table des streaks
CREATE TABLE IF NOT EXISTS user_streaks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_post_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_id ON daily_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_user_streaks_user_id ON user_streaks(user_id);

-- Politique de sécurité RLS
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

-- Politiques pour daily_metrics
DROP POLICY IF EXISTS "Les métriques sont visibles par leur propriétaire" ON daily_metrics;
DROP POLICY IF EXISTS "Les métriques sont visibles par tous" ON daily_metrics;
CREATE POLICY "Les métriques sont visibles par tous" ON daily_metrics
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Les métriques sont créées automatiquement" ON daily_metrics;
CREATE POLICY "Les métriques sont créées automatiquement" ON daily_metrics
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Les métriques peuvent être mises à jour par leur propriétaire" ON daily_metrics;
CREATE POLICY "Les métriques peuvent être mises à jour par leur propriétaire" ON daily_metrics
    FOR UPDATE USING (auth.uid() = user_id);

-- Politiques pour user_streaks
DROP POLICY IF EXISTS "Les streaks sont visibles par tous" ON user_streaks;
CREATE POLICY "Les streaks sont visibles par tous" ON user_streaks
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Les streaks sont créées automatiquement" ON user_streaks;
CREATE POLICY "Les streaks sont créées automatiquement" ON user_streaks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Les streaks peuvent être mises à jour par leur propriétaire" ON user_streaks;
CREATE POLICY "Les streaks peuvent être mises à jour par leur propriétaire" ON user_streaks
    FOR UPDATE USING (auth.uid() = user_id);

-- Fonction pour calculer et mettre à jour les métriques quotidiennes
CREATE OR REPLACE FUNCTION update_daily_metrics()
RETURNS TRIGGER AS $$
DECLARE
    metric_date DATE := CURRENT_DATE;
BEGIN
    -- Insérer ou mettre à jour les métriques du jour
    INSERT INTO daily_metrics (user_id, date, posts_count, success_count, failure_count, pause_count)
    VALUES (
        NEW.user_id,
        metric_date,
        1,
        CASE WHEN NEW.state = 'success' THEN 1 ELSE 0 END,
        CASE WHEN NEW.state = 'failure' THEN 1 ELSE 0 END,
        CASE WHEN NEW.state = 'pause' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, date)
    DO UPDATE SET
        posts_count = daily_metrics.posts_count + 1,
        success_count = daily_metrics.success_count + CASE WHEN NEW.state = 'success' THEN 1 ELSE 0 END,
        failure_count = daily_metrics.failure_count + CASE WHEN NEW.state = 'failure' THEN 1 ELSE 0 END,
        pause_count = daily_metrics.pause_count + CASE WHEN NEW.state = 'pause' THEN 1 ELSE 0 END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour les métriques
DROP TRIGGER IF EXISTS trigger_update_daily_metrics ON content;
CREATE TRIGGER trigger_update_daily_metrics
    AFTER INSERT ON content
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_metrics();

-- Fonction pour calculer et mettre à jour les streaks
CREATE OR REPLACE FUNCTION update_user_streak()
RETURNS TRIGGER AS $$
DECLARE
    last_date DATE;
    current_streak_val INTEGER := 0;
    longest_streak_val INTEGER := 0;
BEGIN
    -- Récupérer la dernière date de post
    SELECT last_post_date INTO last_date
    FROM user_streaks
    WHERE user_id = NEW.user_id;
    
    -- Si pas de streak existant, créer
    IF last_date IS NULL THEN
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_post_date)
        VALUES (NEW.user_id, 1, 1, CURRENT_DATE)
        ON CONFLICT (user_id) DO NOTHING;
        RETURN NEW;
    END IF;
    
    -- Calculer le nouveau streak
    IF CURRENT_DATE = last_date THEN
        -- Même jour, pas de changement
        RETURN NEW;
    ELSIF CURRENT_DATE = last_date + INTERVAL '1 day' THEN
        -- Jour consécutif, incrémenter le streak
        UPDATE user_streaks
        SET 
            current_streak = current_streak + 1,
            longest_streak = GREATEST(longest_streak, current_streak + 1),
            last_post_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE user_id = NEW.user_id;
    ELSE
        -- Streak cassé, recommencer à 1
        UPDATE user_streaks
        SET 
            current_streak = 1,
            last_post_date = CURRENT_DATE,
            updated_at = NOW()
        WHERE user_id = NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour les streaks
DROP TRIGGER IF EXISTS trigger_update_user_streak ON content;
CREATE TRIGGER trigger_update_user_streak
    AFTER INSERT ON content
    FOR EACH ROW
    EXECUTE FUNCTION update_user_streak();

-- Vue pour les statistiques globales d'un utilisateur
CREATE OR REPLACE VIEW user_statistics WITH (security_invoker = true) AS
SELECT 
    u.id as user_id,
    u.name,
    COUNT(c.id) as total_posts,
    COUNT(CASE WHEN c.state = 'success' THEN 1 END) as success_count,
    COUNT(CASE WHEN c.state = 'failure' THEN 1 END) as failure_count,
    COUNT(CASE WHEN c.state = 'pause' THEN 1 END) as pause_count,
    ROUND(
        COUNT(CASE WHEN c.state = 'success' THEN 1 END)::numeric / 
        NULLIF(COUNT(c.id), 0) * 100, 
        2
    ) as success_rate,
    COALESCE(s.current_streak, 0) as current_streak,
    COALESCE(s.longest_streak, 0) as longest_streak,
    (SELECT COUNT(*) FROM followers WHERE following_id = u.id) as followers_count,
    (SELECT COUNT(*) FROM followers WHERE follower_id = u.id) as following_count
FROM users u
LEFT JOIN content c ON u.id = c.user_id
LEFT JOIN user_streaks s ON u.id = s.user_id
GROUP BY u.id, u.name, s.current_streak, s.longest_streak;
