BEGIN;

-- Public facts were collected from the church's existing site on 2026-08-10.
-- Everything is seeded as DRAFT and marked for client confirmation before publication.

WITH s AS (
  SELECT ps.id FROM platform_sites ps
  JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'church-info','contact','Contact','draft',
  '{"address":"2813 East Point Street, East Point, GA 30344","phone":"404-762-9451","email":"OFFICE@FBCEPGA.ORG","sourceUrl":"https://firstbaptistchurcheastpoint.org/","needsClientConfirmation":true}'::jsonb,10 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'church-info','service-times','Service Times','draft',
  '{"sundayBibleStudy":"9:30 AM","sundayWorship":"11:00 AM","wednesdayPrayer":"6:00 PM","wednesdayBibleStudy":"6:30 PM","sourceUrl":"https://firstbaptistchurcheastpoint.org/","needsClientConfirmation":true}'::jsonb,20 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'church-info','pastor','Pastor','draft',
  '{"name":"Rev. Kamau I. Welcher","role":"Senior Pastor","sourceUrl":"https://firstbaptistchurcheastpoint.org/","needsClientConfirmation":true}'::jsonb,30 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'giving','current-methods','Current Giving Methods','draft',
  '{"methods":[{"type":"text","instruction":"Text FBCEP to 73256"},{"type":"online","label":"PayPal / Debit / Credit Card"},{"type":"cashapp","handle":"$fbcepga"},{"type":"mail","address":"2813 East Point Street, East Point, GA 30344"}],"migrationRule":"Preserve existing giving rails at launch unless church leadership explicitly approves a change.","sourceUrl":"https://firstbaptistchurcheastpoint.org/give/","needsClientConfirmation":true}'::jsonb,10 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'ministry','public-ministry-list','Ministries','draft',
  '{"items":["Youth Ministry","Youth Puppet Ministry / Hands Up for Christ","Young Adult Ministry / Wings of Faith","Seasoned Adult Ministry","Music Ministry","Veterans Ministry","Stephen’s Ministry","Health and Wellness","Sewing","Sack Lunches","Clothing Boutique","Outreach Ministry"],"sourceUrl":"https://firstbaptistchurcheastpoint.org/","needsClientConfirmation":true}'::jsonb,10 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
)
INSERT INTO platform_content_items(site_id,type,slug,title,status,data,sort_order)
SELECT s.id,'brand','mission-vision','Mission and Vision','draft',
  '{"visionSummary":"Love God and one another; grow as a loving, thriving body of lifelong learners serving God’s people.","missionPoints":["Evangelizing and making disciples","Educating and equipping the community through Biblical principles","Empowering Christians to serve"],"sourceUrl":"https://firstbaptistchurcheastpoint.org/","needsClientConfirmation":true}'::jsonb,10 FROM s
ON CONFLICT(site_id,type,slug) DO UPDATE SET data=excluded.data,updated_at=now();

-- Draft page skeleton for the redesign. These are CMS structure, not final copy or design.
WITH s AS (
  SELECT ps.id FROM platform_sites ps JOIN platform_tenants t ON t.id=ps.tenant_id
  WHERE t.slug='first-baptist-east-point' AND ps.slug='first-baptist-east-point'
), p(slug,title,blocks) AS (
  VALUES
    ('home','Home','[{"type":"hero","intent":"welcome + next service + primary actions"},{"type":"next-step","intent":"New Here"},{"type":"live","intent":"current/next livestream"},{"type":"events","intent":"upcoming events"},{"type":"giving","intent":"giving shortcut"}]'::jsonb),
    ('new-here','New Here','[{"type":"welcome"},{"type":"service-times"},{"type":"what-to-expect"},{"type":"directions"},{"type":"connect-form"}]'::jsonb),
    ('worship-live','Worship + Live','[{"type":"livestream"},{"type":"service-times"},{"type":"recent-services"}]'::jsonb),
    ('give','Give','[{"type":"giving-methods"},{"type":"stewardship-copy"}]'::jsonb),
    ('ministries','Ministries','[{"type":"ministry-directory"},{"type":"serve-cta"}]'::jsonb),
    ('events','Events','[{"type":"event-feed"},{"type":"rsvp"}]'::jsonb),
    ('prayer','Prayer','[{"type":"prayer-intro"},{"type":"prayer-request-form"}]'::jsonb),
    ('contact','Contact','[{"type":"contact"},{"type":"map"},{"type":"office-hours"}]'::jsonb)
)
INSERT INTO platform_pages(site_id,slug,title,status,blocks,seo)
SELECT s.id,p.slug,p.title,'draft',p.blocks,jsonb_build_object('source','seed-2026-08-10','needsClientConfirmation',true)
FROM s CROSS JOIN p
ON CONFLICT(site_id,slug) DO UPDATE SET title=excluded.title,blocks=excluded.blocks,seo=excluded.seo,updated_at=now();

COMMIT;
