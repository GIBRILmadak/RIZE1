-- Add arc_id to content if not exists
ALTER TABLE content ADD COLUMN IF NOT EXISTS arc_id UUID REFERENCES arcs(id) ON DELETE SET NULL;

-- Create Arcs table if not exists (from sql/arcs-schema.sql)
CREATE TABLE IF NOT EXISTS arcs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    goal TEXT,
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    duration_days INTEGER,
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')) DEFAULT 'in_progress',
    media_url TEXT,
    media_type TEXT CHECK (media_type IN ('image', 'video')) DEFAULT 'image',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table pour les collaborations d'ARCs
CREATE TABLE IF NOT EXISTS arc_collaborations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    arc_id UUID NOT NULL REFERENCES arcs(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collaborator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'left')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(arc_id, collaborator_id)
);
