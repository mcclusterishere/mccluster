-- Anti-Social / Get Social: one mission, three sequential, independently reviewed levels.
-- Stage under pending until the globe migration ledger is reconciled.
-- No recording of strangers without consent; self-focused proof is allowed.
-- Deploy as DRAFT. Open only after member UI, reviewer UI and Worker are live and verified.
INSERT INTO public.action_missions
(id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
VALUES
('a17050c1-a551-4c5c-80c1-5a1750c1a001',NULL,'Anti-Social — Get Social',
 '1. High Five: offer one high five. 2. Five High Fives: connect with five different people. 3. Make Something Together: connect with an Action Network member and publish original work credited to both profiles. Record only with consent; you may show yourself rather than a stranger.',
 'community',1,150,true,'review',ARRAY['community','collaboration','creativity']::text[],'draft')
ON CONFLICT(id) DO UPDATE SET
 title=EXCLUDED.title,description=EXCLUDED.description,
 domain=EXCLUDED.domain,skills=EXCLUDED.skills,updated_at=now();

-- The catalog track is titled "Antisocial" on the "here" album.
-- The owner explicitly approved this song-to-mission association.
INSERT INTO public.action_globe_song_missions(mission_id,song_title,album_slug)
VALUES('a17050c1-a551-4c5c-80c1-5a1750c1a001','Antisocial','here')
ON CONFLICT(mission_id) DO UPDATE SET song_title=EXCLUDED.song_title,album_slug=EXCLUDED.album_slug;

CREATE TABLE IF NOT EXISTS public.action_antisocial_levels(
 assignment_id uuid NOT NULL REFERENCES public.action_mission_assignments(id) ON DELETE CASCADE,
 level smallint NOT NULL CHECK(level BETWEEN 1 AND 3),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 proof_url text,
 media_asset_id uuid REFERENCES public.network_media_assets(id) ON DELETE SET NULL,
 statement text NOT NULL DEFAULT '' CHECK(char_length(statement)<=1500),
 post_id uuid REFERENCES public.network_posts(id) ON DELETE SET NULL,
 collaborator_m_uid uuid REFERENCES public.m_people(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 review_note text,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(assignment_id,level)
);
CREATE INDEX IF NOT EXISTS action_antisocial_levels_user_idx
ON public.action_antisocial_levels(user_id,level,status);
ALTER TABLE public.action_antisocial_levels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_antisocial_levels FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.action_antisocial_levels TO service_role;
GRANT SELECT ON public.action_antisocial_levels TO authenticated;
CREATE POLICY "owner reads own antisocial levels"
ON public.action_antisocial_levels FOR SELECT TO authenticated
USING(user_id=(SELECT auth.uid()) OR (SELECT public.eu_is_admin()));

-- Only a server RPC can submit. This is also an audit trail for moderation.
CREATE OR REPLACE FUNCTION public.submit_antisocial_level(
 p_assignment_id uuid,p_level smallint,p_statement text,
 p_proof_url text DEFAULT NULL,p_post_id uuid DEFAULT NULL,p_collaborator_m_uid uuid DEFAULT NULL,
 p_media_asset_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_user uuid:=(SELECT auth.uid());
 v_self uuid:=public.current_m_uid();
 v_a public.action_mission_assignments%rowtype;
 v_prior text;
 v_post public.network_posts%rowtype;
 v_status text;
BEGIN
 IF v_user IS NULL OR v_self IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
 IF p_level NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'invalid level'; END IF;
 IF length(btrim(coalesce(p_statement,'')))>1500 THEN RAISE EXCEPTION 'statement too long'; END IF;
 IF p_proof_url IS NOT NULL AND (p_proof_url !~* '^https://' OR length(p_proof_url)>2000)
 THEN RAISE EXCEPTION 'proof must be a secure link'; END IF;
 SELECT * INTO v_a FROM public.action_mission_assignments
 WHERE id=p_assignment_id AND user_id=v_user AND mission_id='a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid FOR UPDATE;
 IF NOT FOUND OR v_a.status NOT IN ('joined','in_progress','rejected')
 THEN RAISE EXCEPTION 'start the Anti-Social mission first'; END IF;
 IF p_level>1 THEN
   SELECT status INTO v_prior FROM public.action_antisocial_levels
   WHERE assignment_id=p_assignment_id AND level=p_level-1;
   IF v_prior IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'finish the previous level first'; END IF;
 END IF;
 IF p_media_asset_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.network_media_assets ma WHERE ma.id=p_media_asset_id
   AND ma.owner_m_uid=v_self AND ma.media_type IN ('video','image')
   AND ma.status IN ('ready','staged')
 ) THEN RAISE EXCEPTION 'proof upload is not yours or not ready'; END IF;
 IF p_level<3 THEN
   IF p_post_id IS NOT NULL OR p_collaborator_m_uid IS NOT NULL THEN
     RAISE EXCEPTION 'collaboration fields only apply to level three';
   END IF;
   IF nullif(btrim(coalesce(p_proof_url,'')),'') IS NULL AND p_media_asset_id IS NULL THEN
      RAISE EXCEPTION 'submit a consent-safe clip or a secure video link';
   END IF;
 ELSE
   IF p_post_id IS NULL OR p_collaborator_m_uid IS NULL OR p_collaborator_m_uid=v_self
   THEN RAISE EXCEPTION 'choose a post and another Action Network member'; END IF;
   IF NOT EXISTS (
     SELECT 1 FROM public.network_connections c
     WHERE c.status='accepted'
       AND ((c.requester_m_uid=v_self AND c.addressee_m_uid=p_collaborator_m_uid)
         OR (c.addressee_m_uid=v_self AND c.requester_m_uid=p_collaborator_m_uid))
   ) THEN RAISE EXCEPTION 'connect with your collaborator on Action Network first'; END IF;
   SELECT * INTO v_post FROM public.network_posts WHERE id=p_post_id
      AND deleted_at IS NULL AND removed_at IS NULL AND visibility='public';
   IF NOT FOUND THEN RAISE EXCEPTION 'publish the original work as a public post first'; END IF;
   IF v_post.author_m_uid NOT IN (v_self,p_collaborator_m_uid)
   THEN RAISE EXCEPTION 'the post must be by one of the collaborators'; END IF;
 END IF;
 SELECT status INTO v_status FROM public.action_antisocial_levels
 WHERE assignment_id=p_assignment_id AND level=p_level;
 IF v_status='verified' THEN RAISE EXCEPTION 'level already verified'; END IF;
 INSERT INTO public.action_antisocial_levels
 (assignment_id,level,user_id,proof_url,media_asset_id,statement,post_id,collaborator_m_uid,status)
 VALUES(p_assignment_id,p_level,v_user,p_proof_url,p_media_asset_id,coalesce(p_statement,''),p_post_id,p_collaborator_m_uid,'pending')
 ON CONFLICT(assignment_id,level) DO UPDATE SET
 proof_url=EXCLUDED.proof_url,media_asset_id=EXCLUDED.media_asset_id,statement=EXCLUDED.statement,post_id=EXCLUDED.post_id,
 collaborator_m_uid=EXCLUDED.collaborator_m_uid,status='pending',review_note=NULL,
 reviewed_at=NULL,updated_at=now()
 WHERE public.action_antisocial_levels.status<>'verified';
 RETURN jsonb_build_object('level',p_level,'status','pending','assignment_id',p_assignment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_antisocial_level(uuid,smallint,text,text,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_antisocial_level(uuid,smallint,text,text,uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.review_antisocial_level(
 p_assignment_id uuid,p_level smallint,p_decision text,p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_l public.action_antisocial_levels%rowtype;
 v_a public.action_mission_assignments%rowtype;
 v_other uuid;
 v_points integer;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.eu_is_admin()) THEN
 RAISE EXCEPTION 'not authorized'; END IF;
 IF p_decision NOT IN ('verified','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
 SELECT * INTO v_a FROM public.action_mission_assignments WHERE id=p_assignment_id FOR UPDATE;
 IF NOT FOUND OR v_a.mission_id<>'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid
 THEN RAISE EXCEPTION 'not an Anti-Social assignment'; END IF;
 SELECT * INTO v_l FROM public.action_antisocial_levels
 WHERE assignment_id=p_assignment_id AND level=p_level FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'level submission missing'; END IF;
 IF v_l.status='verified' THEN RETURN jsonb_build_object('status','verified','idempotent',true); END IF;
 IF v_l.user_id=(SELECT auth.uid()) THEN RAISE EXCEPTION 'cannot review own work'; END IF;
 IF p_level>1 AND NOT EXISTS (
 SELECT 1 FROM public.action_antisocial_levels
 WHERE assignment_id=p_assignment_id AND level=p_level-1 AND status='verified'
 ) THEN RAISE EXCEPTION 'previous level not verified'; END IF;
 IF p_level=3 AND p_decision='verified' THEN
   -- BOTH members must independently submit the SAME post with reciprocal credit.
   -- This makes the collaboration count for each without silently crediting a stranger.
   SELECT other.assignment_id INTO v_other
   FROM public.action_antisocial_levels other
   JOIN public.action_mission_assignments oa ON oa.id=other.assignment_id
   WHERE other.level=3 AND other.post_id=v_l.post_id
     AND oa.m_uid=v_l.collaborator_m_uid
     AND other.collaborator_m_uid=v_a.m_uid
     AND other.status IN ('pending','verified')
     AND oa.id<>v_a.id
   LIMIT 1;
   IF v_other IS NULL THEN RAISE EXCEPTION 'collaborator must join, finish levels 1-2, and submit this same work'; END IF;
 END IF;
 UPDATE public.action_antisocial_levels SET status=p_decision,
 review_note=left(coalesce(p_note,''),500),reviewed_at=now(),updated_at=now()
 WHERE assignment_id=p_assignment_id AND level=p_level;
 IF p_level=3 AND p_decision='verified' THEN
   -- Award ONCE per verified full mission; partial levels do not inflate counts.
   v_points:=150;
   INSERT INTO public.action_points_ledger(m_uid,assignment_id,kind,points,reason,factors)
   VALUES(v_a.m_uid,v_a.id,'mission',v_points,'Anti-Social: three verified levels',
   jsonb_build_object('levels',3,'collaboration_post_id',v_l.post_id))
   ON CONFLICT(assignment_id,kind) WHERE assignment_id IS NOT NULL AND kind='mission' DO NOTHING;
   UPDATE public.action_mission_assignments SET status='verified',verified_at=coalesce(verified_at,now())
   WHERE id=p_assignment_id;
 END IF;
 RETURN jsonb_build_object('level',p_level,'status',p_decision,'assignment_id',p_assignment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.review_antisocial_level(uuid,smallint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_antisocial_level(uuid,smallint,text,text) TO authenticated,service_role;

-- The standard one-shot proof route must not bypass three-level verification.
CREATE OR REPLACE FUNCTION public.antisocial_block_legacy_proof()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF EXISTS(
 SELECT 1 FROM public.action_mission_assignments a
 WHERE a.id=NEW.assignment_id AND a.mission_id='a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid
 ) THEN RAISE EXCEPTION 'submit Anti-Social levels through the level workflow'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS antisocial_no_legacy_proof ON public.action_proofs;
CREATE TRIGGER antisocial_no_legacy_proof BEFORE INSERT OR UPDATE ON public.action_proofs
FOR EACH ROW EXECUTE FUNCTION public.antisocial_block_legacy_proof();

-- A publicly viewable, verified credit on BOTH profiles. A collaborator is
-- never publicly credited until they themselves submitted the reciprocal post
-- and both submissions passed desk review. Private proofs are not returned.
CREATE OR REPLACE FUNCTION public.antisocial_public_collaborations(p_member_m_uid uuid)
RETURNS TABLE(post_id uuid,collaborator_m_uid uuid,collaborator_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT own.post_id,
   CASE WHEN np.visibility='public' AND np.discoverable THEN other_assignment.m_uid ELSE NULL END,
   CASE WHEN np.visibility='public' AND np.discoverable THEN np.display_name ELSE 'Action Network member' END
 FROM public.action_antisocial_levels own
 JOIN public.action_mission_assignments mine ON mine.id=own.assignment_id
 JOIN public.network_profiles own_profile ON own_profile.m_uid=mine.m_uid
   AND own_profile.visibility='public' AND own_profile.discoverable
 JOIN public.action_antisocial_levels other ON other.post_id=own.post_id
   AND other.level=3 AND other.assignment_id<>own.assignment_id
 JOIN public.action_mission_assignments other_assignment ON other_assignment.id=other.assignment_id
 LEFT JOIN public.network_profiles np ON np.m_uid=other_assignment.m_uid
 JOIN public.network_posts post ON post.id=own.post_id
 WHERE own.level=3 AND own.status='verified' AND other.status='verified'
   AND mine.status='verified' AND other_assignment.status='verified'
   AND mine.m_uid=p_member_m_uid
   AND own.collaborator_m_uid=other_assignment.m_uid
   AND other.collaborator_m_uid=mine.m_uid
   AND post.visibility='public' AND post.deleted_at IS NULL AND post.removed_at IS NULL
   AND post.author_m_uid IN (mine.m_uid,other_assignment.m_uid);
$$;
REVOKE ALL ON FUNCTION public.antisocial_public_collaborations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.antisocial_public_collaborations(uuid) TO anon,authenticated,service_role;
