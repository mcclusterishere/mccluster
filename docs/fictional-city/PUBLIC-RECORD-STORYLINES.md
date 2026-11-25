# Public-record storylines

Owner decision, November 3, 2026: the city’s corruption storylines reenact **real, proven** public-record
cases with the real people who did them. This is the readable companion to `publicRecordArcs` in the
single lore source, [`core/data/fictional-city/district.v1.json`](../../core/data/fictional-city/district.v1.json).
Edit the manifest first, then this page.

## The rule

- Depict only facts established by a **conviction, guilty plea, court finding or official record**. Every
  scene names its `basis` and carries `sources: [{title, url, date}]` from a primary record or a reputable outlet.
- Show real people only doing what the record establishes. No invented wrongdoing; no implication that an
  uncharged, acquitted or untried person is guilty; no current officer outside a case shown as corrupt.
- Quotations are verbatim from the cited source. Other dialogue is paraphrase that stays faithful to the record.
- Pending charges are reported as pending, with their own source.
- Every scene carries the line **Based on the public record** and its links. That is sourcing, not a disclaimer.
- Real people never become playable residents, middlemen or staff, and no payoff interaction names a real
  institution or person (`scripts/test/fictional-city.test.mjs`, `core/test/game-lore.test.mjs`).

## Placement

These arcs are kept in `publicRecordArcs`, beside `storyArcs`, because the playable story runtime requires
every beat to sit on a placed Bridgeport story stop. They are `public-record-reader` arcs with
`placement: "unplaced"`: Ignacio Delgado, the porch historian, reads them from his second ledger (his
`ignacio-delgado-record` topic). A later spatial change may bind them to their real public locations.

## The Wastewater Contract

A federal jury convicted Bridgeport’s mayor in 2003 of racketeering, extortion, bribery and related crimes tied to city contracts. Three scenes follow the case through the record.

**Real people in this arc**

- **Joseph P. Ganim**, Mayor of Bridgeport, first elected 1991; convicted 2003. Basis: conviction. Shown only doing what the 2003 jury verdict, the sentence and the 2007 appeal decision establish.
- **Leonard J. Grimaldi**, Head of Harbor Communications; associate of the mayor. Basis: guilty plea. Named only as a recipient of the payment the jury found was extorted from PSG, and as a source of the kickback; he pleaded guilty before trial.
- **Paul J. Pinto**, Of the Kasper Group; associate of the mayor. Basis: guilty plea. Named only as a recipient of the payment the jury found was extorted from PSG; he pleaded guilty before trial.
- **Janet Bond Arterton**, U.S. District Judge, District of Connecticut. Basis: official record. Shown presiding and imposing the sentence.

**Established:** Convicted on 16 counts on March 19, 2003; sentenced July 1, 2003 to nine years, three years of supervised release and a $150,000 fine; convictions upheld by the Second Circuit on December 4, 2007. Released in 2010; elected mayor again in 2015.

**Not depicted:** No PSG employee, developer or other co-defendant is named or shown beyond the record cited. Ganim’s later terms are not depicted as involving this case.

### 1. The Condition (1996)

Basis: **conviction**.

1996. The City of Bridgeport needs an operator for its wastewater treatment plants. A company called Professional Services Group, PSG, wants the contract.

According to the federal case, Mayor Joseph P. Ganim selected PSG on a condition: the company had to pay $350,000 to two of his associates, Leonard J. Grimaldi and Paul J. Pinto. The jury found this was extortion.

In 1999 the mayor approved an 18-year extension of PSG’s contract. Grimaldi’s consulting fee from PSG followed, and about a third of it, roughly $150,000, went back to the mayor. The jury convicted him of bribery for that kickback.

