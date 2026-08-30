-- ============================================================
-- THE FULL TARGET MAP — every payable lane, in the database.
-- Run AFTER docs/the-vault-ids.sql. Safe to re-run.
--
-- Written from docs/the-onboarding-playbook.md so the desk can rank
-- lanes by what they actually return, and never offer a push to a
-- place with no door.
-- ============================================================

alter table public.vault_targets
  add column if not exists lane          text,        -- microstock | editorial | premium | aggregator | social | direct
  add column if not exists cut_low       numeric,     -- your share, low end
  add column if not exists cut_high      numeric,
  add column if not exists needs_release boolean default true,  -- commercial lanes do
  add column if not exists host          text,        -- the SFTP/FTP hostname, once known
  add column if not exists onboarded     boolean default false,
  add column if not exists priority      int default 50;        -- lower = do it sooner

-- the rail check gains 'portal' as a distinct value from 'portal-only'
alter table public.vault_targets drop constraint if exists vault_targets_rail_check;
alter table public.vault_targets add constraint vault_targets_rail_check
  check (rail in ('api','sftp','ftp','portal-only','manual','portal'));

-- ---------- MICROSTOCK: commercial, releases required, non-exclusive ----------
insert into public.vault_targets (id, label, takes, rail, lane, cut_low, cut_high, needs_release, priority, needs, notes) values
 ('adobe-stock','Adobe Stock','both','sftp','microstock',0.33,0.35,true,10,
  'Contributor account, W-9, PayPal/Skrill ($25 min), 10-image test, then request SFTP',
  'Best-paying microstock and the biggest buyer base. Start here.'),
 ('shutterstock','Shutterstock','both','ftp','microstock',0.15,0.40,true,20,
  'Account, ID verification, W-9, 10-image quality test, then request FTP',
  'Volume leader. Low per-sale, high frequency.'),
 ('dreamstime','Dreamstime','both','ftp','microstock',0.25,0.60,true,30,
  'Account, tax form, test upload, FTP credentials',
  'Rate rises with loyalty and sales level. Has a real editorial section.'),
 ('123rf','123RF','both','ftp','microstock',0.30,0.60,true,32,
  'Account, tax form, FTP credentials','Accepts editorial too.'),
 ('depositphotos','Depositphotos','both','ftp','microstock',0.34,0.42,true,34,
  'Account, tax form, exam, FTP','Owns Vecteezy — one submission, two shopfronts.'),
 ('pond5','Pond5','both','ftp','microstock',0.40,0.40,true,36,
  'Account, tax form, FTP','VIDEO-FIRST and you set your own price. Best video market outside Adobe.'),
 ('zoonar','Zoonar','both','ftp','microstock',0.50,0.50,true,40,
  'Account, tax form, FTP','German. Distributes onward to further agencies.'),
 ('panthermedia','PantherMedia','both','ftp','microstock',0.30,0.50,true,42,
  'Account, tax form, FTP','German/European buyers.'),
 ('clipdealer','ClipDealer','both','ftp','microstock',0.50,0.50,true,44,
  'Account, tax form, FTP','European. Photo, video and audio.'),
 ('scanstock','ScanStockPhoto','both','ftp','microstock',0.50,0.50,true,46,
  'Account, tax form, FTP','Scandinavian.'),
 ('stockfresh','StockFresh','photo','ftp','microstock',0.50,0.50,true,48,
  'Account, tax form, FTP','Small, high split.'),
 ('mostphotos','MostPhotos','photo','ftp','microstock',0.50,0.50,true,50,
  'Account, tax form, FTP','Swedish, flat pricing.'),
 ('yayimages','YayImages','photo','ftp','microstock',0.50,0.50,true,52,
  'Account, tax form, FTP','Subscription model.'),
 ('colourbox','Colourbox','both','ftp','microstock',0.30,0.50,true,54,
  'Account, tax form, FTP','Danish. Strong Nordic corporate buyers.'),
 ('pressfoto','PressFoto','photo','ftp','microstock',0.40,0.40,true,56,
  'Account, tax form, FTP','Russian/CIS market.'),
 ('pixta','PIXTA','both','ftp','microstock',0.22,0.58,true,38,
  'Account, tax form, test upload','JAPAN. Very little Western competition — genuinely underserved.'),
 ('vecteezy','Vecteezy','both','portal','microstock',0.30,0.50,true,58,
  'Account (or arrives via Depositphotos)','Free + pro tiers, large traffic.'),
 ('motionelements','MotionElements','both','ftp','microstock',0.50,0.50,true,60,
  'Account, tax form, FTP','Asia-Pacific, video-strong.'),
 ('storyblocks','Storyblocks','both','portal','microstock',0.30,0.50,true,62,
  'Contributor application','Subscription revenue share.'),
 ('envato','Envato Elements / PhotoDune','both','portal','microstock',0.25,0.50,true,64,
  'Author account','Pool-based payout, big subscriber base.'),
 ('motionarray','Motion Array','video','portal','microstock',0.50,0.50,true,66,
  'Contributor account','Video and templates.'),
 ('videvo','Videvo','video','portal','microstock',0.50,0.50,true,68,
  'Contributor account','Video.'),
 ('istock-esp','Getty Images / iStock (ESP)','both','portal-only','microstock',0.15,0.45,true,70,
  'Application + portfolio review at istockphoto.com/workwithus. CHOOSE NON-EXCLUSIVE',
  'Editorial, video and illustration go through ESP, not the phone app. Exclusive pays more but locks every other lane on this list — almost always the wrong trade.')
