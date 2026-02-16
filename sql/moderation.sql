-- ========================================
-- MODÉRATION + SUPER ADMIN (XERA)
-- ========================================

-- Champs de modération
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS banned_reason TEXT,
    ADD COLUMN IF NOT EXISTS banned_by UUID,
    ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

ALTER TABLE content
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_reason TEXT,
    ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Table des badges vérifiés (si absente)
CREATE TABLE IF NOT EXISTS verified_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('staff', 'creator')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, type)
);

-- Table des demandes de vérification (si absente)
CREATE TABLE IF NOT EXISTS verification_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('staff', 'creator')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des annonces officielles
CREATE TABLE IF NOT EXISTS admin_announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID
);

-- RLS
ALTER TABLE verified_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_announcements ENABLE ROW LEVEL SECURITY;

-- Fonctions utilitaires
CREATE OR REPLACE FUNCTION rize_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE AS $$
  SELECT auth.uid() = 'b0f9f893-1706-4721-899c-d26ad79afc86';
$$;

CREATE OR REPLACE FUNCTION rize_is_user_banned(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE AS $$
  SELECT COALESCE((SELECT banned_until > NOW() FROM users WHERE id = p_uid), false);
$$;

-- Nettoyage des policies existantes à adapter
DROP POLICY IF EXISTS "Le contenu public est visible par tous" ON content;
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur propre contenu" ON content;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur propre contenu" ON content;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leur propre contenu" ON content;

DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur propre profil" ON users;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur propre profil" ON users;

DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leurs propres projets" ON projects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leurs propres projets" ON projects;
DROP POLICY IF EXISTS "Les utilisateurs peuvent supprimer leurs propres projets" ON projects;

DROP POLICY IF EXISTS "Les utilisateurs peuvent follow d'autres utilisateurs" ON followers;
DROP POLICY IF EXISTS "Les utilisateurs peuvent unfollow" ON followers;

-- Policies USERS
CREATE POLICY "Les utilisateurs peuvent créer leur propre profil" ON users
    FOR INSERT WITH CHECK (auth.uid() = id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur propre profil" ON users
    FOR UPDATE USING (auth.uid() = id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Super admin peut tout faire (users)" ON users
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

CREATE POLICY "Super admin peut supprimer un utilisateur" ON users
    FOR DELETE USING (rize_is_super_admin());

-- Policies CONTENT
CREATE POLICY "Le contenu public est visible par tous" ON content
    FOR SELECT USING (is_deleted = false OR rize_is_super_admin());

CREATE POLICY "Les utilisateurs peuvent créer leur propre contenu" ON content
    FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur propre contenu" ON content
    FOR UPDATE USING (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent supprimer leur propre contenu" ON content
    FOR DELETE USING (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Super admin peut tout faire (content)" ON content
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

-- Policies PROJECTS
CREATE POLICY "Les utilisateurs peuvent créer leurs propres projets" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent mettre à jour leurs propres projets" ON projects
    FOR UPDATE USING (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent supprimer leurs propres projets" ON projects
    FOR DELETE USING (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Super admin peut tout faire (projects)" ON projects
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

-- Policies FOLLOWERS
CREATE POLICY "Les utilisateurs peuvent follow d'autres utilisateurs" ON followers
    FOR INSERT WITH CHECK (auth.uid() = follower_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Les utilisateurs peuvent unfollow" ON followers
    FOR DELETE USING (auth.uid() = follower_id);

CREATE POLICY "Super admin peut tout faire (followers)" ON followers
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

-- Policies VERIFIED BADGES
CREATE POLICY "Badges vérifiés visibles par tous" ON verified_badges
    FOR SELECT USING (true);

CREATE POLICY "Super admin gère les badges vérifiés" ON verified_badges
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

-- Policies VERIFICATION REQUESTS
CREATE POLICY "Demandes visibles par le demandeur ou super admin" ON verification_requests
    FOR SELECT USING (auth.uid() = user_id OR rize_is_super_admin());

CREATE POLICY "Demande de vérification par l'utilisateur" ON verification_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT rize_is_user_banned(auth.uid()));

CREATE POLICY "Super admin gère les demandes" ON verification_requests
    FOR UPDATE USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

CREATE POLICY "Super admin supprime les demandes" ON verification_requests
    FOR DELETE USING (rize_is_super_admin());

-- Policies ANNONCES
CREATE POLICY "Annonces visibles par tous" ON admin_announcements
    FOR SELECT USING (deleted_at IS NULL OR rize_is_super_admin());

CREATE POLICY "Super admin gère les annonces" ON admin_announcements
    FOR ALL USING (rize_is_super_admin()) WITH CHECK (rize_is_super_admin());

-- Badge entreprise vérifiée par défaut pour le super admin
INSERT INTO verified_badges (user_id, type)
VALUES ('b0f9f893-1706-4721-899c-d26ad79afc86', 'staff')
ON CONFLICT (user_id, type) DO NOTHING;
