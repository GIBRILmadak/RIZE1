-- Correctifs RLS pour la vérification (visible + modération)

-- 1) Autoriser la lecture publique des badges vérifiés (affichage du badge)
--    et éviter la récursion RLS via une fonction SECURITY DEFINER

-- Helper pour tester si l'utilisateur courant est staff vérifié sans déclencher RLS
CREATE OR REPLACE FUNCTION rize_is_verified_staff(uid UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM verified_badges vb
    WHERE vb.user_id = uid AND vb.type = 'staff'
  );
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS "Super admin gère les badges vérifiés" ON verified_badges;
CREATE POLICY "Badges visibles par tous" ON verified_badges
    FOR SELECT USING (true);

CREATE POLICY "Gestion badges par staff vérifié ou super admin" ON verified_badges
    FOR ALL USING (
        rize_is_super_admin()
        OR rize_is_verified_staff(auth.uid())
    ) WITH CHECK (
        rize_is_super_admin()
        OR rize_is_verified_staff(auth.uid())
    );

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
