# Kickstart Humanity / Humanity's Kickstart — one mission per song

Brand working titles only. Trademark clearance and payment/legal review pending.

## Source completeness
The canonical repository catalog `data/albums.json` currently lists 20 tracks across 8 releases. Only some entries reference lyric JSON, and some referenced JSON paths may not exist in the repository. These are **proposals**, not a claim that every full lyric has been read. Before publishing, reconcile actual uploaded audio and approved lyric text; live `creator_tracks` currently has zero rows in the checked Supabase project. Do not auto-create public missions based only on a song title.

## Track-by-track draft

| Release | Song | One proposed mission | Path | Source confidence |
|---|---|---|---|---|
| I AM HERE | Who Did The Shoot | Shoot the Solution: film one approved community project and deliver its usable media kit | Amplify | lyric CTA + theme |
| I AM HERE | Runway Walk | Put Them On: build a public-facing page for an overlooked creative or local service | Create | commerce context only |
| I AM HERE | Write a Song | Write the Change: submit an original, rights-cleared collaboration for cohort review | Create | title + commerce context |
| I AM HERE | Here | Make Your Presence Count: publish an accessible profile documenting one useful skill and offered service | Create | commerce context only |
| I AM HERE | Antisocial | Scroll Less, Make Something: deliver an approved campaign video and distribution plan | Amplify | lyric JSON referenced |
| I AM HERE | Lightroom | Make the Invisible Visible: photograph a consenting community organization and deliver usable images | Amplify | title + commerce context |
| PRIM3 | Got WiFi? | Get Connected: help someone access a legitimate connectivity resource or digital-service application | Show Up | lyric JSON referenced |
| Docket 516R | Environmental Injustice | Map the Harm: research and publish a sourced local environmental-impact case | Amplify | lyric JSON referenced; verify file |
| Docket 516R | Environmental Injustice (Brave mix) | Bring the Receipts: prepare an evidence-backed community testimony packet | Show Up | lyric JSON referenced |
| Docket 516R | Please Set Me Free | Open a Door: connect someone to a qualified support organization with consent | Show Up | lyric JSON referenced; verify file |
| Docket 516R | Money or the Power | Follow the Money: document a specific public expenditure and who benefits, with citations | Amplify | lyric JSON referenced |
| Heal the 3 | Deep End | Reach Back: assemble and deliver a verified resource referral with a local support partner | Show Up | lyric JSON referenced; verify file |
| Heal the 3 | Heal the 3rd World | One Safe Night: fund and arrange one consensual, verified hotel stay for someone without shelter | Show Up | title/campaign theme; lyric text not in catalog |
| Vaunt EP | Vaunt (Acoustic) | Give Them a Stage: produce an approved showcase for an emerging artist | Create | title/release context only |
| Whip Equipped | Dealer Plates (A-Side) | Road to Work: connect someone to verified transportation assistance for employment | Show Up | lyric JSON referenced; verify file |
| Whip Equipped | Dealer Plates (B-Side) | Keys to Opportunity: produce a practical transport-resource explainer | Amplify | title/release context only |
| Singles | Upset | Turn Frustration Into Action: submit a documented local problem and workable response | Show Up | lyric JSON referenced; verify file |
| CIA Mind Control | You the Feds | Check the Facts: create a sourced guide to lawful privacy and accountability rights | Amplify | title only; needs artist approval |
| CIA Mind Control | Pull Up | Pull Up for Good: volunteer with an established community partner and log the work | Show Up | title only; needs artist approval |
| CIA Mind Control | Niggy Nigg Niggr | Artist review required before proposing a mission; avoid inferring meaning from the title | TBD | no lyric source |

## Mission structure
Each approved track gets **at most one** flagship `action_missions` row. Inside it, offer a staged ladder (discover, contribute, deliver, verify, lead), with optional paid funding and an unfunded path. `Fund a Mission` is a global participation action, **not an extra song mission**. The same member can fund and do; financial flows and mission proof remain distinct.

## One Safe Night beta
1. Doer estimates lodging, taxes/fees, transit, food, and any creator labor; disclose every amount and the funding goal.
2. Funder supports the scoped mission through compliant payment rails. Funding alone does not guarantee hotel acceptance.
3. Verify eligibility and accommodation with a partner and the participant's consent; account for hotel ID, deposit, age, check-in and safeguarding requirements.
4. Pay hotel/provider directly when possible; separately document creator/service fees.
5. Verify a completed stay with a receipt or trusted partner attestation; do **not** require a vulnerable person to appear in a video or disclose their location.
6. Creator may film the volunteer process or an opt-in interview without conditioning aid on consent.

## Cohort progression
`Write the Change` may serve as an **application task**, with an original work sample reviewed for cohort eligibility. Approval does not automatically seat a member: existing fellowship/cohort admission governance stays in force. Advanced `Follow the Money` research requires evidence literacy and review; do not lock all free missions behind payments.

## Implementation gates
Do not delete or mass-retire 36 missions before reviewing assignments and funded obligations. Add explicit track linkage, mission stages, a funder/doer budget ledger, refund policy, creator compensation rules, and an admin approval queue. Only activate songs with confirmed lyrics/rights, a validated mission rubric and tested payment flows.
