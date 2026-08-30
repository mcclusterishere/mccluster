/* ============================================================
   DOMAIN SEARCH — the logic, with nothing plugged in.

   Every decision this feature makes lives here: what counts as a
   name, which addresses get looked up, how a registry's answer is
   read, and what the card is allowed to say afterwards. No fetch,
   no Deno, no imports — so the whole thing runs under node and is
   tested against the cases that actually bite rather than against
   a mock of itself.

   index.ts is the wiring: HTTP in, RDAP out, cache in the middle.
   ============================================================ */

export type Verdict = "available" | "taken" | "unknown";

export type Parsed = {
  ok: boolean;
  label: string;   // the part before the dot, normalised
  tld: string;     // "" when they typed a bare name
  reason?: string; // public, printed to the visitor verbatim
};

/* The registry's answer for one address, plus what we may do about it. */
export type Candidate = {
  name: string;
  tld: string;
  available: boolean | null;
  sellable: boolean;
  price: number | null;
  note: string | null;
  cached?: boolean;
};

/* ------------------------------------------------------------
   WHAT COUNTS AS A NAME

   People do not type "example.com". They type "www.Example.com/",
   "https://example.com", "Shiloh Baptist Church", and "example.com."
   with the trailing dot the DNS actually uses. All of those have one
   obvious intention and it costs nothing to honour it.

   What is NOT honoured is anything that would put a character a
   registry cannot hold into a URL this server then fetches. This
   function is the only thing standing between a text box on a public
   page and an outbound request, so it is a whitelist, not a blacklist.
   ------------------------------------------------------------ */
