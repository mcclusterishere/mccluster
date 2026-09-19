-- ============================================================
-- EQUITY UPRISE — THE SEED.
--
-- Three topics and a starting directory. Separate from 0017 because
-- schema and content have different lifetimes: the schema is applied
-- once and the content is edited forever, from the desk, by people who
-- should never have to open a migration to fix a typo.
--
-- ---- ON NEUTRALITY, WHICH IS A SCHEMA REQUIREMENT HERE --------------
--
-- Equity Uprise walks down the middle of the aisle. That is not a
-- posture the copy can carry on its own — it has to survive contact
-- with the structured questions, because a loaded option list is a
-- loaded question no matter how even-handed the paragraph above it is.
--
-- The test each dimension below had to pass: could a thoughtful person
-- on either side of this find their actual view in the options, without
-- having to pick the one that insults them? Where the honest answer was
-- "people disagree about the facts too", the `context` field states
-- what is documented and stops, rather than settling it.
--
-- ---- ON THE DIRECTORY -----------------------------------------------
--
-- Every listing below is a real, long-running program, seeded with the
-- program's own name, its organization, and a link. Every one of them
-- is marked verification='unverified' and carries NO deadline, because
-- nothing here was checked against the source at seed time and a
-- directory that invents a deadline makes people miss the real one.
-- The explorer prints that state on the card. Verifying is desk work:
-- open the link, confirm it is still running, set the deadline, and
-- move verification to 'verified'.
--
-- Sweeping a source means working it BY HAND or with the source's
-- permission. ProFellow and the rest are somebody else's work product;
-- their terms govern, and "we wrote a scraper" is not a license.
--
-- PASTE: Supabase → SQL Editor → run after 0017. Idempotent: re-running
-- refreshes the topics and adds nothing twice.
-- ============================================================

-- ============================================================
-- 1. THE THREE TOPICS
-- ============================================================

