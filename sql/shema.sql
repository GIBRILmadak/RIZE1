-- ========================================
-- SCHÉMA DE BASE DE DONNÉES SUPABASE XERA
-- ========================================

-- Activer l'extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table des utilisateurs (profils)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT,
    bio TEXT,
    avatar TEXT,
    banner TEXT,
    account_type TEXT,
    account_subtype TEXT,
    badge TEXT,
    social_links JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des projets (créée AVANT content)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des contenus (posts journaliers)
CREATE TABLE IF NOT EXISTS content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    day_number INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'gif')),
    state TEXT NOT NULL CHECK (state IN ('success', 'failure', 'pause', 'empty')),
    title TEXT NOT NULL,
    description TEXT,
    media_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table des followers/following
CREATE TABLE IF NOT EXISTS followers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id)
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_content_user_id ON content(user_id);
CREATE INDEX IF NOT EXISTS idx_content_day_number ON content(day_number DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_followers_follower_id ON followers(follower_id);
CREATE INDEX IF NOT EXISTS idx_followers_following_id ON followers(following_id);

-- Politique de sécurité RLS (Row Level Security)

-- Activer RLS sur toutes les tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE followers ENABLE ROW LEVEL SECURITY;

-- Politiques pour la table users
CREATE POLICY "Les profils publics sont visibles par tous" ON users
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent créer leur propre profil" ON users
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur propre profil" ON users
    FOR UPDATE USING (auth.uid() = id);

-- Politiques pour la table content
CREATE POLICY "Le contenu public est visible par tous" ON content
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent créer leur propre contenu" ON content
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur propre contenu" ON content
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent supprimer leur propre contenu" ON content
    FOR DELETE USING (auth.uid() = user_id);

-- Politiques pour la table projects
CREATE POLICY "Les projets publics sont visibles par tous" ON projects
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent créer leurs propres projets" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leurs propres projets" ON projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent supprimer leurs propres projets" ON projects
    FOR DELETE USING (auth.uid() = user_id);

-- Politiques pour la table followers
CREATE POLICY "Les relations de follow sont visibles par tous" ON followers
    FOR SELECT USING (true);

CREATE POLICY "Les utilisateurs peuvent follow d'autres utilisateurs" ON followers
    FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Les utilisateurs peuvent unfollow" ON followers
    FOR DELETE USING (auth.uid() = follower_id);

-- Fonction pour mettre à jour automatiquement updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers pour updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_updated_at BEFORE UPDATE ON content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