on conflict (id) do update set
  lane = excluded.lane, cut_low = excluded.cut_low, cut_high = excluded.cut_high,
  needs_release = excluded.needs_release, priority = excluded.priority,
  needs = excluded.needs, notes = excluded.notes;

-- ---------- EDITORIAL: no model release needed. THIS IS THE LANE. ----------
insert into public.vault_targets (id, label, takes, rail, lane, cut_low, cut_high, needs_release, priority, needs, notes) values
 ('alamy','Alamy','both','ftp','editorial',0.20,0.40,false,5,
  'Account, tax form, 3-image QC test, then ENABLE LIVE NEWS in settings',
  'Commission cut to 20% under $3k/yr from 1 Sep 2026 — but Live News images sell for MORE than regular stock, and editorial needs no release. Highest-value single switch on the list.'),
 ('local-press','Local publications (direct)','both','manual','editorial',1.00,1.00,false,1,
  'An email to the photo editor with the catalog id and wire caption',
  'Decaturish, Rough Draft Atlanta, On Common Ground News, The Atlanta Voice, AJC all covered Candler. $75-150 a frame beats 300 microstock downloads AND builds the byline that makes the wires say yes. You keep 100%.'),
 ('zuma','ZUMA Press','both','ftp','editorial',0.40,0.60,false,6,
  'Photographer registration at zumapress.com, portfolio review',
  'US independent wire, 2,100+ photographers, 100+ newspaper archives.'),
 ('sipa-usa','SIPA USA','both','ftp','editorial',0.40,0.50,false,7,
  'Contributing photographer application','French wire, distributes to 40+ countries. Often handled alongside ZUMA.'),
 ('nurphoto','NurPhoto','both','ftp','editorial',0.40,0.50,false,8,
  'Application at nurphoto.com','Breaking news and documentary. Actively recruits stringers.'),
 ('sopa','SOPA Images','both','ftp','editorial',0.40,0.50,false,12,
  'Contributor application','News and features, strong Asia + US.'),
 ('imago','Imago','both','ftp','editorial',0.30,0.50,false,14,
  'Contributor application','Large German agency, sports and news.'),
 ('pacific-press','Pacific Press Agency','both','ftp','editorial',0.40,0.50,false,16,
  'Application','News, protests, civic events.'),
 ('lightrocket','LightRocket','both','portal','editorial',0.40,0.50,false,18,
  'Application','Documentary and editorial collective.'),
 ('anadolu','Anadolu Images','both','ftp','editorial',0.30,0.50,false,22,
  'Stringer application','Global news.'),
 ('newscom','Newscom','both','ftp','editorial',0.30,0.50,false,24,
  'Contributor enquiry','Aggregator/distributor into US publications.'),
 ('cover-images','Cover Images','both','ftp','editorial',0.40,0.50,false,26,
  'Application','Features and news, UK-based.'),
 ('imagn','Imagn (USA Today Network)','both','ftp','editorial',0.30,0.50,false,28,
  'Credentialled sports shooters','SPORTS.'),
 ('icon-sportswire','Icon Sportswire','both','ftp','editorial',0.30,0.50,false,29,
  'Application + credentials','SPORTS.'),
 ('ap-images','AP Images','both','portal-only','editorial',0.40,0.50,false,31,
  'Contributor/stringer relationship','The wire. Hard door, real money.'),
 ('getty-editorial','Getty Editorial','both','portal-only','editorial',0.15,0.45,false,33,
  'Via ESP, separate track from iStock','Assignment plus contributor.'),
 ('shutterstock-editorial','Shutterstock Editorial','both','ftp','editorial',0.15,0.40,false,35,
  'Editorial contributor application','Formerly Rex Features. News and entertainment.')
