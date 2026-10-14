-- Public, link-only resource directory; no private referrals or personal case data.
CREATE TABLE IF NOT EXISTS public.action_resource_sources (
  slug text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK(category IN ('social_services','recycling','black_business')),
  country_codes text[] NOT NULL DEFAULT '{}',
  directory_url text NOT NULL CHECK(directory_url LIKE 'https://%'),
  official_url text NOT NULL CHECK(official_url LIKE 'https://%'),
  integration_status text NOT NULL DEFAULT 'link_only'
    CHECK(integration_status IN ('link_only','permission_requested','licensed_api','connected')),
  notes text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.action_resource_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_resource_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.action_resource_sources TO anon, authenticated;
GRANT ALL ON public.action_resource_sources TO service_role;
CREATE POLICY "public can read curated resource sources"
ON public.action_resource_sources FOR SELECT TO anon,authenticated
USING(published);
CREATE POLICY "owner manages resource sources"
ON public.action_resource_sources FOR ALL TO authenticated
USING((SELECT public.eu_is_admin()))
WITH CHECK((SELECT public.eu_is_admin()));
GRANT INSERT,UPDATE,DELETE ON public.action_resource_sources TO authenticated;

INSERT INTO public.action_resource_sources
  (slug,name,category,country_codes,directory_url,official_url,integration_status,notes)
VALUES
  ('united-way-211-us','United Way 211 (US)','social_services',ARRAY['US'],
   'https://www.211.org/','https://www.unitedway.org/our-impact/community-resiliency/211','link_only',
   'National resource navigation. API access requires 211 authorization; no data licensed here.'),
  ('211-canada','211 Canada','social_services',ARRAY['CA'],
   'https://211.ca/','https://211.ca/','link_only',
   'National resource navigation; select the provincial or local provider.'),
  ('findhelp','Findhelp','social_services',ARRAY['US'],
   'https://www.findhelp.org/','https://company.findhelp.com/solutions/partnerships/integrations/','link_only',
   'Integration APIs require commercial partnership and permission.'),
  ('turn2us','Turn2us Find an Adviser','social_services',ARRAY['GB'],
   'https://www.turn2us.org.uk/get-support/using-find-an-adviser','https://www.turn2us.org.uk/','link_only',
   'UK service-navigation directory; do not scrape.'),
  ('ask-izzy','Ask Izzy','social_services',ARRAY['AU'],
   'https://askizzy.org.au/','https://about.askizzy.org.au/about/','link_only',
   'Australia resource-navigation service; do not scrape.'),
  ('ifrc-national-societies','IFRC National Societies','social_services',ARRAY[]::text[],
   'https://www.ifrc.org/national-societies-directory/0','https://www.ifrc.org/','link_only',
   'Directory of 191 Red Cross and Red Crescent national societies; local services differ and are not guaranteed.'),
  ('unhcr-help','UNHCR Help by Country','social_services',ARRAY[]::text[],
   'https://help.unhcr.org/countries/','https://help.unhcr.org/','link_only',
   'Country-specific assistance for refugees, asylum-seekers and stateless people; not a universal welfare directory.'),
  ('find-a-helpline','Find A Helpline','social_services',ARRAY[]::text[],
   'https://findahelpline.com/','https://findahelpline.com/','link_only',
   'Verified emotional-support helplines in many countries; specialist support, not a general services directory.'),
  ('r2-facilities','R2 Certified Facilities (SERI)','recycling',ARRAY[]::text[],
   'https://sustainableelectronics.org/find-an-r2-certified-facility/','https://sustainableelectronics.org/','link_only',
   'International facility certification directory; confirm consumer drop-off and accepted items.'),
  ('e-stewards','e-Stewards Certified Recyclers','recycling',ARRAY[]::text[],
   'https://e-stewards.org/find-a-processor/','https://e-stewards.org/','link_only',
   'International certified processors; verify consumer drop-off before routing.'),
  ('byblack','ByBlack / US Black Chambers','black_business',ARRAY['US'],
   'https://www.byblack.us/','https://usblackchambers.org/','link_only',
   'National directory; ownership/certification status must come from authorized data.'),
  ('black-business-green-book','Black Business Green Book','black_business',ARRAY['US'],
   'https://www.blackbusinessgreenbook.com/','https://www.blackbusinessgreenbook.com/','link_only',
   'Public directory link only; no redistribution license established.')
ON CONFLICT(slug) DO UPDATE SET
  name=EXCLUDED.name,category=EXCLUDED.category,country_codes=EXCLUDED.country_codes,
  directory_url=EXCLUDED.directory_url,official_url=EXCLUDED.official_url,
  notes=EXCLUDED.notes,updated_at=now();

-- No personal service/referral case data is stored in this directory table.
-- Future referrals must be private, consented, abuse-resistant, and never
-- publicly exposed through mission proofs or feed shares.
