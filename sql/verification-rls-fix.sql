-- Correctifs RLS pour la vérification (visible + modération)

--    et éviter la récursion RLS via une fonction SECURITY DEFINER

CREATE OR REPLACE FUNCTION rize_is_verified_staff(uid UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT uid = 'b0f9f893-1706-4721-899c-d26ad79afc86'
         OR EXISTS (
           SELECT 1 FROM verified_badges vb
           WHERE vb.user_id = uid AND vb.type = 'staff'
         );
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS "Super admin gère les badges vérifiés" ON verified_badges;
DROP POLICY IF EXISTS "Badges visibles par tous" ON verified_badges;
CREATE POLICY "Badges visibles par tous" ON verified_badges
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Gestion badges par staff vérifié ou super admin" ON verified_badges;
DROP POLICY IF EXISTS "Badges créés par super admin" ON verified_badges;
CREATE POLICY "Badges créés par super admin" ON verified_badges
    FOR INSERT
    WITH CHECK (rize_is_super_admin());

DROP POLICY IF EXISTS "Badges modifiés par super admin" ON verified_badges;
CREATE POLICY "Badges modifiés par super admin" ON verified_badges
    FOR UPDATE
    USING (rize_is_super_admin())
    WITH CHECK (rize_is_super_admin());

DROP POLICY IF EXISTS "Badges retirés par super admin" ON verified_badges;
CREATE POLICY "Badges retirés par super admin" ON verified_badges
    FOR DELETE
    USING (rize_is_super_admin());

-- Garantir que le super admin reste reconnu comme staff vérifié par défaut
INSERT INTO verified_badges (user_id, type)
VALUES ('b0f9f893-1706-4721-899c-d26ad79afc86', 'staff')
ON CONFLICT (user_id, type) DO NOTHING;

-- 2) Laisser les admins vérification (staff vérifié) voir et traiter les demandes
DROP POLICY IF EXISTS "Demandes visibles par le demandeur ou super admin" ON verification_requests;
CREATE POLICY "Demandes visibles demandeur/admin" ON verification_requests
    FOR SELECT USING (
        auth.uid() = user_id
        OR rize_is_super_admin()
        OR EXISTS (
            SELECT 1 FROM verified_badges vb
            WHERE vb.user_id = auth.uid() AND vb.type = 'staff'
        )
    );

DROP POLICY IF EXISTS "Super admin gère les demandes" ON verification_requests;
CREATE POLICY "Admins gèrent les demandes" ON verification_requests
    FOR UPDATE USING (
        rize_is_super_admin()
        OR EXISTS (
            SELECT 1 FROM verified_badges vb
            WHERE vb.user_id = auth.uid() AND vb.type = 'staff'
        )
    ) WITH CHECK (
        rize_is_super_admin()
        OR EXISTS (
            SELECT 1 FROM verified_badges vb
            WHERE vb.user_id = auth.uid() AND vb.type = 'staff'
        )
    );

DROP POLICY IF EXISTS "Super admin supprime les demandes" ON verification_requests;
CREATE POLICY "Admins suppriment les demandes" ON verification_requests
    FOR DELETE USING (
        rize_is_super_admin()
        OR EXISTS (
            SELECT 1 FROM verified_badges vb
            WHERE vb.user_id = auth.uid() AND vb.type = 'staff'
        )
    );