on conflict (id) do update set
  lane = excluded.lane, cut_low = excluded.cut_low, cut_high = excluded.cut_high,
  needs_release = excluded.needs_release, priority = excluded.priority,
  needs = excluded.needs, notes = excluded.notes;

-- ---------- PREMIUM / CURATED: apply when the book is strong ----------
insert into public.vault_targets (id, label, takes, rail, lane, cut_low, cut_high, needs_release, priority, needs, notes) values
 ('stocksy','Stocksy United','both','portal','premium',0.50,0.75,true,80,
  'Invite/application only, opens in windows',
  'Artist co-op — you become a member and shareholder. THE best rate in the industry. Notoriously selective.'),
 ('westend61','Westend61','both','portal','premium',0.50,0.50,true,82,
  'Application','Curated German agency.'),
 ('offset','Offset (Shutterstock)','photo','portal','premium',0.30,0.50,true,84,
  'Invitation','Premium tier.'),
 ('cavan','Cavan Images','photo','portal','premium',0.50,0.50,true,86,
  'Application','Authentic/lifestyle focus.'),
 ('redux','Redux Pictures','photo','portal','premium',0.50,0.50,false,88,
  'Application','Editorial and portrait representation.')
on conflict (id) do update set
  lane = excluded.lane, cut_low = excluded.cut_low, cut_high = excluded.cut_high,
  needs_release = excluded.needs_release, priority = excluded.priority,
  needs = excluded.needs, notes = excluded.notes;

-- ---------- AGGREGATORS: they fan out, they take a cut ----------
insert into public.vault_targets (id, label, takes, rail, lane, cut_low, cut_high, needs_release, priority, needs, notes) values
 ('wirestock','Wirestock','both','api','aggregator',0.85,0.85,true,72,
  'Account',
  'Takes 15% of royalties. Reaches Shutterstock, Adobe, Alamy, Dreamstime, Pond5, Depositphotos, 123RF, Freepik, Canva, Getty/iStock, Science Photo Library. USE ONLY for Canva/Freepik/SPL — paying 15% forever to reach Adobe is money burned when you hold the SFTP credentials yourself.'),
 ('blackbox','BlackBox','video','portal','aggregator',0.85,0.85,true,74,
  'Account','VIDEO ONLY, no photos. 15%.')
on conflict (id) do update set
  lane = excluded.lane, cut_low = excluded.cut_low, cut_high = excluded.cut_high,
  needs_release = excluded.needs_release, priority = excluded.priority,
  needs = excluded.needs, notes = excluded.notes;

-- ---------- the desk's working view: what to do next, ranked ----------
create or replace view public.vault_next_lanes as
  select priority, lane, label, rail, takes,
         (cut_low * 100)::int || '-' || (cut_high * 100)::int || '%' as your_cut,
         case when needs_release then 'release required' else 'editorial — no release' end as rights,
         onboarded, needs
  from public.vault_targets
  where not onboarded
  order by priority, label;

select 'targets loaded' as status,
  count(*) filter (where lane = 'microstock') as microstock,
  count(*) filter (where lane = 'editorial')  as editorial,
  count(*) filter (where lane = 'premium')    as premium,
  count(*) filter (where lane = 'aggregator') as aggregator,
  count(*) filter (where rail in ('sftp','ftp')) as bulk_drop_lanes,
  count(*) as total
from public.vault_targets;
