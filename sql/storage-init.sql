-- ========================================
-- INITIALISATION DU STOCKAGE (STORAGE)
-- ========================================

-- 1. Création du bucket 'media'
-- Cette étape est INDISPENSABLE car les politiques ne créent pas le bucket.
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Politiques de sécurité (Row Level Security)
-- Note: Si vous avez déjà créé ces politiques, vous pouvez ignorer les erreurs "policy already exists"
-- ou supprimer les anciennes avant.

-- Lecture publique (tout le monde peut voir les images)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'media' );

-- Upload pour utilisateurs authentifiés
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'media' AND
  auth.role() = 'authenticated'
);

-- Suppression par le propriétaire
DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'media' AND
  auth.uid() = owner
);

-- Mise à jour par le propriétaire
DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'media' AND
  auth.uid() = owner
);
