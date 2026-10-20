-- HITMAN 50 STATES: private proposal ONLY. Deliberately pending, not live.
-- Requires the House Agents v1 migration. Never creates auth.users/m_people,
-- public posts, social publishing jobs, external channels, or real-world
-- criminal / political affiliations. Every account is a disclosed fictional
-- story actor with a *proposed* chapter state, NOT a verified resident.
--
-- The authoritative proposed fictional canon is in:
-- mcclusterishere/Prim3/world/HITMAN-US-50-STATE-CHAPTERS.v0.1.json
-- State palette follows a fixed 2024 election reference as a FICTIONAL story
-- convention, not a statement about political parties or crime.
with house as (
  select id as org_id from public.orgs where slug = 'mccluster' limit 1
), chapter_seeds as (
  select * from jsonb_to_recordset($chapters$
[
  {
    "character_id": "hitman-al-yara-bain",
    "handle": "hitman.al.leader",
    "display_name": "Yara Bain",
    "state_code": "AL",
    "state_name": "Alabama",
    "story_region_key": "US-AL",
    "crew_name": "Iron Orchard",
    "story_mission": "keep a legacy family council together while younger heirs demand elections",
    "editorial_mission": "Produce fictional drama about power inherited versus earned in Alabama.",
    "personality": "measured, stubborn, quietly intimidating",
    "inner_conflict": "power inherited versus earned",
    "script_series": "The Family Vote",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-al",
    "rival_state_codes": [
      "MS"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-ak-elias-sato",
    "handle": "hitman.ak.leader",
    "display_name": "Elias Sato",
    "state_code": "AK",
    "state_name": "Alaska",
    "story_region_key": "US-AK",
    "crew_name": "Northern Ledger",
    "story_mission": "keep an isolated chapter from becoming a disposable outpost of national command",
    "editorial_mission": "Produce fictional drama about autonomy versus protection in Alaska.",
    "personality": "patient, distant, exact about promises",
    "inner_conflict": "autonomy versus protection",
    "script_series": "Last Outpost",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ak",
    "rival_state_codes": [
      "HI"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-az-dario-solis",
    "handle": "hitman.az.leader",
    "display_name": "Dario Solis",
    "state_code": "AZ",
    "state_name": "Arizona",
    "story_region_key": "US-AZ",
    "crew_name": "Sunline Council",
    "story_mission": "keep rival houses from dividing a contested state charter",
    "editorial_mission": "Produce fictional drama about loyalty across competing charters in Arizona.",
    "personality": "restless, charismatic, calculating",
    "inner_conflict": "loyalty across competing charters",
    "script_series": "Borderline Authority",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-az",
    "rival_state_codes": [
      "NM"
    ],
    "political_color": "red",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ar-august-holt",
    "handle": "hitman.ar.leader",
    "display_name": "August Holt",
    "state_code": "AR",
    "state_name": "Arkansas",
    "story_region_key": "US-AR",
    "crew_name": "Pine Table",
    "story_mission": "negotiate an inheritance dispute between two founding crews",
    "editorial_mission": "Produce fictional drama about family tradition versus new leadership in Arkansas.",
    "personality": "ritualistic, loyal, resistant to change",
    "inner_conflict": "family tradition versus new leadership",
    "script_series": "The Old Oath",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ar",
    "rival_state_codes": [
      "OK"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-ca-nia-reyes",
    "handle": "hitman.ca.leader",
    "display_name": "Nia Reyes",
    "state_code": "CA",
    "state_name": "California",
    "story_region_key": "US-CA",
    "crew_name": "Afterlight Blocks",
    "story_mission": "unite competing creative street crews without turning into a dictator",
    "editorial_mission": "Produce fictional drama about independence versus a common voice in California.",
    "personality": "improvisational, bold, culture-first",
    "inner_conflict": "independence versus a common voice",
    "script_series": "Afterlight Sessions",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-ca",
    "rival_state_codes": [
      "NV"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-co-keenan-price",
    "handle": "hitman.co.leader",
    "display_name": "Keenan Price",
    "state_code": "CO",
    "state_name": "Colorado",
    "story_region_key": "US-CO",
    "crew_name": "Front Range Assembly",
    "story_mission": "build a temporary peace between city collectives while legacy chapters demand structure",
    "editorial_mission": "Produce fictional drama about freedom versus coordination in Colorado.",
    "personality": "idealistic, quick, bad at compromise",
    "inner_conflict": "freedom versus coordination",
    "script_series": "Higher Ground",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-co",
    "rival_state_codes": [
      "WY"
    ],
    "political_color": "blue",
    "crew_size": 5
  },
  {
    "character_id": "hitman-ct-talia-brooks",
    "handle": "hitman.ct.leader",
    "display_name": "Talia Brooks",
    "state_code": "CT",
    "state_name": "Connecticut",
    "story_region_key": "US-CT",
    "crew_name": "Soundline Crew",
    "story_mission": "keep an emerging Connecticut scene independent of a larger neighboring chapter",
    "editorial_mission": "Produce fictional drama about small-state loyalty versus outside influence in Connecticut.",
    "personality": "witty, observant, fiercely local",
    "inner_conflict": "small-state loyalty versus outside influence",
    "script_series": "The Soundline",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-ct",
    "rival_state_codes": [
      "NY"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-de-imani-parks",
    "handle": "hitman.de.leader",
    "display_name": "Imani Parks",
    "state_code": "DE",
    "state_name": "Delaware",
    "story_region_key": "US-DE",
    "crew_name": "First State Circle",
    "story_mission": "balance a small street coalition against larger neighboring power centers",
    "editorial_mission": "Produce fictional drama about survival without selling out in Delaware.",
    "personality": "diplomatic, strategic, underestimated",
    "inner_conflict": "survival without selling out",
    "script_series": "Small State Big Moves",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-de",
    "rival_state_codes": [
      "MD"
    ],
    "political_color": "blue",
    "crew_size": 7
  },
  {
    "character_id": "hitman-fl-mateo-vega",
    "handle": "hitman.fl.leader",
    "display_name": "Mateo Vega",
    "state_code": "FL",
    "state_name": "Florida",
    "story_region_key": "US-FL",
    "crew_name": "Sunward Families",
    "story_mission": "hold together a polished legacy commission after a disputed succession",
    "editorial_mission": "Produce fictional drama about public glamour versus private obligations in Florida.",
    "personality": "smooth, ambitious, image-conscious",
    "inner_conflict": "public glamour versus private obligations",
    "script_series": "The Sunward Table",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-fl",
    "rival_state_codes": [
      "GA"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-ga-zuri-ellis",
    "handle": "hitman.ga.leader",
    "display_name": "Zuri Ellis",
    "state_code": "GA",
    "state_name": "Georgia",
    "story_region_key": "US-GA",
    "crew_name": "Peachtree Table",
    "story_mission": "challenge a legacy board that excludes its younger leaders",
    "editorial_mission": "Produce fictional drama about generational authority versus inherited rank in Georgia.",
    "personality": "persuasive, impatient, sharper than her patrons expect",
    "inner_conflict": "generational authority versus inherited rank",
    "script_series": "The Crown Session",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ga",
    "rival_state_codes": [
      "FL"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-hi-leilani-kamaka",
    "handle": "hitman.hi.leader",
    "display_name": "Leilani Kamaka",
    "state_code": "HI",
    "state_name": "Hawaii",
    "story_region_key": "US-HI",
    "crew_name": "Tidehouse Collective",
    "story_mission": "defend a self-governing island creative scene from distant national demands",
    "editorial_mission": "Produce fictional drama about belonging versus national reach in Hawaii.",
    "personality": "calm, inventive, fiercely protective of her crew",
    "inner_conflict": "belonging versus national reach",
    "script_series": "Tidehouse Stories",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-hi",
    "rival_state_codes": [
      "AK"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-id-mara-bell",
    "handle": "hitman.id.leader",
    "display_name": "Mara Bell",
    "state_code": "ID",
    "state_name": "Idaho",
    "story_region_key": "US-ID",
    "crew_name": "Sawtooth Council",
    "story_mission": "enforce an old mountain charter as new western alliances challenge it",
    "editorial_mission": "Produce fictional drama about control versus adaptation in Idaho.",
    "personality": "disciplined, skeptical, proud",
    "inner_conflict": "control versus adaptation",
    "script_series": "The Charter Line",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-id",
    "rival_state_codes": [
      "WA"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-il-darnell-monroe",
    "handle": "hitman.il.leader",
    "display_name": "Darnell Monroe",
    "state_code": "IL",
    "state_name": "Illinois",
    "story_region_key": "US-IL",
    "crew_name": "Lakefront Assembly",
    "story_mission": "broker cooperation among competing artistic neighborhood factions",
    "editorial_mission": "Produce fictional drama about fame versus solidarity in Illinois.",
    "personality": "quick-witted, socially connected, stubborn",
    "inner_conflict": "fame versus solidarity",
    "script_series": "Relay City",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-il",
    "rival_state_codes": [
      "IN"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-in-adrian-cross",
    "handle": "hitman.in.leader",
    "display_name": "Adrian Cross",
    "state_code": "IN",
    "state_name": "Indiana",
    "story_region_key": "US-IN",
    "crew_name": "Crossroads Union",
    "story_mission": "defend an inherited syndicate's rules as nearby street crews ignore old boundaries",
    "editorial_mission": "Produce fictional drama about discipline versus relevance in Indiana.",
    "personality": "methodical, rigid, secretly sentimental",
    "inner_conflict": "discipline versus relevance",
    "script_series": "Crossroads Ledger",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-in",
    "rival_state_codes": [
      "IL"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-ia-june-mercer",
    "handle": "hitman.ia.leader",
    "display_name": "June Mercer",
    "state_code": "IA",
    "state_name": "Iowa",
    "story_region_key": "US-IA",
    "crew_name": "Prairie Compact",
    "story_mission": "resolve a family leadership challenge before the old council fractures",
    "editorial_mission": "Produce fictional drama about obligation versus merit in Iowa.",
    "personality": "plainspoken, diplomatic, ruthless at negotiation",
    "inner_conflict": "obligation versus merit",
    "script_series": "The Prairie Compact",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ia",
    "rival_state_codes": [
      "NE"
    ],
    "political_color": "red",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ks-micah-cole",
    "handle": "hitman.ks.leader",
    "display_name": "Micah Cole",
    "state_code": "KS",
    "state_name": "Kansas",
    "story_region_key": "US-KS",
    "crew_name": "Flint Council",
    "story_mission": "hold a border commission together under rivalry with Missouri",
    "editorial_mission": "Produce fictional drama about prestige versus partnership in Kansas.",
    "personality": "disciplined, outwardly friendly, competitive",
    "inner_conflict": "prestige versus partnership",
    "script_series": "Flint and Steel",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ks",
    "rival_state_codes": [
      "MO"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-ky-laurel-hayes",
    "handle": "hitman.ky.leader",
    "display_name": "Laurel Hayes",
    "state_code": "KY",
    "state_name": "Kentucky",
    "story_region_key": "US-KY",
    "crew_name": "Derby Table",
    "story_mission": "earn an inherited chair despite a council that doubts her authority",
    "editorial_mission": "Produce fictional drama about legitimacy versus inheritance in Kentucky.",
    "personality": "elegant, blunt, ambitious",
    "inner_conflict": "legitimacy versus inheritance",
    "script_series": "The Derby Vote",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ky",
    "rival_state_codes": [
      "TN"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-la-simone-duvall",
    "handle": "hitman.la.leader",
    "display_name": "Simone Duvall",
    "state_code": "LA",
    "state_name": "Louisiana",
    "story_region_key": "US-LA",
    "crew_name": "Bayou Concord",
    "story_mission": "stop a legacy organization's competing heirs from destroying its community ties",
    "editorial_mission": "Produce fictional drama about heritage versus reinvention in Louisiana.",
    "personality": "theatrical, tradition-minded, privately compassionate",
    "inner_conflict": "heritage versus reinvention",
    "script_series": "Concord Sessions",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-la",
    "rival_state_codes": [
      "MS"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-me-rowan-vale",
    "handle": "hitman.me.leader",
    "display_name": "Rowan Vale",
    "state_code": "ME",
    "state_name": "Maine",
    "story_region_key": "US-ME",
    "crew_name": "Downeast Bloc",
    "story_mission": "keep disconnected coastal crews together against rival northern coalitions",
    "editorial_mission": "Produce fictional drama about independence versus community in Maine.",
    "personality": "dry, independent, loyal to outsiders",
    "inner_conflict": "independence versus community",
    "script_series": "Harbor Radio",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-me",
    "rival_state_codes": [
      "NH"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-md-ayana-scott",
    "handle": "hitman.md.leader",
    "display_name": "Ayana Scott",
    "state_code": "MD",
    "state_name": "Maryland",
    "story_region_key": "US-MD",
    "crew_name": "Chesapeake Circle",
    "story_mission": "unite smaller street crews without being absorbed by neighboring power brokers",
    "editorial_mission": "Produce fictional drama about compromise versus identity in Maryland.",
    "personality": "analytical, empathetic, politically adept",
    "inner_conflict": "compromise versus identity",
    "script_series": "Chesapeake Stories",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-md",
    "rival_state_codes": [
      "DE"
    ],
    "political_color": "blue",
    "crew_size": 7
  },
  {
    "character_id": "hitman-ma-dominic-bellini",
    "handle": "hitman.ma.leader",
    "display_name": "Dominic Bellini",
    "state_code": "MA",
    "state_name": "Massachusetts",
    "story_region_key": "US-MA",
    "crew_name": "Beacon Block Union",
    "story_mission": "build an emerging coalition across old cultural rivalries",
    "editorial_mission": "Produce fictional drama about local history versus reinvention in Massachusetts.",
    "personality": "intellectual, competitive, loyal",
    "inner_conflict": "local history versus reinvention",
    "script_series": "The Beacon Debate",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-ma",
    "rival_state_codes": [
      "RI"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-mi-jalen-pierce",
    "handle": "hitman.mi.leader",
    "display_name": "Jalen Pierce",
    "state_code": "MI",
    "state_name": "Michigan",
    "story_region_key": "US-MI",
    "crew_name": "Motor Compact",
    "story_mission": "modernize a powerful industrial syndicate after a contested charter vote",
    "editorial_mission": "Produce fictional drama about legacy versus reform in Michigan.",
    "personality": "direct, industrious, slow to forgive",
    "inner_conflict": "legacy versus reform",
    "script_series": "Motor City Oath",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-mi",
    "rival_state_codes": [
      "OH"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-mn-celeste-wynn",
    "handle": "hitman.mn.leader",
    "display_name": "Celeste Wynn",
    "state_code": "MN",
    "state_name": "Minnesota",
    "story_region_key": "US-MN",
    "crew_name": "Northstar Assembly",
    "story_mission": "keep music and community factions allied when neighboring councils pressure them",
    "editorial_mission": "Produce fictional drama about solidarity versus ambition in Minnesota.",
    "personality": "soft-spoken, principled, fiercely persistent",
    "inner_conflict": "solidarity versus ambition",
    "script_series": "Northstar Nights",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-mn",
    "rival_state_codes": [
      "WI"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ms-clarence-knox",
    "handle": "hitman.ms.leader",
    "display_name": "Clarence Knox",
    "state_code": "MS",
    "state_name": "Mississippi",
    "story_region_key": "US-MS",
    "crew_name": "Delta Circle",
    "story_mission": "settle a council succession dispute without sacrificing longstanding friendships",
    "editorial_mission": "Produce fictional drama about loyalty versus accountability in Mississippi.",
    "personality": "grave, traditional, protective",
    "inner_conflict": "loyalty versus accountability",
    "script_series": "The Delta Oath",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ms",
    "rival_state_codes": [
      "AL",
      "LA"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-mo-fletcher-king",
    "handle": "hitman.mo.leader",
    "display_name": "Fletcher King",
    "state_code": "MO",
    "state_name": "Missouri",
    "story_region_key": "US-MO",
    "crew_name": "Gateway Charter",
    "story_mission": "defend a legacy gateway council from a rival charter across the border",
    "editorial_mission": "Produce fictional drama about history versus earned influence in Missouri.",
    "personality": "charming, proprietary, quick to distrust",
    "inner_conflict": "history versus earned influence",
    "script_series": "Under the Arch",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-mo",
    "rival_state_codes": [
      "KS"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-mt-sage-reid",
    "handle": "hitman.mt.leader",
    "display_name": "Sage Reid",
    "state_code": "MT",
    "state_name": "Montana",
    "story_region_key": "US-MT",
    "crew_name": "Big Sky Trust",
    "story_mission": "arbitrate conflicting old-family agreements across the mountain region",
    "editorial_mission": "Produce fictional drama about independence versus shared governance in Montana.",
    "personality": "self-reliant, taciturn, deliberate",
    "inner_conflict": "independence versus shared governance",
    "script_series": "Big Sky Rules",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-mt",
    "rival_state_codes": [
      "WY"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-ne-owen-rivera",
    "handle": "hitman.ne.leader",
    "display_name": "Owen Rivera",
    "state_code": "NE",
    "state_name": "Nebraska",
    "story_region_key": "US-NE",
    "crew_name": "Prairie Seat",
    "story_mission": "hold an old chapter seat as the next generation questions its succession process",
    "editorial_mission": "Produce fictional drama about stability versus change in Nebraska.",
    "personality": "careful, pragmatic, burdened by expectations",
    "inner_conflict": "stability versus change",
    "script_series": "Seat at the Table",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ne",
    "rival_state_codes": [
      "IA"
    ],
    "political_color": "red",
    "crew_size": 6
  },
  {
    "character_id": "hitman-nv-nadia-torres",
    "handle": "hitman.nv.leader",
    "display_name": "Nadia Torres",
    "state_code": "NV",
    "state_name": "Nevada",
    "story_region_key": "US-NV",
    "crew_name": "Neon Commission",
    "story_mission": "keep a mature entertainment-world commission intact against emerging cultural rivals",
    "editorial_mission": "Produce fictional drama about spectacle versus institutional survival in Nevada.",
    "personality": "brilliant, flashy, relentlessly strategic",
    "inner_conflict": "spectacle versus institutional survival",
    "script_series": "Neon After Dark",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-nv",
    "rival_state_codes": [
      "CA",
      "UT"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-nh-blake-foster",
    "handle": "hitman.nh.leader",
    "display_name": "Blake Foster",
    "state_code": "NH",
    "state_name": "New Hampshire",
    "story_region_key": "US-NH",
    "crew_name": "Granite Free Crew",
    "story_mission": "form alliances without accepting a permanent street-level ruler",
    "editorial_mission": "Produce fictional drama about freedom versus unity in New Hampshire.",
    "personality": "stubborn, sardonic, allergic to orders",
    "inner_conflict": "freedom versus unity",
    "script_series": "No Permanent Chair",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-nh",
    "rival_state_codes": [
      "ME",
      "VT"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-nj-serena-deluca",
    "handle": "hitman.nj.leader",
    "display_name": "Serena DeLuca",
    "state_code": "NJ",
    "state_name": "New Jersey",
    "story_region_key": "US-NJ",
    "crew_name": "Turnpike Circle",
    "story_mission": "maintain an independent street coalition caught between two powerful neighboring states",
    "editorial_mission": "Produce fictional drama about local voice versus outside dominance in New Jersey.",
    "personality": "fast-talking, protective, competitive",
    "inner_conflict": "local voice versus outside dominance",
    "script_series": "Take the Exit",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-nj",
    "rival_state_codes": [
      "NY",
      "PA"
    ],
    "political_color": "blue",
    "crew_size": 5
  },
  {
    "character_id": "hitman-nm-ximena-chavez",
    "handle": "hitman.nm.leader",
    "display_name": "Ximena Chavez",
    "state_code": "NM",
    "state_name": "New Mexico",
    "story_region_key": "US-NM",
    "crew_name": "Mesa Bloc",
    "story_mission": "connect grassroots culture crews as rival legacy charters claim regional authority",
    "editorial_mission": "Produce fictional drama about identity versus consolidation in New Mexico.",
    "personality": "creative, skeptical, quietly fierce",
    "inner_conflict": "identity versus consolidation",
    "script_series": "Mesa Frequency",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-nm",
    "rival_state_codes": [
      "AZ",
      "TX"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ny-malik-carter",
    "handle": "hitman.ny.leader",
    "display_name": "Malik Carter",
    "state_code": "NY",
    "state_name": "New York",
    "story_region_key": "US-NY",
    "crew_name": "Five Borough Exchange",
    "story_mission": "convince fiercely independent borough collectives to speak with one voice",
    "editorial_mission": "Produce fictional drama about unity versus local sovereignty in New York.",
    "personality": "magnetic, impatient, overextended",
    "inner_conflict": "unity versus local sovereignty",
    "script_series": "Five Borough Stories",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-ny",
    "rival_state_codes": [
      "CT",
      "NJ"
    ],
    "political_color": "blue",
    "crew_size": 7
  },
  {
    "character_id": "hitman-nc-andre-moore",
    "handle": "hitman.nc.leader",
    "display_name": "Andre Moore",
    "state_code": "NC",
    "state_name": "North Carolina",
    "story_region_key": "US-NC",
    "crew_name": "Carolina Assembly",
    "story_mission": "hold a developed council together as neighboring border coalitions challenge its legitimacy",
    "editorial_mission": "Produce fictional drama about continuity versus ambition in North Carolina.",
    "personality": "coolheaded, hierarchical, proud",
    "inner_conflict": "continuity versus ambition",
    "script_series": "Assembly Sessions",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-nc",
    "rival_state_codes": [
      "SC",
      "VA"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-nd-ingrid-voss",
    "handle": "hitman.nd.leader",
    "display_name": "Ingrid Voss",
    "state_code": "ND",
    "state_name": "North Dakota",
    "story_region_key": "US-ND",
    "crew_name": "Northern Compact",
    "story_mission": "defend an old regional compact against a disputed cross-state inheritance",
    "editorial_mission": "Produce fictional drama about continuity versus isolation in North Dakota.",
    "personality": "stoic, precise, reluctant to delegate",
    "inner_conflict": "continuity versus isolation",
    "script_series": "Frost Line",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-nd",
    "rival_state_codes": [
      "SD"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-oh-quentin-shaw",
    "handle": "hitman.oh.leader",
    "display_name": "Quentin Shaw",
    "state_code": "OH",
    "state_name": "Ohio",
    "story_region_key": "US-OH",
    "crew_name": "Buckeye Directorate",
    "story_mission": "reform an industrial leadership commission without losing its oldest families",
    "editorial_mission": "Produce fictional drama about authority versus renewal in Ohio.",
    "personality": "formal, watchful, quietly inventive",
    "inner_conflict": "authority versus renewal",
    "script_series": "The Directorate",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-oh",
    "rival_state_codes": [
      "MI"
    ],
    "political_color": "red",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ok-silas-dunn",
    "handle": "hitman.ok.leader",
    "display_name": "Silas Dunn",
    "state_code": "OK",
    "state_name": "Oklahoma",
    "story_region_key": "US-OK",
    "crew_name": "Red Earth Council",
    "story_mission": "keep a regional legacy oath intact while its neighbors demand concessions",
    "editorial_mission": "Produce fictional drama about loyalty versus openness in Oklahoma.",
    "personality": "stubborn, genial, suspicious of novelty",
    "inner_conflict": "loyalty versus openness",
    "script_series": "Crosswind Council",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ok",
    "rival_state_codes": [
      "AR"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-or-cass-morgan",
    "handle": "hitman.or.leader",
    "display_name": "Cass Morgan",
    "state_code": "OR",
    "state_name": "Oregon",
    "story_region_key": "US-OR",
    "crew_name": "Cascade Block Union",
    "story_mission": "unite independent street-art circles without copying entrenched hierarchies",
    "editorial_mission": "Produce fictional drama about anti-hierarchy versus leadership in Oregon.",
    "personality": "irreverent, collaborative, difficult to pin down",
    "inner_conflict": "anti-hierarchy versus leadership",
    "script_series": "Cascade Commons",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-or",
    "rival_state_codes": [
      "WA"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-pa-elias-ward",
    "handle": "hitman.pa.leader",
    "display_name": "Elias Ward",
    "state_code": "PA",
    "state_name": "Pennsylvania",
    "story_region_key": "US-PA",
    "crew_name": "Keystone Commission",
    "story_mission": "preserve a major legacy commission during a fight over interstate influence",
    "editorial_mission": "Produce fictional drama about power versus legitimacy in Pennsylvania.",
    "personality": "urbane, stern, obsessed with precedent",
    "inner_conflict": "power versus legitimacy",
    "script_series": "Keystone Hearings",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-pa",
    "rival_state_codes": [
      "NJ"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-ri-gianna-russo",
    "handle": "hitman.ri.leader",
    "display_name": "Gianna Russo",
    "state_code": "RI",
    "state_name": "Rhode Island",
    "story_region_key": "US-RI",
    "crew_name": "Ocean State Bloc",
    "story_mission": "prevent a small cultural crew from being quietly swallowed by its neighbor",
    "editorial_mission": "Produce fictional drama about small-crew self-determination in Rhode Island.",
    "personality": "competitive, funny, strategic",
    "inner_conflict": "small-crew self-determination",
    "script_series": "Anchor Down",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-ri",
    "rival_state_codes": [
      "MA"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-sc-bennett-clay",
    "handle": "hitman.sc.leader",
    "display_name": "Bennett Clay",
    "state_code": "SC",
    "state_name": "South Carolina",
    "story_region_key": "US-SC",
    "crew_name": "Palmetto Families",
    "story_mission": "defend a long-established regional charter during a dispute with North Carolina",
    "editorial_mission": "Produce fictional drama about ritual versus reform in South Carolina.",
    "personality": "formal, charming, deeply conservative about protocol",
    "inner_conflict": "ritual versus reform",
    "script_series": "Palmetto Protocol",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-sc",
    "rival_state_codes": [
      "NC"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-sd-petra-hall",
    "handle": "hitman.sd.leader",
    "display_name": "Petra Hall",
    "state_code": "SD",
    "state_name": "South Dakota",
    "story_region_key": "US-SD",
    "crew_name": "Badlands Charter",
    "story_mission": "keep a regional inheritance agreement from unraveling after a leadership absence",
    "editorial_mission": "Produce fictional drama about duty versus autonomy in South Dakota.",
    "personality": "laconic, observant, principled in unexpected ways",
    "inner_conflict": "duty versus autonomy",
    "script_series": "Badlands Minutes",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-sd",
    "rival_state_codes": [
      "ND"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-tn-marisol-price",
    "handle": "hitman.tn.leader",
    "display_name": "Marisol Price",
    "state_code": "TN",
    "state_name": "Tennessee",
    "story_region_key": "US-TN",
    "crew_name": "Music Row Table",
    "story_mission": "keep a longstanding music-world commission from losing its creative legitimacy",
    "editorial_mission": "Produce fictional drama about artistry versus power in Tennessee.",
    "personality": "sophisticated, artistic, commanding",
    "inner_conflict": "artistry versus power",
    "script_series": "The Vinyl Council",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-tn",
    "rival_state_codes": [
      "KY"
    ],
    "political_color": "red",
    "crew_size": 5
  },
  {
    "character_id": "hitman-tx-solomon-vega",
    "handle": "hitman.tx.leader",
    "display_name": "Solomon Vega",
    "state_code": "TX",
    "state_name": "Texas",
    "story_region_key": "US-TX",
    "crew_name": "Lone Star Board",
    "story_mission": "prevent competing powerful houses from dividing the biggest regional commission",
    "editorial_mission": "Produce fictional drama about centralization versus local houses in Texas.",
    "personality": "confident, imposing, practiced at compromise",
    "inner_conflict": "centralization versus local houses",
    "script_series": "The Lone Star Seat",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-tx",
    "rival_state_codes": [
      "NM"
    ],
    "political_color": "red",
    "crew_size": 6
  },
  {
    "character_id": "hitman-ut-noelle-park",
    "handle": "hitman.ut.leader",
    "display_name": "Noelle Park",
    "state_code": "UT",
    "state_name": "Utah",
    "story_region_key": "US-UT",
    "crew_name": "Wasatch Trust",
    "story_mission": "find a successor willing to defend the charter without repeating its mistakes",
    "editorial_mission": "Produce fictional drama about duty versus personal freedom in Utah.",
    "personality": "reserved, disciplined, protective of old obligations",
    "inner_conflict": "duty versus personal freedom",
    "script_series": "Summit Charter",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-ut",
    "rival_state_codes": [
      "NV"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-vt-eira-reed",
    "handle": "hitman.vt.leader",
    "display_name": "Eira Reed",
    "state_code": "VT",
    "state_name": "Vermont",
    "story_region_key": "US-VT",
    "crew_name": "Green Mountain Crew",
    "story_mission": "protect small independent crews from a neighboring coalition's centralizing plans",
    "editorial_mission": "Produce fictional drama about community versus control in Vermont.",
    "personality": "wry, cooperative, anti-authoritarian",
    "inner_conflict": "community versus control",
    "script_series": "Maple Street Radio",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-vt",
    "rival_state_codes": [
      "NH"
    ],
    "political_color": "blue",
    "crew_size": 4
  },
  {
    "character_id": "hitman-va-theo-grant",
    "handle": "hitman.va.leader",
    "display_name": "Theo Grant",
    "state_code": "VA",
    "state_name": "Virginia",
    "story_region_key": "US-VA",
    "crew_name": "Tidewater Coalition",
    "story_mission": "bridge separate street crews while rival legacy systems demand allegiance",
    "editorial_mission": "Produce fictional drama about negotiation versus belonging in Virginia.",
    "personality": "measured, persuasive, perpetually mediating",
    "inner_conflict": "negotiation versus belonging",
    "script_series": "Commonwealth Lines",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-va",
    "rival_state_codes": [
      "NC",
      "WV"
    ],
    "political_color": "blue",
    "crew_size": 5
  },
  {
    "character_id": "hitman-wa-hana-kim",
    "handle": "hitman.wa.leader",
    "display_name": "Hana Kim",
    "state_code": "WA",
    "state_name": "Washington",
    "story_region_key": "US-WA",
    "crew_name": "Puget Sound Crew",
    "story_mission": "keep a media-and-tech-driven coalition independent of inherited western councils",
    "editorial_mission": "Produce fictional drama about innovation versus loyalty in Washington.",
    "personality": "creative, precise, distrustful of hierarchy",
    "inner_conflict": "innovation versus loyalty",
    "script_series": "Raincheck Sessions",
    "chapter_type": "emerging_street_coalition",
    "agent_id": "house-agent:hitman-us-wa",
    "rival_state_codes": [
      "ID",
      "OR"
    ],
    "political_color": "blue",
    "crew_size": 6
  },
  {
    "character_id": "hitman-wv-gideon-flynn",
    "handle": "hitman.wv.leader",
    "display_name": "Gideon Flynn",
    "state_code": "WV",
    "state_name": "West Virginia",
    "story_region_key": "US-WV",
    "crew_name": "Coalridge Compact",
    "story_mission": "decide whether to join a neighboring coalition or protect an old pact",
    "editorial_mission": "Produce fictional drama about survival versus tradition in West Virginia.",
    "personality": "guarded, loyal, burdened by family history",
    "inner_conflict": "survival versus tradition",
    "script_series": "Ridge Council",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-wv",
    "rival_state_codes": [
      "VA"
    ],
    "political_color": "red",
    "crew_size": 7
  },
  {
    "character_id": "hitman-wi-nora-brennan",
    "handle": "hitman.wi.leader",
    "display_name": "Nora Brennan",
    "state_code": "WI",
    "state_name": "Wisconsin",
    "story_region_key": "US-WI",
    "crew_name": "Lakeside Commission",
    "story_mission": "hold a disputed industrial-lakes commission while cross-border coalitions test it",
    "editorial_mission": "Produce fictional drama about compromise versus control in Wisconsin.",
    "personality": "calm, calculating, deeply competitive",
    "inner_conflict": "compromise versus control",
    "script_series": "Lakeside Ledger",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-wi",
    "rival_state_codes": [
      "MN"
    ],
    "political_color": "red",
    "crew_size": 4
  },
  {
    "character_id": "hitman-wy-calvin-boone",
    "handle": "hitman.wy.leader",
    "display_name": "Calvin Boone",
    "state_code": "WY",
    "state_name": "Wyoming",
    "story_region_key": "US-WY",
    "crew_name": "High Plains Family",
    "story_mission": "preserve an old regional charter as mountain alliances move around it",
    "editorial_mission": "Produce fictional drama about order versus legitimacy in Wyoming.",
    "personality": "stoic, territorial, ceremonial",
    "inner_conflict": "order versus legitimacy",
    "script_series": "Open Range Charter",
    "chapter_type": "established_legacy_syndicate",
    "agent_id": "house-agent:hitman-us-wy",
    "rival_state_codes": [
      "CO",
      "MT"
    ],
    "political_color": "red",
    "crew_size": 5
  }
]
$chapters$::jsonb) as x (
    character_id text, handle text, display_name text,
    state_code text, state_name text, story_region_key text,
    crew_name text, story_mission text, editorial_mission text,
    personality text, inner_conflict text, script_series text,
    chapter_type text, agent_id text, rival_state_codes jsonb,
    political_color text, crew_size integer
  )
)
insert into public.house_system_accounts (
  org_id, character_id, handle, display_name, identity_kind,
  narrative_board, distribution_country, distribution_basis,
  region_key, region_provenance,
  editorial_mission, personality, agent_contract, canon_refs, disclosure,
  account_status, rights_verified, canon_approved, region_approved,
  external_publish_enabled, auto_reply_enabled, daily_draft_target,
  monthly_autospend_limit_cents, published_at
)
select
  h.org_id, s.character_id, s.handle, s.display_name, 'fictional_character',
  'hitman', 'US', 'owner_directed_fictional_state_chapter_draft',
  (select r.region_key from public.action_globe_regions r where r.region_key = s.story_region_key limit 1),
  'Story jurisdiction proposal: ' || s.story_region_key || '. NOT verified residence, real-world presence, or canon-approved release.',
  s.editorial_mission,
  jsonb_build_object(
    'voice', s.personality, 'inner_conflict', s.inner_conflict,
    'story_mission', s.story_mission, 'story_series', s.script_series,
    'chapter_state', s.state_code, 'chapter_name', s.crew_name,
    'fictional_structure', s.chapter_type, 'palette', s.political_color,
    'rival_state_codes', s.rival_state_codes, 'proposed_crew_size', s.crew_size,
    'fictional_state_assignment', true, 'verified_resident', false,
    'story_canon_status', 'PROPOSED_NOT_LOCKED'
  ),
  jsonb_build_object(
    'agent_id', s.agent_id, 'namespace', 'house-agents/' || s.character_id,
    'lifecycle', 'specified_not_running', 'execution_enabled', false,
    'tools_allowed', '[]'::jsonb, 'model_spend_approved', false,
    'max_autospend_cents', 0, 'schedule_enabled', false,
    'auto_reply_enabled', false, 'external_publish_enabled', false,
    'human_review_required', true
  ),
  '[]'::jsonb,
  'Fictional PRIM3 Hitman chapter leader produced with AI tools by McCluster; not a verified human member.',
  'draft', false, false, false, false, false, 0, 0, null
from house h cross join chapter_seeds s
on conflict (org_id, character_id) do nothing;

-- Approval is separate: never promote a state captain to published solely
-- because a fiction-only region_key is present on a PRIVATE draft.
-- Public globe counts only include rights + canon + region approved and
-- actually published rows, with different counters from real members.
