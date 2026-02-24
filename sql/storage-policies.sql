-- Politiques pour le bucket media
-- À exécuter dans le SQL Editor de Supabase

-- Permettre l'upload aux utilisateurs authentifiés
CREATE POLICY "Allow authenticated upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'media');

-- Permettre la lecture publique
CREATE POLICY "Allow public read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'media');

-- Permettre la suppression par le propriétaire
CREATE POLICY "Allow owner delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Permettre la mise à jour par le propriétaire  
CREATE POLICY "Allow owner update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);