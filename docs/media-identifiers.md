# MEDIA IDENTIFIERS: the photo/video equivalent of your music stack

You hold the music side already: ISRC prefix `QT6KV`, DPID, SoundExchange
IDs, ISNI for both the corp and yourself. This is the honest map of what
exists on the photography/videography side, which is a **different world**:
there is no ISRC-equivalent registry that issues per-photo codes, and anyone
selling you one is selling paper.

What actually identifies and protects a photograph is a **stack of four**:

## 1. US Copyright Office registration: the one with teeth. DO THIS FIRST.

The single move that turns the hobby into a business. Registration is what
unlocks **statutory damages (up to $150,000 per willful infringement) and
attorney's fees**; without timely registration you can only chase actual
damages, which for a photo is usually nothing, so no lawyer takes the case.

- **Group Registration of Photographs (GRPPH / GRUPH)**: up to **750
  photographs per application**, filed at eco.copyright.gov.
- **⚠ THE PRICE GOES UP IN MID-NOVEMBER 2026: $55 → $85.** The Copyright
  Office sent its final fee schedule to Congress on 14 July 2026, which
  starts a 120-day clock; absent intervention the new fees take effect
  mid-November. That is a ~55% rise. **File your backlog at $55 before
  then.** Every frame you have ever shot can go in batches of 750.
- Register **unpublished batches before delivery**, or published batches
  within 3 months of publication (that window preserves statutory damages
  back to publication).
- Make it a ritual: **one batch filing per month or per quarter.** The
  Vault's catalog export gives you the file list and titles.
- Films register individually (Standard Application). Do the long-form
  cuts like Dressed for Success.

## 2. Your ISNI: you already own the anchor

ISNI is cross-domain: `0000 0005 2956 3111` (you) and `0000 0005 2872 7276`
(the corp) identify the *creator*, not the work, the same role it plays in
your music credits. The Vault pipeline embeds it in every derivative's
metadata. Nothing to sign up for. Done.

## 3. The catalog id: your own prefix, like QT6KV is for recordings

No society issues photo ids, so serious studios and wire services run their
own accession scheme and embed it. Ours:

    MCC-YYYYMMDD-EVENT-NNNN        e.g.  MCC-20260611-CANDLER-0007

Issued automatically by the Vault at ingest, embedded in IPTC
(`TransmissionReference`), unique forever (the database enforces it), and
printed on every license and invoice. This IS your identifier system. The
registry is your own database, which is exactly how AP, Getty and Magnum
do it.

## 4. Embedded IPTC/XMP: the metadata IS the passport

The standard is **IPTC Photo Metadata** (and IPTC Video Metadata Hub for
clips). Not a registry, a schema. The Vault stamps every derivative with:
creator, copyright notice, credit line, event, catalog id, rights web
statement. Google Images **reads and displays IPTC creator/credit** and
flags images as licensable; stripping it is illegal under DMCA §1202
(that's a claim you can bring even without registration).

## Worth having, in order

| What | What it is | Verdict |
|---|---|---|
| **PLUS Registry** | Non-profit global registry of image *licensors*: "who do I ask for a licence, and where do I find them". Basic membership is **free**; the co-op is funded by optional **Supporting Members**, who each receive a unique **PLUS Member ID** identifying that business worldwide | **Yes.** Free account now at plusregistry.org; take Supporting Membership for the PLUS ID. The Vault already stamps LicensorName + LicensorURL into every file, and `PLUS_ID` is a one-line env var away from stamping the ID too |
| **C2PA / Content Credentials** | Cryptographic provenance **signed inside the camera at capture**. It proves a frame came off a real sensor, not a model | **Yes, and your body supports it.** The **A7R V got C2PA firmware**; Sony's set now spans the A1 II, A9 III, FX3, FX30, PXW-Z300, A7R V, A7 IV, A1 and A7S III, with video verification in beta as of Camera Authenticity Solution 2026.1. Update the firmware and enable it; see the guide at c2pa.ai/sony-guide |
| **ISCC** (ISO 24138) | Content-derived code, free to generate, no registry, no fee | Optional. Cheap to bolt on later; there is a column waiting |
| **ISAN** | The audiovisual ISBN. Per-work fee via a registration agency | **Built in** (`isan` column, films only). Take it for finished films that go into real distribution; Dressed for Success qualifies. Not for social recaps |
| **EIDR** | The distribution registry the studios and streamers run on | **Built in** (`eidr` column, films only). Membership has a real annual cost; worth it the day a distributor or streamer asks for an EIDR, not before. The column exists so that day costs you nothing |
| **Getty/Adobe Stock contributor accounts** | Distribution, not identity | See docs/the-vault.md. Money lane, not ID lane |

## The one legal thing the identifiers don't cover: releases

A catalog id proves *you made it*. It says nothing about the **person in
it**. Editorial use (news, your portfolio wall) generally needs no release;
**commercial use and print sales of identifiable people do**, and minors
need a guardian's signature. That's why the Vault carries a releases table
and why Dressed for Success shipped with sales off. Paper beats vibes:
get a one-page model release into the kit bag (Snapwire/ASMP templates),
photograph the signed sheet, drop it in the vault bucket, link the row.

## The ritual, quarterly

1. Ingest everything through the Vault (ids + metadata are automatic).
2. Export the quarter's list → one group registration at eCO. Log it in
   `vault_filings`; stamp the registration number back onto the rows.
3. File the certificates in Drive next to the masters.
4. Chase releases for anything the desk shows as "rights?".

## Do these four things, in this order

1. **eco.copyright.gov: register your backlog at $55 before mid-November.**
   This is the only deadline on the list and the only identifier with teeth.
2. **plusregistry.org: free account for McCluster Corp**, then Supporting
   Membership for the PLUS ID. Put the ID in the `PLUS_ID` secret and every
   future capture carries it.
3. **Update the A7R V firmware and switch Content Credentials on.** It costs
   nothing and it is the claim that will matter most in three years.
4. **Model release into the kit bag.** A catalog id proves you made it; it
   says nothing about the person in it.
