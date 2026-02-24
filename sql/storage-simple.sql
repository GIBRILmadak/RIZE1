-- Configuration simple pour les tests (ATTENTION: moins sécurisé)
-- À exécuter dans le SQL Editor de Supabase

-- Désactiver RLS sur storage.objects (pour les tests seulement)
ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;

-- OU créer un bucket avec accès public total
INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true);