insert into public.eu_topics (slug, name, tagline, description, context, dimensions, prompts, tags, resources, status, ordinal)
values
(
  'us-israel',
  'The United States and Israel',
  'One of the few subjects that splits people who agree on everything else.',
  'The United States and Israel have been close partners for decades: military aid, weapons sales, intelligence sharing, and diplomatic support. Americans disagree — sharply, and in good faith — about whether that partnership should stay as it is, change its terms, or end. People arrive at opposite conclusions from the same facts, and often from the same values. This is a place to say what you actually think and be recorded accurately.',
  'What is documented: the current framework is a ten-year memorandum of understanding signed in 2016 covering roughly $38 billion in military assistance, making Israel the largest cumulative recipient of U.S. foreign aid since the Second World War. The United States has repeatedly used its Security Council veto on resolutions concerning Israel. Public polling since 2023 shows opinion moving, with the sharpest divides by age and party. Beyond that, the disagreements are about judgment and values, and this page does not settle them.',
  '[
    {"key":"aid","label":"U.S. military aid","help":"What should happen to it?","options":[
      {"value":"increase","label":"Increase it"},
      {"value":"keep","label":"Keep it as it is"},
      {"value":"condition","label":"Keep it, but tie it to conditions"},
      {"value":"reduce","label":"Reduce it"},
      {"value":"end","label":"End it"},
      {"value":"unsure","label":"I''m still working it out"}]},
    {"key":"role","label":"The American role","help":"What should the United States be here?","options":[
      {"value":"ally-firm","label":"A firm ally, without conditions"},
      {"value":"ally-limits","label":"An ally, with limits"},
      {"value":"broker","label":"A neutral broker between both sides"},
      {"value":"step-back","label":"Less involved than we are"},
      {"value":"out","label":"Out of it entirely"},
      {"value":"unsure","label":"I''m still working it out"}]},
    {"key":"weight","label":"How much this weighs","help":"When you vote, how much does this issue count?","options":[
      {"value":"decisive","label":"It decides my vote"},
      {"value":"major","label":"One of my top issues"},
      {"value":"some","label":"It counts, among others"},
      {"value":"little","label":"Not much"}]}
  ]'::jsonb,
  '[
    "In your own words: what do you think the United States owes here, if anything?",
    "Has your view changed in the last two years? If it has, what changed it?",
    "What would you want your own representative to actually do — not the country, your representative?",
    "What is the strongest argument on the other side of where you landed?",
    "Is there anything about this you wish people would stop assuming about you?"
  ]'::jsonb,
  '{foreign-policy,human-rights,diplomacy,middle-east,peacebuilding,national-security,journalism,advocacy}',
  '[]'::jsonb,
  'active', 1
),
(
  'data-centers',
  'Data centers',
  'The buildings behind the cloud, and the towns deciding whether to take one.',
  'Data centers are the warehouses that run the internet and, lately, artificial intelligence. They are being built fast, and the decisions that matter are local: rezoning, tax abatements, a hookup to the grid, water for cooling, truck routes, noise, and what happens to the land. Some neighbors see a tax base and construction work. Others see higher electric bills, strained water, a few dozen permanent jobs, and a building nobody can walk into. Both of those can be true in different towns, and sometimes in the same one.',
  'What is documented: data centers are among the fastest-growing electricity loads in the United States, and utilities in several states have filed for rate increases citing new large-load customers. Facilities vary enormously in water use depending on their cooling design. Permanent staffing is typically small relative to construction employment and to the size of the tax abatements offered. Whether a specific project is a good deal for a specific town depends on the terms of that deal, which are usually public and usually negotiated before most residents hear about it.',
  '[
    {"key":"stance","label":"A data center proposed near you","help":"Your first instinct.","options":[
      {"value":"welcome","label":"Welcome it"},
      {"value":"conditions","label":"Welcome it, with binding conditions"},
      {"value":"depends","label":"Depends entirely on the terms"},
      {"value":"oppose","label":"Oppose it"},
      {"value":"unsure","label":"I don''t know enough yet"}]},
    {"key":"concern","label":"What matters most to you here","help":"Pick the one that weighs heaviest.","options":[
      {"value":"bills","label":"What it does to electric bills"},
      {"value":"water","label":"Water use"},
      {"value":"jobs","label":"Jobs, and what kind"},
      {"value":"taxes","label":"The tax deal the town signs"},
      {"value":"land","label":"Land, farmland, and open space"},
      {"value":"noise","label":"Noise and traffic"},
      {"value":"climate","label":"Emissions and climate"},
      {"value":"none","label":"None of these worry me"}]},
    {"key":"process","label":"How the decision gets made","help":"Separate from whether you want one.","options":[
      {"value":"vote","label":"It should need a public vote"},
      {"value":"hearing","label":"A real hearing, with the terms published first"},
      {"value":"normal","label":"The normal zoning process is enough"},
      {"value":"faster","label":"It should be easier to build than it is"}]}
  ]'::jsonb,
  '[
    "Is there a project near you? What have you actually been told about it, and by whom?",
    "What would a data center have to guarantee, in writing, for you to be fine with it?",
    "If your electric bill went up because of one, what would you want done about that?",
    "Who in your town do you trust to read the deal? Is anybody doing it?",
    "What is the strongest argument on the other side of where you landed?"
  ]'::jsonb,
  '{energy,land-use,water,utilities,zoning,local-government,climate,labor,ai-policy,infrastructure}',
  '[]'::jsonb,
  'active', 2
),
(
  'surveillance-and-tracking',
  'Cameras, plate readers, and tracking',
  'Who is watching the street, what they keep, and who else gets a copy.',
  'Automated license plate readers — Flock Safety is the best-known vendor, and it is not the only one — photograph passing cars, read the plates, and keep a searchable record of where a vehicle was and when. Around them sit city camera networks, facial recognition, gunshot detection, and software that tries to predict where crime will happen. Police departments point to stolen cars recovered, missing people found, and cases closed. Civil liberties groups point out that everyone is recorded by default, that records are kept for months, that other agencies can often search them, and that oversight is usually thin. Most of these systems were bought without a public vote.',
  'What is documented: thousands of U.S. jurisdictions operate ALPR systems, many purchased through vendor contracts or grants rather than a public budget line. Retention periods, audit logging, and data-sharing arrangements vary widely by contract and by state law; some states have passed statutes limiting retention or out-of-state sharing, and some jurisdictions have adopted ordinances requiring council approval before surveillance technology is acquired. Reporting has documented both cases solved with these systems and cases of misuse and misidentification. This page does not adjudicate whether the trade is worth it.',
  '[
    {"key":"stance","label":"Cameras and plate readers in your town","help":"Where you land overall.","options":[
      {"value":"support","label":"Support them"},
      {"value":"rules","label":"Support them, with rules"},
      {"value":"unsure","label":"Genuinely torn"},
      {"value":"limit","label":"Roll them back"},
      {"value":"oppose","label":"Oppose them"}]},
    {"key":"rules","label":"If they exist, what should be required","help":"Choose as many as you mean.","multi":true,"options":[
      {"value":"public-vote","label":"A public vote before any purchase"},
      {"value":"retention","label":"A hard limit on how long footage is kept"},
      {"value":"no-share","label":"No sharing with federal or out-of-state agencies"},
      {"value":"audit","label":"Published audit logs of who searched what"},
      {"value":"warrant","label":"A warrant to search the archive"},
      {"value":"no-face","label":"No facial recognition, at all"},
      {"value":"none","label":"None of these — let police use the tools"}]},
    {"key":"trust","label":"Who you would trust to hold the data","help":"Nobody is a real answer.","options":[
      {"value":"police","label":"The police department"},
      {"value":"city","label":"The city, outside the police department"},
      {"value":"board","label":"An independent oversight board"},
      {"value":"nobody","label":"Nobody should be holding it"}]}
  ]'::jsonb,
  '[
    "Do you know what your town has installed? How did you find out?",
    "Has one of these systems touched you or someone you know — helpfully or otherwise?",
    "What is the trade you would actually accept: what does the town get, and what does it give up?",
    "If you had ten minutes at a council meeting, what would you ask for?",
    "What is the strongest argument on the other side of where you landed?"
  ]'::jsonb,
  '{civil-liberties,surveillance,privacy,policing,technology,local-government,data-rights,journalism,civic-tech,criminal-justice}',
  '[]'::jsonb,
  'active', 3
)
on conflict (slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  context = excluded.context,
  dimensions = excluded.dimensions,
  prompts = excluded.prompts,
  tags = excluded.tags,
  ordinal = excluded.ordinal,
  updated_at = now();

-- ============================================================
-- 2. WHERE LISTINGS COME FROM
-- ============================================================

insert into public.eu_fellowship_sources (id, name, url, note, kind, active) values
  ('profellow',       'ProFellow',            'https://www.profellow.com/',
   'The database the owner named first. Work it by hand or with permission — their listings are their work product.', 'directory', true),
  ('idealist',        'Idealist',             'https://www.idealist.org/',
   'Broad nonprofit listings; fellowships sit among jobs and internships, so it needs filtering.', 'directory', true),
  ('opportunity-desk','Opportunity Desk',     'https://opportunitydesk.org/',
   'Heavier on international and youth programs than most U.S. directories.', 'directory', true),
  ('campus-offices',  'Campus fellowship offices', '',
   'Nearly every university has an office whose whole job is this, and their public pages are the best-maintained lists anywhere. Start with the schools people on this platform actually attend.', 'university', true),
  ('host-submitted',  'Listed by the people who run it', '',
   'A host profile files their own program through fellowships.html. Arrives pending, always.', 'community', true),
  ('the-desk',        'The desk',             'https://matthew.mccluster.org/',
   'Added by Equity Uprise directly, usually because somebody asked for it.', 'community', true)
on conflict (id) do update set
  name = excluded.name, url = excluded.url, note = excluded.note, kind = excluded.kind;

-- ============================================================
-- 3. THE STARTING DIRECTORY
--
-- Real programs, honestly labelled. No deadlines: see the header.
-- ============================================================

insert into public.eu_fellowships
  (slug, title, org, summary, url, focus_tags, topic_slugs, audience, location, region, remote,
   duration, eligibility, deadline_note, source, source_id, verification, status)
values
  ('coro-fellowship-public-affairs', 'Coro Fellowship in Public Affairs', 'Coro',
   'A full-time apprenticeship in how a city actually works: participants rotate through government, business, labor, nonprofits and political campaigns rather than studying any one of them.',
   'https://coro.org/', '{public-affairs,local-government,leadership,organizing,civic-tech}',
   '{data-centers,surveillance-and-tracking}', '{early-career}', 'Several U.S. cities', 'US', false,
   'About nine months', 'Open to people early in their careers; a degree is not required by every site.',
   'Cycles open and close annually — confirm on the program''s own page.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('truman-scholarship', 'Harry S. Truman Scholarship', 'Truman Scholarship Foundation',
   'A graduate funding award for undergraduates who intend to spend their careers in public service, with a summer institute and a network that keeps working long after the money is spent.',
   'https://www.truman.gov/', '{public-service,policy,graduate-funding,leadership}',
   '{us-israel,data-centers,surveillance-and-tracking}', '{students}', 'United States', 'US', false,
   'Award plus ongoing programming', 'U.S. undergraduates in their third year, nominated by their institution.',
   'Nominations run through campus fellowship offices on a fixed annual calendar — confirm both dates.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('echoing-green-fellowship', 'Echoing Green Fellowship', 'Echoing Green',
   'Seed funding and support for people starting an organization to solve a problem they have lived with, rather than joining one that already exists.',
   'https://echoinggreen.org/', '{social-entrepreneurship,funding,racial-equity,leadership,organizing}',
   '{data-centers,surveillance-and-tracking}', '{early-career,mid-career}', 'Global', 'GLOBAL', true,
   'Two years', 'For founders at an early stage of building an organization.',
   'Applications open on an annual cycle — confirm on the program''s own page.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('new-america-fellows', 'New America Fellows Program', 'New America',
   'Support for writers, journalists and researchers working on a book or a major project about American public problems.',
   'https://www.newamerica.org/fellows/', '{research,writing,journalism,policy,technology}',
   '{us-israel,data-centers,surveillance-and-tracking}', '{mid-career}', 'Washington, DC and remote', 'US', true,
   'One year', 'Open to writers and researchers; no advanced degree requirement stated.',
   'Cycles vary by fellowship track — confirm on the program''s own page.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('techcongress-fellowship', 'Congressional Innovation Fellowship', 'TechCongress',
   'Places technologists inside congressional offices as staff, so that the people writing technology law have somebody in the room who has built the thing.',
   'https://www.techcongress.io/', '{technology,policy,congress,civic-tech,privacy,ai-policy}',
   '{surveillance-and-tracking,data-centers}', '{early-career,mid-career}', 'Washington, DC', 'US', false,
   'Several months to a year, by track', 'For people with a technical background; tracks differ by career stage.',
   'Multiple tracks with separate calendars — confirm which one fits before the date matters.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('report-for-america', 'Report for America Corps', 'Report for America',
   'Places reporters in local newsrooms to cover beats that stopped being covered — statehouses, county government, the meetings where the decisions in these topics actually get made.',
   'https://www.reportforamerica.org/', '{journalism,local-government,accountability,writing}',
   '{data-centers,surveillance-and-tracking}', '{early-career,mid-career}', 'Newsrooms across the U.S.', 'US', false,
   'One year, often renewable', 'For working journalists; newsrooms and reporters apply separately.',
   'Reporter and newsroom calendars differ — confirm the one that applies to you.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('propublica-emerging-reporters', 'Emerging Reporters Program', 'ProPublica',
   'A stipend and mentorship for student journalists from backgrounds underrepresented in investigative reporting.',
   'https://www.propublica.org/', '{journalism,investigative,mentorship,accountability}',
   '{surveillance-and-tracking,data-centers}', '{students}', 'Remote', 'US', true,
   'An academic year', 'For college students pursuing journalism.',
   'Annual cycle — confirm on ProPublica''s own page.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('mozilla-fellowship', 'Mozilla Fellowship', 'Mozilla Foundation',
   'Support for people working on the health of the internet: privacy, platform accountability, and the public interest in how technology gets built.',
   'https://foundation.mozilla.org/', '{technology,privacy,data-rights,research,civic-tech,ai-policy}',
   '{surveillance-and-tracking}', '{mid-career}', 'Global, largely remote', 'GLOBAL', true,
   'Varies by cohort', 'Open to technologists, researchers, advocates and policy people.',
   'Runs intermittently rather than every year — confirm the program is open before planning around it.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('fulbright-us-student', 'Fulbright U.S. Student Program', 'U.S. Department of State',
   'Study, research or teach abroad for a year on a U.S. government grant. The largest and best-documented route out of the country for people early in their careers.',
   'https://us.fulbrightonline.org/', '{international,research,education,diplomacy,language}',
   '{us-israel}', '{students,early-career}', 'Worldwide', 'GLOBAL', false,
   'One academic year', 'U.S. citizens holding a bachelor''s degree by the start of the grant.',
   'A long annual cycle with campus deadlines months before the national one — start early.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('knight-hennessy-scholars', 'Knight-Hennessy Scholars', 'Stanford University',
   'Full funding for graduate study at Stanford in any department, built around a leadership program that runs alongside the degree.',
   'https://knight-hennessy.stanford.edu/', '{graduate-funding,leadership,research,policy}',
   '{us-israel,data-centers,surveillance-and-tracking}', '{students,early-career}', 'Stanford, California', 'US', false,
   'Up to the length of the degree', 'Applicants must also apply to a Stanford graduate program.',
   'Two applications with two calendars — confirm both.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('rhodes-scholarship', 'Rhodes Scholarship', 'Rhodes Trust',
   'Graduate study at Oxford, fully funded. The oldest of the international awards and the one with the heaviest campus-endorsement process.',
   'https://www.rhodeshouse.ox.ac.uk/', '{graduate-funding,international,leadership,research}',
   '{us-israel}', '{students}', 'Oxford, United Kingdom', 'GLOBAL', false,
   'Two years, sometimes three', 'Age and degree requirements apply and vary by country of application.',
   'National deadlines differ by constituency, and campus endorsement comes first.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('marshall-scholarship', 'Marshall Scholarship', 'Marshall Aid Commemoration Commission',
   'Graduate study anywhere in the United Kingdom, funded by the British government, for Americans.',
   'https://www.marshallscholarship.org/', '{graduate-funding,international,policy,research}',
   '{us-israel}', '{students}', 'United Kingdom', 'GLOBAL', false,
   'One to two years', 'U.S. citizens with a bachelor''s degree and a strong academic record.',
   'Campus endorsement precedes the national deadline — confirm both.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('ct-health-leadership-fellows', 'Health Leadership Fellows', 'Connecticut Health Foundation',
   'A Connecticut program that trains people to work on health equity in the state — the closest thing on this list to home for the Bridgeport cohort.',
   'https://www.cthealth.org/', '{health-equity,leadership,connecticut,local-government,organizing}',
   '{data-centers}', '{early-career,mid-career}', 'Connecticut', 'CT', false,
   'About a year, part-time', 'For people working on health and equity in Connecticut.',
   'Runs in cohorts rather than continuously — confirm whether one is open.',
   'staff', 'the-desk', 'unverified', 'published'),

  ('emerson-collective-fellowship', 'Emerson Collective Fellowship', 'Emerson Collective',
   'Support for people already deep in a body of work on education, immigration, climate or criminal justice, rather than for people starting one.',
   'https://www.emersoncollective.com/', '{social-impact,funding,criminal-justice,climate,education}',
   '{surveillance-and-tracking,data-centers}', '{mid-career}', 'United States', 'US', true,
   'One year', 'By application and, in some cycles, by nomination.',
   'Cycles are irregular — confirm the program is open before planning around it.',
   'staff', 'the-desk', 'unverified', 'published')
on conflict (slug) do nothing;

-- ============================================================
-- SELF-CHECK — expect topics = 3 and a directory that is not empty.
-- Every seeded listing should read 'unverified': that is the point.
-- ============================================================
select
  (select count(*) from public.eu_topics where status = 'active') as topics,
  (select count(*) from public.eu_fellowships where status = 'published') as published,
  (select count(*) from public.eu_fellowships where verification = 'unverified') as awaiting_check,
  (select count(*) from public.eu_fellowship_sources where active) as sources;
