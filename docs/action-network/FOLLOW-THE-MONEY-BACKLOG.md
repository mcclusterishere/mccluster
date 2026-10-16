# Backlog: "Follow the money" (not built, not shown)

Owner, 2026-10-15: later, "Map who is represented" becomes **Follow the money**: a property-level
backend map of who owns what and why, plus the political lean (left / right / center) of
publications. Do not show it yet. This file only records sources, licensing and the boundary.

## The boundary

- **Allowed:** lean or bias ratings of **publications and organizations**, taken from a named,
  licensed rater, shown with the rater's name and date. Ownership of **property by companies,
  trusts, governments and other entities**, from public records.
- **Not allowed:** inferring or labelling the political views of **private individuals**: owners,
  members, donors, voters or readers. No voter-level profiling, no sensitive-trait inference, no
  targeting (the execution brief's CRM rule). A person who owns property appears, if at all, as the
  public record shows them, never with a lean attached.
- "Motivation" is shown only as what a record states (an LLC's filed purpose, a lobbying
  disclosure, a campaign-finance filing by an organization), never as a guess.
- Election activity stays separate from the nonprofit's activity.

## Candidate sources (licensing to verify before any integration)

Live research was cut off by a search limit on 2026-10-15; every licence line below is
**UNVERIFIED** and must be read from the provider's current terms before use.

| Need | Source | Licensing to check |
| --- | --- | --- |
| Parcel ownership | County assessor / recorder open data (e.g. Connecticut towns' assessor rolls; CT Open Data portal) | varies by county and town: some public domain, some no-redistribution or fee |
| National parcel layer | Regrid, ATTOM, CoreLogic | commercial licences; redistribution on a public map usually restricted |
| Who is behind an LLC | OpenCorporates | open data under ODbL (attribution and share-alike) for public-benefit use; commercial and API use under paid licence |
| State business filings | Connecticut Secretary of the State business records (CT Open Data) | state open data terms |
| Campaign finance (organizations, committees) | FEC API (api.data.gov key), state SEEC (Connecticut) | public; FEC prohibits using contributor names for soliciting or commercial purposes |
| Lobbying | Senate LDA / House disclosures; OpenSecrets | federal disclosures public; OpenSecrets data under its own licence (non-commercial terms) |
| Publication lean | AllSides Media Bias Ratings | published under a Creative Commons licence with attribution and non-commercial terms; commercial use by licence |
| Publication reliability and bias | Ad Fontes Media | licensed data; commercial and API use require an agreement |
| News for mission discovery | GDELT | open, with citation |

## Questions for the owner

1. Which county first (Connecticut town assessor data is per town)?
2. Is McCluster Corp's use non-commercial for each licence (a public charity running a product)?
   Counsel should answer before any NC-licensed data is shown.
3. One rater for lean, or two side by side with their names?
