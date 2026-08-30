# THE TAP CARD: NFC, QR, and the contact file

    https://matthew.mccluster.org/card.html

Tap a phone to a tag, the card opens. One button saves you to their
contacts. Under that: how to reach you, where you post, every door into the
site, and a form that hands *their* details back to your desk.

## First, the thing worth being clear about

**Your phone does not hold the website over NFC.** NFC tags carry a tiny bit
of text. For this, a URL. The tag says "open
`https://matthew.mccluster.org/card.html`", and the other phone opens it. So
what you're buying isn't a connection, it's **a tag with your URL written
on it**: a sticker, a card, a keyfob, a ring, a phone-case insert.

That's actually the good news. The tag never goes stale. Change your title,
your links, your prices, and the card updates for every tag you ever handed
out, because the tag only ever held the address.

## Buy the tags

Get **NTAG215** (504 bytes) or **NTAG216** (888 bytes). Either holds this
URL many times over; NTAG213 works too but is tight if you ever switch to
writing a whole vCard onto the tag.

| Form | Use it for | Rough cost |
|---|---|---|
| PVC card, blank white or black | Handing to people; feels like a business card | ~$1 to $3 each |
| Sticker (round, 25 to 30mm) | Back of your phone, the back of a real card, laptop, camera case | ~$0.30 to $1 each |
| Keyfob / wristband | Events, so it's on you without a pocket | ~$1 to $2 each |
| Epoxy phone-case insert | Tap-to-share straight off your own phone | ~$2 to $5 |

Buy from anywhere that sells NTAG215 in bulk. Avoid the pre-programmed
"smart card" services: they lock the tag to *their* URL and *their*
subscription, and you already own the page.

## Write the tag

**On Android** (any phone with NFC):

1. Install **NFC Tools** (wakdev). It's free.
2. **Write** → **Add a record** → **URL/URI**.
3. Paste `https://matthew.mccluster.org/card.html?t=nfc`
4. **Write** → hold the tag to the back of the phone until it confirms.

**On iPhone** (XS / XR and newer):

1. Install **NFC Tools**: same app, same steps. iOS *can* write tags; it
   just needs an app to do it (reading is built in).
2. Or use the **Shortcuts** app → Automation → NFC, if you'd rather trigger
   something on your own phone.

**Lock it when you're happy.** NFC Tools → **Other** → **Lock tag**. That
makes it read-only forever so nobody can overwrite your card with theirs.
Write and test *before* you lock, because locking cannot be undone.

### The `?t=` bit matters

Write `?t=nfc` on tags, `?t=qr` under printed codes. The card records how it
was opened, so your desk can tell a tap from a scan from a forwarded link.
Leave it off and it just counts as a link. Nothing breaks either way.

## How the other person reads it

- **iPhone XS and newer**: nothing to install. Screen on, unlocked, hold the
  top of the phone near the tag, and a banner drops down. They tap it.
- **iPhone 7/8/X**: NFC reading isn't automatic. They swipe into Control
  Centre and use the **NFC Tag Reader** button. This is why the QR exists.
- **Android**: NFC on (it usually is), screen unlocked, tap.

**Always have the QR too.** Roughly a third of the people you hand a card to
will have NFC off, a case in the way, or an older phone. The card carries
its own QR under **Pass it on → Show the code**, and the print files are in
the repo:

    assets/nfc/card-qr.svg   ← use this for printing, any size, stays sharp
    assets/nfc/card-qr.png   ← for anywhere that won't take an SVG

Both decode to `https://matthew.mccluster.org/card.html` and are drawn at error
correction **H** (30% of the code can be scuffed and it still reads) because
these live in pockets.

## The contact file

`mccluster.vcf` is a real vCard 3.0. The **Save to my contacts** button
links straight to it; iOS opens the add-contact sheet, Android downloads and
opens it in Contacts.

It is **generated, not typed**. `data/card.json` is the record, and:

    node tools/vcard.mjs        # rewrites mccluster.vcf
    python3 tools/qr.py         # rewrites the QR (only if the URL changed)

Edit `data/card.json`, re-run those, and the page, the contact file and the
code all say the same thing. That is the whole point: one record, three
surfaces, no chance of your card and your vCard disagreeing.

## Owner homework

1. **Add your phone number.** `data/card.json` → `reach` → the `tel` and
   `sms` entries are empty on purpose; no phone number appears anywhere in
   this repo, so none was invented. Fill in:

   ```json
   { "id": "tel", "label": "Call", "value": "(203) 555-0117", "href": "tel:+12035550117", "vcard": "TEL" },
   { "id": "sms", "label": "Text", "value": "(203) 555-0117", "href": "sms:+12035550117", "vcard": "" }
   ```

   Then `node tools/vcard.mjs`. The Call and Text buttons appear on the card
   and `TEL` appears in the saved contact. Leave them empty and they simply
   don't render; the card is correct either way.
2. **Put a face on it.** Right now the plate wears the house mark. Drop a
   headshot at `assets/img/card-portrait.jpg` (square, ~600×600, under
   150 KB) and set `person.photo` to that path. A face closes more than a
   logo does. The only reason there isn't one is that the frames in this
   repo are night shots of you looking down at a phone, which is not a
   business-card face.
3. **Order the tags, write one, test it on someone else's phone**, then
   lock the rest.
4. **Print the QR** on the back of the physical cards, on the van, on the
   gallery wall next to the prints.

## Where the swaps land

Their details come back through the same rail everything else uses:
campaign `tap-card`, straight into the **Cards** lane on
[the Back Office](../admin.html), tagged with how they got there
(`card · nfc`, `card · qr` or `card · link`), with their phone and their note
underneath. Reply from there.

## What this deliberately isn't

- **Not an Apple Wallet pass.** A `.pkpass` has to be signed with an Apple
  Developer certificate ($99/yr) and re-signed on every change. The web card
  does the same job, updates instantly, and works on Android too.
- **Not phone-to-phone NFC.** Android Beam is dead and iPhones only do
  NameDrop, which trades Contact Posters between two iPhones and can't be
  driven by a website. A tag is the reliable path, and it works both ways.
