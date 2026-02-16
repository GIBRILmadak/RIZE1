-- ========================================
-- PRE-FLIGHT: premier post (XERA)
-- ========================================
-- A executer dans Supabase SQL Editor pour verifier la config minimale.

-- 1) arc_id doit exister sur content
SELECT
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'content'
          AND column_name = 'arc_id'
    ) AS has_content_arc_id;

-- 2) bucket media requis pour upload image/video
SELECT
    EXISTS (
        SELECT 1
        FROM storage.buckets
        WHERE id = 'media'
    ) AS has_media_bucket;

-- 3) colonnes de moderation (utilisees par la logique soft delete)
SELECT
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'content'
          AND column_name = 'is_deleted'
    ) AS has_content_moderation_columns;

-- 4) check constraint sur content.type
SELECT
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'content'
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ILIKE '%type IN%';
