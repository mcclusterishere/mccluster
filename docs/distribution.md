# DISTRIBUTION: what can actually be automated, and what can't

You caught the hole: **YouTube takes video, not stills.** Photographs cannot
go to YouTube except as a rendered slideshow or Short, which is a different
product with a different edit. That was sloppy of me to list without saying
so. Here is the honest map, and it now lives in the database too
(`vault_targets`), so the desk can never offer a one-tap push to a place
that has no door.

## The lanes, by what they actually accept

| Target | Takes | Rail | What you need first |
|---|---|---|---|
| **Instagram** | photo + video | **Real API** | Professional account + linked Facebook Page + Meta app with `instagram_content_publish`. **App Review: 2 to 4 weeks.** No per-call fee |
| **Facebook Page** | photo + video | **Real API** | Same Meta app, nearly free once Instagram is approved |
| **TikTok** | photo + video | **Real API** | TikTok for Developers app + Content Posting API audit |
| **YouTube** | **video only** | **Real API** | Google Cloud project + OAuth, YouTube Data API v3 |
| **Flickr** | photo | **Real API** | API key. Oldest and friendliest photo upload API; indexes well |
| **SmugMug** | photo | **Real API** | Account + API key. Galleries and client proofing built in |
| **Adobe Stock** | photo + video | **SFTP bulk** | Contributor account. Metadata rides in the file's IPTC, which the Vault already stamps |
| **Alamy** | photo + video | **FTP bulk** | Contributor account. Higher royalty share than most |
| **Shutterstock** | photo + video | **FTP** | Contributor account |
| **Getty / iStock** | photo + video | **Portal only** | Application + portfolio review. **No public upload API for individual contributors** |
| **Client delivery** | both | our own Storage | Nothing; the stamped previews are already there |
| **Press / editorial** | both | manual email | Nothing. Logged so the ledger stays complete |

### What this means in practice

The stock lanes (Adobe, Alamy, Shutterstock) are **bulk file drops**, not
APIs, and that is *good news*, because a file drop is the easiest thing in
the world to automate and the metadata travels inside the file. The Vault
already stamps creator, copyright, credit, PLUS licensor and catalog id
into every derivative, so an Adobe Stock SFTP push is close to free work
once you have the contributor account.

The social lanes are real APIs but gated behind **app review**; Meta's is
the long pole at 2 to 4 weeks. Worth starting now if you want it, because the
review clock runs whether or not the code is written.

Getty is the one that genuinely cannot be automated at your tier. Prep the
files here, upload by hand, log the push.

### Before you build any of it: read docs/stock-lanes.md

The earnings math there is the thing that should decide the build order,
and it says something uncomfortable: microstock at 100 photos a week is
roughly $5 to $15 an hour in year one, against a benchmark of about **$1.00 per
image per year**. One assignment beats a year of it. Stock is a byproduct
lane you feed with work you already got paid for, not a business to build a
week around. The lane that genuinely fits this shooter is **editorial /
news**, where the frames already exist and no model release is needed.

### Build order I'd recommend

1. **Client delivery**: already 90% there, and it is the lane that pays now.
2. **Flickr or SmugMug**: simplest real API, no review, immediate archive
   mirror with good indexing.
3. **Adobe Stock SFTP**: passive income lane, and the metadata work is done.
4. **Instagram + Facebook**: start the Meta app review in parallel with
   everything above, since the wait is the cost.
5. **YouTube**: for the long-form cuts only (Dressed for Success, recaps).
6. **Getty**: apply, then hand-upload the best of the archive.

Nothing above is wired yet. `vault_pushes` records every push you make by
hand today, so the ledger is complete from day one and each lane can be
automated later without losing history.
