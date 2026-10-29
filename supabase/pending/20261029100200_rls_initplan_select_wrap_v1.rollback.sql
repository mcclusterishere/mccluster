-- Rollback of supabase/pending/20261029100200_rls_initplan_select_wrap_v1.sql: the 71
-- policy expressions exactly as production had them on 2026-10-29 (the forward file with
-- the three sub-selects unwrapped; md5 prefixes equal the 2026-10-28 evidence).

set local lock_timeout = '5s';
set local search_path = public, pg_temp;

alter policy cp_admin on public.campaigns
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy cm_speak on public.comments
  with check ((uid = auth.uid()));
alter policy cm_sweep on public.comments
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy cm_take_back on public.comments
  using (((uid = auth.uid()) OR ((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text)));
alter policy control_approvals_decide on public.control_approvals
  using (private.is_org_owner(org_id))
  with check ((private.is_org_owner(org_id) AND (decided_by = auth.uid()) AND (state = ANY (ARRAY['approved'::text, 'denied'::text]))));
alter policy control_approvals_request on public.control_approvals
  with check (((requested_by = auth.uid()) AND private.is_org_member(org_id) AND (state = 'pending'::text) AND (decided_by IS NULL)));
alter policy creator_service_delete on public.creator_service_offers
  using (((auth.uid() IS NOT NULL) AND (m_uid = current_m_uid())));
alter policy creator_service_insert on public.creator_service_offers
  with check (((auth.uid() IS NOT NULL) AND (m_uid = current_m_uid())));
alter policy creator_service_read on public.creator_service_offers
  using ((((status = 'published'::text) AND (EXISTS ( SELECT 1
   FROM network_profiles p
  WHERE ((p.m_uid = creator_service_offers.m_uid) AND (p.visibility = 'public'::text))))) OR ((auth.uid() IS NOT NULL) AND (m_uid = current_m_uid()))));
alter policy creator_service_update on public.creator_service_offers
  using (((auth.uid() IS NOT NULL) AND (m_uid = current_m_uid())))
  with check (((auth.uid() IS NOT NULL) AND (m_uid = current_m_uid())));
alter policy music_creator_tracks_insert on public.creator_tracks
  with check (((m_uid = current_m_uid()) AND (uid = auth.uid())));
alter policy engm_admin on public.engagement_modules
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy eng_admin on public.engagements
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy eu_applications_mine on public.eu_applications
  using (((profile_id = auth.uid()) OR eu_is_admin()))
  with check (((profile_id = auth.uid()) OR eu_is_admin()));
alter policy eu_campaigns_draft on public.eu_campaigns
  with check ((eu_is_admin() OR (eu_is_staff() AND (status = 'draft'::text) AND (created_by = auth.uid()))));
alter policy eu_claim_evidence_read on public.eu_claim_evidence
  using ((EXISTS ( SELECT 1
   FROM (eu_claims c
     JOIN eu_research_projects p ON ((p.id = c.research_project_id)))
  WHERE ((c.id = eu_claim_evidence.claim_id) AND (is_org_member(p.org_id) OR (EXISTS ( SELECT 1
           FROM (eu_research_members rm
             JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
          WHERE ((rm.research_project_id = p.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))))));
alter policy eu_claims_read on public.eu_claims
  using ((EXISTS ( SELECT 1
   FROM eu_research_projects p
  WHERE ((p.id = eu_claims.research_project_id) AND (is_org_member(p.org_id) OR (EXISTS ( SELECT 1
           FROM (eu_research_members rm
             JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
          WHERE ((rm.research_project_id = p.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))))));
alter policy eu_conversations_read on public.eu_conversations
  using (((profile_id = auth.uid()) OR eu_is_staff()));
alter policy eu_fellowship_app_read on public.eu_fellowship_applications
  using ((is_org_member(org_id) OR ((m_uid IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM m_auth_user_links l
  WHERE ((l.auth_user_id = auth.uid()) AND (l.m_uid = eu_fellowship_applications.m_uid)))))));
alter policy eu_fellowships_edit on public.eu_fellowships
  using ((eu_is_staff() OR (created_by = auth.uid()) OR (org_profile_id = auth.uid())))
  with check ((eu_is_staff() OR (created_by = auth.uid()) OR (org_profile_id = auth.uid())));
alter policy eu_fellowships_host_add on public.eu_fellowships
  with check ((eu_is_staff() OR ((eu_role() = ANY (ARRAY['host'::text, 'member'::text])) AND (created_by = auth.uid()) AND (status = 'pending'::text) AND (source = 'host'::text))));
alter policy eu_fellowships_read on public.eu_fellowships
  using (((status = 'published'::text) OR eu_is_staff() OR (created_by = auth.uid()) OR (org_profile_id = auth.uid())));
alter policy eu_initiative_members_read on public.eu_initiative_members
  using (((EXISTS ( SELECT 1
   FROM eu_initiatives i
  WHERE ((i.id = eu_initiative_members.initiative_id) AND is_org_member(i.org_id)))) OR (EXISTS ( SELECT 1
   FROM m_auth_user_links l
  WHERE ((l.auth_user_id = auth.uid()) AND (l.m_uid = eu_initiative_members.m_uid))))));
alter policy eu_manuscript_sections_read on public.eu_manuscript_sections
  using ((EXISTS ( SELECT 1
   FROM (eu_manuscripts m
     JOIN eu_research_projects p ON ((p.id = m.research_project_id)))
  WHERE ((m.id = eu_manuscript_sections.manuscript_id) AND (is_org_member(p.org_id) OR (EXISTS ( SELECT 1
           FROM (eu_research_members rm
             JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
          WHERE ((rm.research_project_id = p.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))))));
alter policy eu_manuscripts_read on public.eu_manuscripts
  using ((is_org_member(org_id) OR (EXISTS ( SELECT 1
   FROM (eu_research_members rm
     JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
  WHERE ((rm.research_project_id = eu_manuscripts.research_project_id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid()))))));
alter policy eu_messages_human on public.eu_messages
  with check ((eu_is_staff() AND (role = 'human'::text) AND (author_id = auth.uid())));
alter policy eu_messages_read on public.eu_messages
  using ((eu_is_staff() OR (EXISTS ( SELECT 1
   FROM eu_conversations c
  WHERE ((c.id = eu_messages.conversation_id) AND (c.profile_id = auth.uid()))))));
alter policy eu_oauth_connections_read on public.eu_oauth_connections
  using ((is_org_owner(org_id) OR ((m_uid IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM m_auth_user_links l
  WHERE ((l.auth_user_id = auth.uid()) AND (l.m_uid = eu_oauth_connections.m_uid)))))));
alter policy eu_perspectives_in on public.eu_perspectives
  with check (((status = 'new'::text) AND ((profile_id IS NULL) OR (profile_id = auth.uid())) AND (length(body) <= 8000)));
alter policy eu_perspectives_mine on public.eu_perspectives
  using (((profile_id = auth.uid()) OR eu_is_staff()));
alter policy eu_contact_self on public.eu_profile_contact
  using (((id = auth.uid()) OR eu_is_admin()))
  with check (((id = auth.uid()) OR eu_is_admin()));
alter policy eu_profiles_mine_edit on public.eu_profiles
  using (((id = auth.uid()) OR eu_is_admin()))
  with check (((id = auth.uid()) OR eu_is_admin()));
alter policy eu_profiles_mine_new on public.eu_profiles
  with check ((id = auth.uid()));
alter policy eu_profiles_read on public.eu_profiles
  using (((id = auth.uid()) OR eu_is_staff() OR ((visibility = 'public'::text) AND (status = 'active'::text))));
alter policy eu_research_members_read on public.eu_research_members
  using (((EXISTS ( SELECT 1
   FROM eu_research_projects p
  WHERE ((p.id = eu_research_members.research_project_id) AND is_org_member(p.org_id)))) OR (EXISTS ( SELECT 1
   FROM m_auth_user_links l
  WHERE ((l.auth_user_id = auth.uid()) AND (l.m_uid = eu_research_members.m_uid))))));
alter policy eu_research_projects_read on public.eu_research_projects
  using (((visibility = 'public'::text) OR is_org_member(org_id) OR ((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (eu_research_members rm
     JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
  WHERE ((rm.research_project_id = eu_research_projects.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))));
alter policy eu_review_comments_read on public.eu_review_comments
  using ((is_org_member(org_id) OR (EXISTS ( SELECT 1
   FROM ((eu_manuscripts m
     JOIN eu_research_members rm ON ((rm.research_project_id = m.research_project_id)))
     JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
  WHERE ((m.id = eu_review_comments.manuscript_id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid()))))));
alter policy eu_saves_mine on public.eu_saves
  using ((profile_id = auth.uid()))
  with check ((profile_id = auth.uid()));
alter policy eu_section_revisions_read on public.eu_section_revisions
  using ((EXISTS ( SELECT 1
   FROM ((eu_manuscript_sections s
     JOIN eu_manuscripts m ON ((m.id = s.manuscript_id)))
     JOIN eu_research_projects p ON ((p.id = m.research_project_id)))
  WHERE ((s.id = eu_section_revisions.section_id) AND (is_org_member(p.org_id) OR (EXISTS ( SELECT 1
           FROM (eu_research_members rm
             JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
          WHERE ((rm.research_project_id = p.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))))));
alter policy eu_sources_read on public.eu_sources
  using ((EXISTS ( SELECT 1
   FROM eu_research_projects p
  WHERE ((p.id = eu_sources.research_project_id) AND (is_org_member(p.org_id) OR (EXISTS ( SELECT 1
           FROM (eu_research_members rm
             JOIN m_auth_user_links l ON ((l.m_uid = rm.m_uid)))
          WHERE ((rm.research_project_id = p.id) AND (rm.status = 'active'::text) AND (l.auth_user_id = auth.uid())))))))));
alter policy "analytics owners read site events" on public.events
  using (((site_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM analytics_sites s
  WHERE ((s.id = events.site_id) AND ((s.owner_user_id = auth.uid()) OR ((s.org_id IS NOT NULL) AND private.is_org_member(s.org_id)) OR ((s.site_account_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM site_accounts a
          WHERE ((a.id = s.site_account_id) AND (a.user_id = auth.uid())))))))))));
alter policy fan_profiles_insert_self on public.fan_profiles
  with check ((user_id = auth.uid()));
alter policy fan_profiles_read_self on public.fan_profiles
  using ((user_id = auth.uid()));
alter policy fan_profiles_update_self on public.fan_profiles
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
alter policy leads_desk on public.leads
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy leads_work on public.leads
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy ls_admin on public.licence_scopes
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy md_admin on public.modules
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy music_entitlements_read on public.music_entitlements
  using ((user_id = auth.uid()));
alter policy music_orders_read on public.music_orders
  using (((customer_user_id = auth.uid()) OR (creator_m_uid = current_m_uid())));
alter policy network_activity_read on public.network_activity
  using (((visibility = 'public'::text) OR (actor_m_uid = current_m_uid()) OR ((visibility = 'network'::text) AND (EXISTS ( SELECT 1
   FROM network_follows f
  WHERE ((f.follower_m_uid = current_m_uid()) AND (f.followed_m_uid = network_activity.actor_m_uid) AND (f.status = 'following'::text))))) OR ((visibility = 'org'::text) AND (source_org_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM org_members om
  WHERE ((om.org_id = network_activity.source_org_id) AND (om.profile_id = auth.uid())))))));
alter policy network_feed_items_auth_read on public.network_feed_items
  using (((visibility = 'public'::text) OR (actor_m_uid = current_m_uid()) OR ((visibility = ANY (ARRAY['network'::text, 'followers'::text])) AND (EXISTS ( SELECT 1
   FROM network_follows nf
  WHERE ((nf.follower_m_uid = current_m_uid()) AND (nf.followed_m_uid = network_feed_items.actor_m_uid) AND (nf.status = 'following'::text))))) OR ((visibility = 'org'::text) AND (source_org_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM org_members om
  WHERE ((om.org_id = network_feed_items.source_org_id) AND (om.profile_id = auth.uid())))))));
alter policy of_admin on public.offerings
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text))
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy platform_ledger_read on public.platform_ledger
  using (((payer_user_id = auth.uid()) OR ((org_id IS NOT NULL) AND is_org_member(org_id))));
alter policy platform_user_apps_mine on public.platform_user_apps
  using (((user_id = auth.uid()) OR ((org_id IS NOT NULL) AND is_org_member(org_id))));
alter policy "prim3 progress delete own" on public.prim3_course_progress
  using ((auth.uid() = user_id));
alter policy "prim3 progress insert own" on public.prim3_course_progress
  with check ((auth.uid() = user_id));
alter policy "prim3 progress select own" on public.prim3_course_progress
  using ((auth.uid() = user_id));
alter policy "prim3 progress update own" on public.prim3_course_progress
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
alter policy po_desk on public.print_orders
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy po_work on public.print_orders
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy providers_claim on public.providers
  with check ((uid = auth.uid()));
alter policy providers_edit on public.providers
  using ((uid = auth.uid()));
alter policy rf_ins on public.rights_flags
  with check (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy rf_upd on public.rights_flags
  using (((auth.jwt() ->> 'email'::text) = 'matthew@mccluster.org'::text));
alter policy shake_crew_read on public.shake_crew
  using (((profile_id = auth.uid()) OR eu_is_admin()));
alter policy shake_events_read on public.shake_order_events
  using ((shake_is_crew() OR (EXISTS ( SELECT 1
   FROM shake_orders o
  WHERE ((o.id = shake_order_events.order_id) AND (o.profile_id = auth.uid()))))));
alter policy shake_orders_mine on public.shake_orders
  using (((profile_id = auth.uid()) OR shake_is_crew()));
alter policy "clients read their own site" on public.site_accounts
  using ((user_id = auth.uid()));
alter policy "clients file their own requests" on public.site_requests
  with check ((user_id = auth.uid()));
alter policy "clients read their own requests" on public.site_requests
  using ((user_id = auth.uid()));