*Based on the public record:* [Former Bridgeport Mayor Convicted (U.S. Attorney, District of Connecticut)](https://www.justice.gov/archive/tax/usaopress/2003/txdv0320030319.html) (2003-03-19); [Former Bridgeport Mayor Sentenced to Nine Years (U.S. Attorney, District of Connecticut)](https://www.justice.gov/archive/tax/usaopress/2003/txdv0320030701-3.htm) (2003-07-01).

### 2. Sixteen Counts (2003-03-19)

Basis: **conviction**.

March 19, 2003. After a two-month trial in federal court, a jury convicts Joseph P. Ganim on 16 counts: racketeering, racketeering conspiracy, extortion, mail fraud, bribery, conspiracy and filing false income tax returns.

The conduct behind the verdict: more than $500,000 in cash, meals, entertainment, merchandise, home improvements and professional services from people whose firms received city contracts in return.

Grimaldi, Pinto and eight others had already pleaded guilty to racketeering, bribery and tax fraud.

*Based on the public record:* [Former Bridgeport Mayor Convicted (U.S. Attorney, District of Connecticut)](https://www.justice.gov/archive/tax/usaopress/2003/txdv0320030319.html) (2003-03-19).

### 3. Nine Years (2003-07-01)

Basis: **court finding**.

July 1, 2003. In New Haven, U.S. District Judge Janet Bond Arterton sentences Ganim to nine years in prison, three years of supervised release and a $150,000 fine.

On December 4, 2007, the U.S. Court of Appeals for the Second Circuit upholds the convictions.

Ganim is released in 2010 after about seven years in federal prison. In November 2015, Bridgeport voters elect him mayor again.

*Based on the public record:* [Former Bridgeport Mayor Sentenced to Nine Years (U.S. Attorney, District of Connecticut)](https://www.justice.gov/archive/tax/usaopress/2003/txdv0320030701-3.htm) (2003-07-01); [United States v. Ganim, 510 F.3d 134 (2d Cir. 2007)](https://www.leagle.com/decision/2007644510f3d1341642) (2007-12-04); [Federal appeals court upholds Ganim’s conviction (Hartford Business Journal)](https://hartfordbusiness.com/article/federal-appeals-court-upholds-ganims-conviction/) (2007-12-04); [Joe Ganim says victory in Bridgeport mayoral race is redemption (WSHU)](https://www.wshu.org/government/2015-11-03/joe-ganim-says-victory-in-bridgeport-mayoral-race-is-redemption) (2015-11-03).

## The Chief’s Exam

In 2018 Bridgeport’s search for a permanent police chief was rigged for the man who got the job. He and the city’s acting personnel director pleaded guilty in 2020.

**Real people in this arc**

- **Armando “A.J.” Perez**, Bridgeport police chief, appointed permanent chief in 2018; resigned 2020. Basis: guilty plea. Shown only doing what his guilty plea and sentencing establish: receiving confidential exam information, having others prepare his exam work, and lying to federal investigators.
- **David Dunn**, Bridgeport acting personnel director; resigned 2020. Basis: guilty plea. Shown only doing what his guilty plea and sentencing establish: giving Perez confidential exam material and tailoring the scoring, and making false statements to investigators.
- **Kari A. Dooley**, U.S. District Judge, District of Connecticut. Basis: official record. Shown taking the plea and imposing sentence; her quoted words are verbatim from the cited report.

**Established:** Both men pleaded guilty in October 2020 to conspiracy to commit wire fraud and making false statements to the FBI. Perez was sentenced on April 12, 2021 to a year and a day; Dunn on April 13, 2021 to four months; restitution to the city of nearly $300,000.

**Not depicted:** The two officers who wrote essays for Perez are not named or shown. Mayor Joseph Ganim, who appointed Perez, was not charged in this case and denied wrongdoing; he does not appear in this arc. No current Bridgeport officer is depicted.

### 1. The Answers (2018)

Basis: **guilty plea**.

2018. Bridgeport is choosing a permanent police chief through a civil-service exam. Armando “A.J.” Perez wants the job.

David Dunn, the city’s acting personnel director, gives Perez confidential material: the oral exam questions and the scoring guide for the written essays. The scoring is tailored in Perez’s favor.

Perez has two officers write his essays and submits their work as his own. He finishes among the top three, and the city gives him a five-year contract as permanent chief.

*Based on the public record:* [Ex-police chief pleads guilty to rigging exam process for job (Associated Press via Law Officer)](https://www.lawofficer.com/ex-police-chief-pleads-guilty-to-rigging-exam-process-for-job/) (2020-10-05); [Former Bridgeport police chief sentenced to prison (NBC Connecticut)](https://www.nbcconnecticut.com/news/local/former-bridgeport-police-chief-sentenced-to-prison/2464402) (2021-04-12); [Ex-Bridgeport police chief gets prison time for rigging police exam (WABC)](https://abc7ny.com/ex-bridgeport-pd-chief-gets-prison-time-for-rigging-police-exam/10509875/) (2021-04-12).

### 2. Yes, Your Honor (2020-10-05)

Basis: **guilty plea**.

September 2020. After the indictment is announced, Perez and Dunn resign.

October 2020, federal court in Bridgeport. Both men plead guilty to conspiracy to commit wire fraud and to making false statements to the FBI.

Judge Kari A. Dooley asks Perez whether he enlisted others to prepare his written and oral exams. Perez answers: “Yes, your honor.”

*Based on the public record:* [Ex-police chief pleads guilty to rigging exam process for job (Associated Press via Law Officer)](https://www.lawofficer.com/ex-police-chief-pleads-guilty-to-rigging-exam-process-for-job/) (2020-10-05); [Former Bridgeport police chief sentenced to prison (NBC Connecticut)](https://www.nbcconnecticut.com/news/local/former-bridgeport-police-chief-sentenced-to-prison/2464402) (2021-04-12).

### 3. The Oath (2021-04-12)

Basis: **court finding**.

April 12, 2021. Judge Dooley sentences Perez to a year and a day in prison, followed by supervised release.

“You betrayed your oath and every member of the department who took the same oath,” the judge tells him.

The next day she sentences Dunn to four months in prison. The two are ordered to pay nearly $300,000 in restitution to the city.

*Based on the public record:* [Ex-Bridgeport police chief gets prison time for rigging police exam (WABC)](https://abc7ny.com/ex-bridgeport-pd-chief-gets-prison-time-for-rigging-police-exam/10509875/) (2021-04-12); [Former Bridgeport police chief sentenced to prison (NBC Connecticut)](https://www.nbcconnecticut.com/news/local/former-bridgeport-police-chief-sentenced-to-prison/2464402) (2021-04-12); [Judge sentences ex-Bridgeport personnel director to four months (WSHU)](https://www.wshu.org/news/2021-04-13/judge-sentences-ex-bridgeport-personnel-director-to-four-months) (2021-04-13).

## The Drop Boxes

In 2023 a Connecticut judge threw out Bridgeport’s Democratic mayoral primary after reviewing surveillance video of absentee-ballot drop boxes, and ordered it held again.

**Real people in this arc**

- **William Clark**, Connecticut Superior Court Judge. Basis: court finding. Shown issuing the November 1, 2023 ruling; his quoted words are verbatim from the cited report.
- **John Gomes**, Mayoral candidate; plaintiff. Basis: court finding. Shown losing the first primary and bringing the challenge the court upheld.
- **Wanda Geter-Pataky**, Vice chair, Bridgeport Democratic Town Committee (2023). Basis: court finding. Appears only through what the civil court found from video and from her refusal to testify. Her separate criminal charges are pending and unproven; no scene shows her committing a crime.
- **Joseph P. Ganim**, Incumbent mayor and primary candidate. Basis: official record. Shown only as a candidate and in the election results. The court made no finding that he took part; he testified he never discussed distributing absentee ballots with Geter-Pataky.

**Established:** Ganim won the September 12, 2023 primary by 251 votes; on November 1, 2023 Judge William Clark ordered a new primary; Ganim won the rerun primary on January 23, 2024 and the rerun general election on February 27, 2024.

**Record status:** As of August 25, 2026, Geter-Pataky faced criminal charges related to the 2019 and 2023 primaries, had not pleaded guilty, had rejected a plea offer and had chosen a jury trial that was not yet scheduled. She is presumed innocent of those charges.

**Not depicted:** No crime is shown being committed. No other person in the videos is named. The scenes do not imply that Ganim or any uncharged person took part.

### 1. 251 Votes (2023-09-12)

Basis: **official record**.

September 12, 2023. In Bridgeport’s Democratic primary for mayor, the incumbent, Joseph P. Ganim, defeats John Gomes by 251 votes.

Gomes goes to court. His evidence includes surveillance video of the city’s absentee-ballot drop boxes.

*Based on the public record:* [Judge orders new Bridgeport mayoral primary (CT Mirror)](https://ctmirror.org/2023/11/01/bridgeport-primary-election-ruling-ganim-gomes/) (2023-11-01); [Judge orders new Bridgeport mayoral primary after surveillance videos show possible ballot stuffing (NBC Connecticut)](https://www.nbcconnecticut.com/news/local/judge-orders-new-bridgeport-mayoral-primary-after-surveillance-videos-show-possible-ballot-stuffing/3138308/) (2023-11-01).

### 2. Not Random (2023-11-01)

Basis: **court finding**.

November 1, 2023. Superior Court Judge William Clark rules that Gomes’s claims of absentee-ballot fraud merit a new election, and orders a new primary.

The judge finds that numerous videos show Wanda Geter-Pataky, vice chair of the Democratic Town Committee, delivering ballots to drop boxes and helping others do so. Those instances, he writes, “do not appear to the court to be random.” He finds that violations of law occurred in two voting districts.

Geter-Pataky invoked her Fifth Amendment right 71 times, and the judge drew an adverse inference from her refusal to testify. The ruling makes no finding that Mayor Ganim took part; Ganim testified that he never discussed distributing absentee ballots with her.

*Record status:* Geter-Pataky’s separate criminal charges remain pending and unproven; as of August 25, 2026 she had rejected a plea offer and chosen a jury trial. [Wanda Geter-Pataky, Alfredo Castillo opt for jury trials in ballot cases (CT Mirror)](https://ctmirror.org/2026/08/25/wanda-jeter-pataky-bridgeport-absentee-ballot-alfredo-castillo-jury-trial/) (2026-08-25).

*Based on the public record:* [Judge orders new Bridgeport mayoral primary (CT Mirror)](https://ctmirror.org/2023/11/01/bridgeport-primary-election-ruling-ganim-gomes/) (2023-11-01); [Judge orders new Bridgeport mayoral primary after surveillance videos show possible ballot stuffing (NBC Connecticut)](https://www.nbcconnecticut.com/news/local/judge-orders-new-bridgeport-mayoral-primary-after-surveillance-videos-show-possible-ballot-stuffing/3138308/) (2023-11-01).

### 3. Twice More (2024-02-27)

Basis: **official record**.

The November 2023 general election goes ahead on schedule, but its mayoral result does not stand once the court orders a new primary.

January 23, 2024. Democrats vote again. Ganim wins the rerun primary.

February 27, 2024. Bridgeport holds its general election for mayor a second time. Ganim wins again.

*Based on the public record:* [Connecticut mayor wins the Democratic primary in a rare election redo (NBC News)](https://www.nbcnews.com/politics/2024-election/rare-election-redo-connectict-mayor-unresolved-rcna135126) (2024-01-23); [Bridgeport mayor wins do-over election (WBUR / Associated Press)](https://www.wbur.org/news/2024/02/28/final-bridgeport-election-ganim-gomes) (2024-02-28).
