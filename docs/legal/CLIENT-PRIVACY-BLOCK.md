# The block every hosted client puts in their own privacy notice

Ships with every site. Not optional, and not a courtesy: the visitors on
a client's site are **the client's** visitors, so the disclosure duty is
theirs as well as ours. A site running Insight with no notice of it
leaves the client exposed first and us second.

Paste it into their privacy page. Swap the bracketed bits.

---

## Analytics on this site

This site uses **McCluster Insight**, a first-party analytics tool
provided by McCluster Corp, who built and host this site. It replaces
third-party analytics such as Google Analytics rather than adding to it.

**What it records**

- The pages you open on this site, and how far down you read
- What you click
- Your device and browser type, and your screen size
- Your approximate location (country, region, city) and your network,
  worked out from your IP address — never GPS, and we never ask your
  browser for precise location
- A random identifier stored by **this site**, on this domain, so a
  returning visitor is not counted twice

**What it does not do**

- It is not an advertising pixel and feeds no ad network
- It does not follow you to other websites
- Nothing it collects is sold, to anyone, ever
- It does not read what you type, and does not record your keystrokes

**Your choices**

If your browser sends **Global Privacy Control** or **Do Not Track**,
this site stops recording before anything is sent — nothing to click,
and it is checked both in your browser and on the server.

To see what is held about you, or to have it deleted, write to
**[client contact email]**. We answer within 45 days.

[**If the site uses McCluster sign-in, keep this paragraph. If it does
not, delete it.**] If you sign in here with an M Account, your activity
on this site can be connected to your activity on other McCluster
services, because it is the same account you chose to sign in with. If
you are not signed in, you are counted on this site only, and no attempt
is made to recognise you anywhere else.

**Who to contact**

- This site: **[client name]**, **[client contact email]**
- The analytics provider: McCluster Corp, matthew@mccluster.org

---

## Notes for us, not for the client

**Delete the SSO paragraph when the site has no M Account sign-in.**
Leaving it in describes linking that is not happening, which is a false
statement in the client's own notice and is worse than omitting it.

**`consent_mode` on the `analytics_sites` row has to match this text.**
If a site is set to `required`, its page must actually gate on consent
before Insight persists an identifier. A notice promising a choice the
site never offers is the thing regulators open first.

**When section 10 of matthew.mccluster.org/privacy.html changes, this
changes with it**, and every hosted client gets the new text. Two
documents describing one product must not drift.
