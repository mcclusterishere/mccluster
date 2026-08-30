# THE GATES: premium applications, and the lock that holds them shut

    https://matthew.mccluster.org/lanes.html   (owner login)

You asked for the system to lock a lane until you can prove you qualify.
That's what this is. Every gate is a row, every gate counts your own
catalog, and a lane reads **LOCKED** until every one of its gates is met.
Nothing opens on a feeling.

---

## PART 1: WHAT EACH PREMIUM HOUSE IS ACTUALLY LOOKING FOR

### Stocksy United: 50 to 75% + shareholder. The best rate in the industry.

**What they want:** *originality, creativity, consistency and exciting
ideas.* They say outright you don't need years of industry experience.
Minimum **25 images**. They accept high-res digital, film scans, Polaroid
scans and mobile. The camera matters less than the eye.

**The opening nobody tells you about:** they are **already
well-represented in landscape, nature, wildlife and weddings**, and say
applicants working *outside* those areas are more likely to get in.

Authentic Black civic and community life in metro Atlanta is exactly
outside those areas. That is not a consolation prize. It is the strongest
angle any applicant can have, and it's the work you already do.

**⚠ THE CATCH, AND IT IS ENORMOUS:** Stocksy requires **image AND video
exclusivity.** Anything you place there cannot be licensed through any
other agency: not Adobe, not Shutterstock, not Alamy. Personal portfolio
sites and gallery prints are fine; agencies are not.

**So this is a fork in the road, not a checklist item.** The system encodes
it as a `conflict` gate: onboard Adobe Stock and the Stocksy door shuts for
those files. Decide deliberately.

My read: **shoot a dedicated Stocksy body of work.** Keep the assignment
archive non-exclusive across the 22 microstock lanes, and build a separate
25 to 40 frame set, released, authored, coherent, that goes to Stocksy
alone. You get both.

**Go shoot:** released portraits of real people in real settings. Community
business owners at work. Multi-generational family life. Civic participation
that isn't a news event. Interiors of Black-owned businesses. The thing
buyers search for and microstock is worst at.

### Westend61: 40 to 60%, curated German agency

**What they want:** *talent, creativity and ambition*: a special look, a
distinct choice of topics, a personal style that is visibly yours. Their
stated position is **100% real people, no synthetic faces.**

**Practical:** JPG/PNG submissions must be **under 6 MB each**. Non-exclusive.

**Go shoot:** European buyers license lifestyle and business heavily. Real
people working, meeting, commuting, eating. Released.

### Cavan Images: ~50%, authentic lifestyle

**What they want:** real people in real situations, diverse and un-staged.
They're deliberately building the collection microstock is worst at.

**Go shoot:** the same body as Stocksy. If you go non-exclusive, this is
where that work lives instead.

### Redux Pictures: editorial and portrait representation

**Different question entirely.** Redux takes on **assignment
photographers**. They're assessing whether they could send you on a job
tomorrow. **Published bylines carry more weight than portfolio volume.**

**Go get:** a byline. One published credit from Decaturish or Rough Draft
Atlanta moves this needle further than 200 more frames. That's why the
local-press lane sits at priority 1 on the board.

### Offset (Shutterstock): premium tier, invitation

**Don't apply cold.** Invitations typically go to established Shutterstock
contributors. Build that account, produce well, let them come. The system
encodes this as a conflict gate pointing the other way: do Shutterstock
first.

---

## PART 2: THE LOCK

### Three kinds of gate

| Kind | What it does |
|---|---|
| **COUNT** | You need N captures matching a filter: reviewed, release-clear, a given kind. Counted live against `vault_assets`. Shows a real percentage, so you know how far off you are. |
| **FLAG** | A fact about the house: releases on file, published bylines, a portfolio URL, copyright registered. Set on the desk. |
| **CONFLICT** | A lane that *cannot* coexist with another. Exclusivity isn't a hurdle you clear; it's a door that closes others. |

### What's gated, and why

- **Every microstock lane** needs 10 reviewed, release-clear frames, the
  entry test Adobe, Shutterstock and Alamy all run.
- **Every microstock and premium lane** needs the **copyright backlog
  registered**. Register *before* you distribute: once a file is out on
  twenty agencies you've lost the cheapest protection you'll ever buy.
- **Every wire** needs 20 reviewed editorial frames and a portfolio URL
  that resolves.
- **AP and Getty Editorial** additionally need bylines on the record.
- **Stocksy** needs 25 release-clear + 40 total + releases on file + the
  exclusivity conflict clear.
- **Redux** needs bylines: the gate that says volume won't substitute.

### The house facts panel

Four fields at the top of `lanes.html` drive every FLAG gate:

- **Published bylines**: a number. Above zero unlocks the byline gates.
- **Portfolio URL**: defaults to `walls.html`, which is what those wall
  pages were built for.
- **PLUS ID**: after Supporting Membership.
- **Copyright filed**: flips once you've registered (or once a
  `vault_filings` row reaches `registered`).

---

## PART 3: CREDENTIALS, AND ONE HONEST WARNING

Every lane on the desk has a credential block: protocol, host, username,
secret name, account email, remote directory. Fill it in, hit **Save
credentials**, and the lane shows **wired**. That's the tie-back you asked
for: the pusher reads these rows, so a new agency needs no code, only a
form.

### ⚠ Read this before you type a password

The table has a `password` column and RLS keeps every other signed-in user
out of it. But **anyone holding the `service_role` key, or anyone with direct database
access, can read it in plain text.** That is true of any credential you
put in a normal Postgres column, and I'm not going to pretend otherwise.

**Use `secret_ref` instead.** Put the actual password in a **GitHub Secret**
(Settings → Secrets and variables → Actions), then type the secret's *name*
into the desk:

| Field | Value |
|---|---|
| Host | `sftp.contributor.adobestock.com` |
| Username | `your-contributor-id` |
| Secret name | `ADOBE_SFTP_PASS` |

The pusher runs on the GitHub runner, reads the host and username from the
database and the password from the secret. You get one screen of control,
and the password never sits anywhere readable.

Storing the password directly still works. It's your call, and for a
throwaway account on a small agency it's a reasonable trade. Just make it
knowingly.

---

## Setup

1. Supabase → SQL Editor → run **`docs/the-vault-gates.sql`**
   (after `the-vault.sql`, `the-vault-ids.sql`, `the-vault-targets.sql`).
   Self-check prints `gates armed` with how many lanes are locked.
2. Open **`lanes.html`**, sign in as owner.
3. Fill the house facts. Watch lanes unlock.

Every lane shows a live percentage. A locked lane at 60% tells you exactly
how many more reviewed frames stand between you and the application,
which is the difference between "someday" and a number you can shoot toward
this week.
