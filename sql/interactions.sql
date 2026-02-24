-- Add views and encouragements_count to content
ALTER TABLE content ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0;
ALTER TABLE content ADD COLUMN IF NOT EXISTS encouragements_count INTEGER DEFAULT 0;

-- Create table for tracking user encouragements
CREATE TABLE IF NOT EXISTS content_encouragements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, content_id)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_content_encouragements_user_content ON content_encouragements(user_id, content_id);
CREATE INDEX IF NOT EXISTS idx_content_encouragements_content_id ON content_encouragements(content_id);

-- RLS
ALTER TABLE content_encouragements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Encouragements visibles par tous" ON content_encouragements;
CREATE POLICY "Encouragements visibles par tous" ON content_encouragements
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Utilisateurs peuvent encourager" ON content_encouragements;
CREATE POLICY "Utilisateurs peuvent encourager" ON content_encouragements
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Utilisateurs peuvent supprimer leurs encouragements" ON content_encouragements;
CREATE POLICY "Utilisateurs peuvent supprimer leurs encouragements" ON content_encouragements
    FOR DELETE USING (auth.uid() = user_id);


-- Function to increment views
CREATE OR REPLACE FUNCTION increment_views(row_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE content
    SET views = views + 1
    WHERE id = row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to toggle courage (handle like/unlike logic safely)
CREATE OR REPLACE FUNCTION toggle_courage(row_id UUID, user_id_param UUID)
RETURNS JSONB AS $$
DECLARE
    exists_check BOOLEAN;
    new_count INTEGER;
    is_encouraged BOOLEAN;
BEGIN
    -- Check if encouragement exists
    SELECT EXISTS(SELECT 1 FROM content_encouragements WHERE content_id = row_id AND user_id = user_id_param) INTO exists_check;
    
    IF exists_check THEN
        -- Remove encouragement
        DELETE FROM content_encouragements WHERE content_id = row_id AND user_id = user_id_param;
        UPDATE content SET encouragements_count = encouragements_count - 1 WHERE id = row_id RETURNING encouragements_count INTO new_count;
        is_encouraged := FALSE;
    ELSE
        -- Add encouragement
        INSERT INTO content_encouragements (user_id, content_id) VALUES (user_id_param, row_id);
        UPDATE content SET encouragements_count = encouragements_count + 1 WHERE id = row_id RETURNING encouragements_count INTO new_count;
        is_encouraged := TRUE;
    END IF;
    
    RETURN jsonb_build_object('count', new_count, 'encouraged', is_encouraged);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
