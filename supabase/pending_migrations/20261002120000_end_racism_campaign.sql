-- CAMPAIGN 002 · END RACISM — the chapter behind end-racism.html.
--
-- PENDING: not applied to production. Data only: one row in
-- public.action_campaigns (the Uprise Action Network tables already
-- exist). end-racism.html features this campaign alone and says the
-- chapter is being written until the row is live; /action/?c=end-racism
-- renders it once it is.
--
-- Every fact below is quoted or closely paraphrased from the linked
-- primary source (checked 2026-10-02). Money is off: no page asks for
-- money for this campaign until the owner turns it on in Control.

insert into public.action_campaigns
  (id, slug, status, title, kicker, headline, body, facts, sources, phases, current_phase,
   people_goal, money_goal_cents, money_enabled, allocation_note, chapter, sort)
values (
  'end-racism-002', 'end-racism', 'live',
  'The End Racism Action Mission',
  'Campaign 002 · Racism · United States',
  'You see it. Now pull up.',
  'Racism shows up in who gets hurt, who gets called back, and who gets to keep what they build. The numbers below come from the FBI, the Federal Reserve, the Bureau of Labor Statistics and a nationwide hiring experiment. Seeing it is attention. Organized people are power. Equity Uprise is organizing people, skills, research and reach toward measurable work against racism: chosen with partners, and published as it happens.',
  '[
    {"text": "Race, ethnicity or ancestry was the bias behind 52.5% of the victims of single-bias hate crimes reported to the FBI in 2023, more than any other motive.", "source": "U.S. Department of Justice, 2023 FBI Hate Crime Statistics", "url": "https://www.justice.gov/archives/hatecrimes/2023-hate-crime-statistics"},
    {"text": "In 2022 the typical White family held $285,000 in wealth; the typical Black family held $44,900, about 15 percent as much.", "source": "Federal Reserve, FEDS Notes, Oct 2023", "url": "https://www.federalreserve.gov/econres/notes/feds-notes/greater-wealth-greater-uncertainty-changes-in-racial-inequality-in-the-survey-of-consumer-finances-20231018.html"},
    {"text": "Across more than 83,000 fake job applications sent to 108 of the largest U.S. employers, distinctively Black names cut the chance of hearing back by 2.1 percentage points, and a fifth of the companies accounted for nearly half of the lost callbacks.", "source": "Kline, Rose & Walters, NBER Working Paper 29053", "url": "https://www.nber.org/papers/w29053"},
    {"text": "In 2023 the unemployment rate was 5.5% for Black or African American workers and 3.3% for White workers.", "source": "U.S. Bureau of Labor Statistics, Labor force characteristics by race and ethnicity, 2023", "url": "https://www.bls.gov/opub/reports/race-and-ethnicity/2023/home.htm"}
  ]'::jsonb,
  '[
    {"label": "2023 Hate Crime Statistics", "publisher": "U.S. Department of Justice", "url": "https://www.justice.gov/archives/hatecrimes/2023-hate-crime-statistics"},
    {"label": "Greater Wealth, Greater Uncertainty: Changes in Racial Inequality in the Survey of Consumer Finances", "publisher": "Federal Reserve", "url": "https://www.federalreserve.gov/econres/notes/feds-notes/greater-wealth-greater-uncertainty-changes-in-racial-inequality-in-the-survey-of-consumer-finances-20231018.html"},
    {"label": "Systemic Discrimination Among Large U.S. Employers", "publisher": "NBER", "url": "https://www.nber.org/papers/w29053"},
    {"label": "Labor force characteristics by race and ethnicity, 2023", "publisher": "U.S. Bureau of Labor Statistics", "url": "https://www.bls.gov/opub/reports/race-and-ethnicity/2023/home.htm"}
  ]'::jsonb,
  '[
    {"key": "mobilize", "title": "Mobilize", "detail": "10,000 people in the Action Network."},
    {"key": "investigate", "title": "Investigate", "detail": "Map where the gaps are widest and who is already closing them."},
    {"key": "build", "title": "Build", "detail": "Publish the plan, the partners and how results will be measured."},
    {"key": "fund", "title": "Fund", "detail": "Resource the plan, in public."},
    {"key": "deploy", "title": "Deploy", "detail": "Back partner-vetted work where it counts."},
    {"key": "prove", "title": "Prove", "detail": "Publish outcomes, spending and evidence."}
  ]'::jsonb,
  'mobilize', 10000, null, false,
  'No money is being collected for this campaign. If that changes, every dollar received and spent will be published here.',
  '{"region": "United States", "title": "Racism", "line": "It shows up in the numbers."}'::jsonb,
  2
)
on conflict (id) do nothing;