export function normalize(input: unknown): Parsed {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return { ok: false, label: "", tld: "", reason: "Type a name to check." };

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");   // scheme
  s = s.replace(/[/?#].*$/, "");                   // path, query, fragment
  s = s.replace(/^[^@]*@/, "");                    // somebody pasted an email
  s = s.replace(/\.+$/, "");                       // the DNS root dot
  s = s.replace(/^www\./, "");
  s = s.trim();

  if (!s) return { ok: false, label: "", tld: "", reason: "Type a name to check." };
  if (s.length > 253) return { ok: false, label: "", tld: "", reason: "That is longer than an address can be." };

  /* A NAME WITH A SPACE IN IT IS NOT A TYPO, IT IS A BUSINESS NAME.
     "Shiloh Baptist Church" is what somebody types when the box says
     "your address". Joining it up is the answer they wanted; "invalid"
     is the answer nobody wanted. */
  if (/[\s_]/.test(s)) s = s.replace(/[\s_]+/g, "-");

  /* Non-ASCII is a real address — an IDN — and turning one into a
     name a registry will accept needs punycode, which is not written
     here. Say so plainly rather than mangling somebody's name into
     something that is not theirs. */
  if (/[^\x20-\x7E]/.test(s)) {
    return {
      ok: false, label: "", tld: "",
      reason: "Accents and non-Latin letters need a hand — send the name and it gets set up for you.",
    };
  }

  const parts = s.split(".").filter(Boolean);
  if (!parts.length) return { ok: false, label: "", tld: "", reason: "Type a name to check." };

  /* THE ENDING IS THE LAST PART, AND THE NAME IS THE ONE NEXT TO IT.
     "shiloh.baptist.church" is a subdomain of "baptist.church", and a
     subdomain is not for sale. What is for sale is the registrable
     name, so the labels further left are dropped and the one against
     the dot is what gets checked — because quietly checking
     "baptist.church" and selling it would be selling the wrong thing. */
  let label: string, tld: string;
  if (parts.length === 1) { label = parts[0]; tld = ""; }
  else { tld = parts[parts.length - 1]; label = parts[parts.length - 2]; }

  label = label.replace(/^-+|-+$/g, "");

  if (!label) return { ok: false, label: "", tld: "", reason: "Type a name to check." };
  if (label.length > 63) return { ok: false, label: "", tld, reason: "A name has to be 63 characters or fewer." };
  if (!/^[a-z0-9-]+$/.test(label)) {
    return { ok: false, label: "", tld, reason: "Letters, numbers and hyphens only." };
  }
  /* xn-- is the punycode prefix. Any OTHER pair of hyphens in the
     third and fourth position is reserved, and the registry will
     refuse it — so it is refused here, where the message is kind. */
  if (/^[a-z0-9]{2}--/.test(label) && !label.startsWith("xn--")) {
    return { ok: false, label: "", tld, reason: "A name cannot have two hyphens in the third and fourth spot." };
  }
  if (tld && !/^[a-z]{2,63}$/.test(tld)) {
    return { ok: false, label, tld: "", reason: "That ending is not one we recognise." };
  }

  return { ok: true, label, tld };
}

/* ------------------------------------------------------------
   WHICH ADDRESSES GET LOOKED UP

   Typed WITH an ending: that ending and nothing else. They asked a
   question; answering a different one is noise.

   Typed BARE: the endings we can actually sell, in the order the list
   gives them, capped. The cap is not politeness — it is one outbound
   request per candidate, and an uncapped list is a machine for turning
   one keystroke into twenty calls to somebody else's registry.
   ------------------------------------------------------------ */
export function candidates(p: Parsed, tlds: { tld: string; sellable: boolean }[], max = 4): string[] {
  if (!p.ok) return [];
  const known = new Set(tlds.map((t) => t.tld));

  if (p.tld) return known.has(p.tld) ? [p.label + "." + p.tld] : [];

  return tlds.filter((t) => t.sellable).slice(0, max).map((t) => p.label + "." + t.tld);
}

/* ------------------------------------------------------------
   READING THE REGISTRY

   RFC 7480: 200 means the object exists, 404 means it does not.
   Everything else — a 429 from a rate limit, a 500, a timeout, a
   bootstrap redirect that went nowhere — means the registry did not
   answer the question, and that is NOT the same as "yours".

   This distinction is the entire reason the function exists. A rate
   limit read as "available" sells somebody a name that belongs to
   a bank, and they find out after the card is charged.
   ------------------------------------------------------------ */
export function readRdap(status: number, body?: unknown): Verdict {
  if (status === 404) return "available";
  if (status === 200) {
    /* Some registries answer 200 carrying an errorCode object instead
       of returning the status code. Out of spec, entirely real. */
    const b = body as { errorCode?: number } | null;
    if (b && typeof b.errorCode === "number") return b.errorCode === 404 ? "available" : "unknown";
    return "taken";
  }
  return "unknown";
}

/* rdap.org is the IANA bootstrap registry as a service: one URL for
   every TLD, a 302 on to whichever registry actually holds it. Using
   it means this function carries no table of registry endpoints to go
   stale the week a new TLD launches. */
export function rdapUrl(name: string): string {
  return "https://rdap.org/domain/" + encodeURIComponent(name);
}

/* ------------------------------------------------------------
   WHAT THE CARD IS ALLOWED TO SAY

   One place, so the button and the sentence under it can never
   disagree. A name is buyable only when the registry said it is free
   AND the list says we sell that ending AND a price exists for it.
   ------------------------------------------------------------ */
export function buyable(c: Candidate): boolean {
  return c.available === true && c.sellable === true && typeof c.price === "number" && c.price > 0;
}

export function verdictLine(c: Candidate): string {
  if (c.available === null) return "Couldn't check that one just now.";
  if (c.available === false) return "Taken.";
  if (buyable(c)) return "Available.";
  return c.note || "Available. Priced with you.";
}

/* Sort so the answer somebody can act on is the first thing they see:
   buyable, then available-but-quoted, then unknown, then taken. Ties
   keep the order the list gave, which is the order the house sells in. */
export function rank(a: Candidate, b: Candidate): number {
  const w = (c: Candidate) => buyable(c) ? 0 : c.available === true ? 1 : c.available === null ? 2 : 3;
  return w(a) - w(b);
}

/* The salted key the throttle counts against. The salt is what keeps
   the table from being a reversible list of everybody's IP address —
   without one, a hash of an IPv4 address is four billion guesses,
   which is not a hash, it is an encoding. */
export async function clientKey(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + "\n" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/* X-Forwarded-For is a list; the caller is the first entry and the
   rest are proxies, which would each get a bucket of their own if
   they were counted. A request with no address at all shares one
   bucket with every other request that has no address — which makes
   that the strictest bucket on the box, and it should be. */
export function callerIp(headers: { get(k: string): string | null }): string {
  const xff = headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}
