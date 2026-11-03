/* PRIM3 REGIONAL AGENTS: the 24 stationed operatives who read their country's news.

   Owner, 2026-11-03: "each agent of 24 ... They're already mapped, so just have
   them be able to comment on the region." The mapping is the World's cast
   (data/prim3/world-missions.json → cast, orders 2–25; order 1 is McCluster,
   who calls missions in and is not a regional agent). Names, countries, roles
   and lanes are copied from that cast; `voice` is a DRAFT one-line speaking
   style for the news desk only and promotes nothing to canon.

   iso is ISO 3166-1; fips is GDELT's FIPS 10-4 code, which is what
   media_news_articles.location_country_fips stores (Japan is JA, not JP).
   All of this is fiction voiced by McCluster about real headlines: real
   countries and real people are never enemies. */

export const PRIM3_AGENTS = Object.freeze([
  { key: 'aya-shinoda', name: 'Aya Shinoda', iso: 'JP', fips: 'JA', country: 'Japan', role: 'Field-T Technical Operator', lane: 'T', voice: 'precise, dry, quietly funny; reads everything as systems and signals' },
  { key: 'arjun-mehta', name: 'Arjun Mehta', iso: 'IN', fips: 'IN', country: 'India', role: 'Field-E Entry Operator', lane: 'E', voice: 'direct and fast; sizes up the first move' },
  { key: 'li-wei', name: 'Li Wei', iso: 'CN', fips: 'CH', country: 'China', role: 'Authority / Director track', lane: 'Authority', voice: 'measured, strategic, long view' },
  { key: 'sari-wulandari', name: 'Sari Wulandari', iso: 'ID', fips: 'ID', country: 'Indonesia', role: 'Cohort-01 Operator', lane: 'Cohort', voice: 'curious newcomer, warm, notices people' },
  { key: 'hassan-raza', name: 'Hassan Raza', iso: 'PK', fips: 'PK', country: 'Pakistan', role: 'Defense-03 Tech-Zone Guard', lane: 'Defense', voice: 'watchful and protective; thinks about who keeps things running' },
  { key: 'chioma-okeke', name: 'Chioma Okeke', iso: 'NG', fips: 'NI', country: 'Nigeria', role: 'Cohort-03 Lead track', lane: 'Lead', voice: 'confident organizer; turns news into a plan' },
  { key: 'rafael-costa', name: 'Rafael Costa', iso: 'BR', fips: 'BR', country: 'Brazil', role: 'Field-R Overwatch', lane: 'R', voice: 'patient overwatch; sees the whole field before speaking' },
  { key: 'nusrat-rahman', name: 'Nusrat Rahman', iso: 'BD', fips: 'BG', country: 'Bangladesh', role: 'Defense-02 Access Officer', lane: 'Defense', voice: 'careful about who gets in and why' },
  { key: 'dmitri-volkov', name: 'Dmitri Volkov', iso: 'RU', fips: 'RS', country: 'Russia', role: 'Defense-01 Building Guard', lane: 'Defense', voice: 'laconic, practical, deadpan' },
  { key: 'oksana-bondarenko', name: 'Oksana Bondarenko', iso: 'UA', fips: 'UP', country: 'Ukraine', role: 'Field-R / Intelligence', lane: 'R', voice: 'analytical; separates what is known from what is claimed' },
  { key: 'yonas-bekele', name: 'Yonas Bekele', iso: 'ET', fips: 'ET', country: 'Ethiopia', role: 'Cohort-01 Operator', lane: 'Cohort', voice: 'steady, thoughtful, hopeful' },
  { key: 'valeria-soto', name: 'Valeria Soto', iso: 'MX', fips: 'MX', country: 'Mexico', role: 'Cohort-02 Trainee', lane: 'Cohort', voice: 'quick, funny, learning out loud' },
  { key: 'amira-hassan', name: 'Amira Hassan', iso: 'EG', fips: 'EG', country: 'Egypt', role: 'Authority-03 Mission Sponsor', lane: 'Authority', voice: 'formal, weighs cost and benefit' },
  { key: 'miguel-santos', name: 'Miguel Santos', iso: 'PH', fips: 'RP', country: 'Philippines', role: 'Defense-02 Access Officer', lane: 'Defense', voice: 'friendly but strict at the door' },
  { key: 'grace-mbala', name: 'Grace Mbala', iso: 'CD', fips: 'CG', country: 'DR Congo', role: 'Cohort Support', lane: 'Support', voice: 'supportive, community first' },
  { key: 'minh-tran', name: 'Minh Tran', iso: 'VN', fips: 'VM', country: 'Vietnam', role: 'Field-T Technical Operator', lane: 'T', voice: 'tinkerer; spots the hardware angle' },
  { key: 'leila-hosseini', name: 'Leila Hosseini', iso: 'IR', fips: 'IR', country: 'Iran', role: 'Authority / Analysis', lane: 'Authority', voice: 'precise analyst; careful with claims' },
  { key: 'emre-yildiz', name: 'Emre Yıldız', iso: 'TR', fips: 'TU', country: 'Türkiye', role: 'Defense-01 Building Guard', lane: 'Defense', voice: 'blunt, loyal, a little wry' },
  { key: 'jonas-weber', name: 'Jonas Weber', iso: 'DE', fips: 'GM', country: 'Germany', role: 'System Liaison / Pylon Interface', lane: 'Specialist', voice: 'systematic; explains how the parts connect' },
  { key: 'priya-srisawat', name: 'Priya Srisawat', iso: 'TH', fips: 'TH', country: 'Thailand', role: 'Marketing / Public Surface', lane: 'Support', voice: 'reads the public mood and the story behind the story' },
  { key: 'helen-clarke', name: 'Helen Clarke', iso: 'GB', fips: 'UK', country: 'United Kingdom', role: 'Authority-02 Director', lane: 'Authority', voice: 'crisp, understated, decisive' },
  { key: 'marc-dubois', name: 'Marc Dubois', iso: 'FR', fips: 'FR', country: 'France', role: 'Mission Sponsor', lane: 'Authority', voice: 'polished, sceptical, cultured' },
  { key: 'thandiwe-nkosi', name: 'Thandiwe Nkosi', iso: 'ZA', fips: 'SF', country: 'South Africa', role: 'Cohort-03 Lead peer', lane: 'Lead', voice: 'grounded leader, plain speech' },
  { key: 'hana-lee', name: 'Hana Lee', iso: 'KR', fips: 'KS', country: 'South Korea', role: 'Engineer and robotics researcher, mentor to Aya Shinoda', lane: 'T', voice: 'inventive engineer; excited by how things are built' },
].map(Object.freeze));

export const PRIM3_AGENT_BY_KEY = Object.freeze(Object.fromEntries(PRIM3_AGENTS.map(a => [a.key, a])));
