BEGIN;

INSERT INTO platform_tenants(slug,legal_name,display_name,kind,status,owner_name,owner_email,metadata)
VALUES (
  'jay-johnson',
  'Jay Johnson',
  'Jay Johnson',
  'individual',
  'active',
  'Jay Johnson',
  NULL,
  '{"city":"Atlanta","origin":"Chicago","site":"https://jnhelevate.com/","repo":"mcclusterishere/Welgen","plan":"web","planStatus":"active","layer":"mccluster"}'::jsonb
) ON CONFLICT(slug) DO UPDATE SET
  display_name=excluded.display_name,
  status='active',
  metadata=platform_tenants.metadata || excluded.metadata,
  updated_at=now();

INSERT INTO platform_sites(tenant_id,slug,name,status,primary_domain,deployment_provider,settings)
SELECT id,'jay-johnson','Jay Johnson','live','jnhelevate.com','github-pages',
  '{"appMode":"pwa","editor":"/admin","plan":"web","planStatus":"active"}'::jsonb
FROM platform_tenants WHERE slug='jay-johnson'
ON CONFLICT(tenant_id,slug) DO UPDATE SET
  status='live',
  primary_domain='jnhelevate.com',
  settings=platform_sites.settings || excluded.settings,
  updated_at=now();

INSERT INTO platform_pages(site_id,slug,title,status,blocks,published_at)
SELECT s.id,'home','Jay Johnson','published',
  '[{"type":"hero"},{"type":"about"},{"type":"work"},{"type":"media"}]'::jsonb,
  now()
FROM platform_sites s
JOIN platform_tenants t ON t.id=s.tenant_id
WHERE t.slug='jay-johnson' AND s.slug='jay-johnson'
ON CONFLICT(site_id,slug) DO UPDATE SET status='published', updated_at=now();

INSERT INTO platform_domains(tenant_id,site_id,domain,status,metadata)
SELECT t.id,s.id,'jnhelevate.com','registered','{"clientOwned":true}'::jsonb
FROM platform_tenants t
JOIN platform_sites s ON s.tenant_id=t.id AND s.slug='jay-johnson'
WHERE t.slug='jay-johnson'
ON CONFLICT(domain) DO UPDATE SET status='registered', updated_at=now();

INSERT INTO platform_payment_accounts(tenant_id,provider,onboarding_status,deal_mode,metadata)
SELECT id,'studio','active','paid','{"plan":"web","planStatus":"active","note":"Studio-marked active membership"}'::jsonb
FROM platform_tenants WHERE slug='jay-johnson'
ON CONFLICT(tenant_id,provider) DO UPDATE SET
  onboarding_status='active',
  metadata=platform_payment_accounts.metadata || excluded.metadata,
  updated_at=now();

COMMIT;
