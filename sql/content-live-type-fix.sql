-- ========================================
-- CONTENT TYPE FIX: ajout du type "live"
-- ========================================
-- A executer dans Supabase SQL Editor

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT c.conname
    INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'content'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%type IN%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.content DROP CONSTRAINT %I',
            v_constraint_name
        );
    END IF;
END
$$;

ALTER TABLE public.content
    ADD CONSTRAINT content_type_check
    CHECK (type IN ('text', 'image', 'video', 'gif', 'live'));
