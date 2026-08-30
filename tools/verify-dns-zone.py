"""Check every record in dns/mccluster.org.zone against live DNS.

A zone file is only useful if it is TRUE. The first version of this file
was assembled from guessed record names and was missing five records; the
fix for that is not care, it is a checker. Run this before any cutover
and again after.

Note the comment rule: in a zone file `;` starts a comment ONLY outside a
quoted string. DMARC and DKIM values are full of semicolons, and a naive
split on `;` silently truncates them to "v=DMARC1" — which is exactly the
kind of quiet corruption that makes mail vanish.
"""
import json, subprocess, sys
TYPES = {1: 'A', 5: 'CNAME', 15: 'MX', 16: 'TXT'}

def strip_comment(line):
    out, q = [], False
    for ch in line:
        if ch == '"': q = not q
        if ch == ';' and not q: break
        out.append(ch)
    return ''.join(out).rstrip()

def norm(s):
    return ' '.join(s.split()).strip().strip('"').replace('" "', '').rstrip('.')

def dns(name, typ):
    out = subprocess.run(
        ["curl", "-s", "-H", "accept: application/dns-json",
         f"https://cloudflare-dns.com/dns-query?name={name}&type={typ}"],
        capture_output=True, text=True).stdout
    try: d = json.loads(out)
    except Exception: return []
    return [a['data'] for a in d.get('Answer', []) if TYPES.get(a['type']) == typ]

want = []
for raw in open("dns/mccluster.org.zone"):
    line = strip_comment(raw)
    if not line.strip() or line.startswith('$'): continue
    p = line.split(None, 3)
    if len(p) < 4 or p[2] != 'IN': continue
    host, rest = p[0], p[3]
    typ, val = rest.split(None, 1)
    fqdn = "mccluster.org" if host == "@" else f"{host}.mccluster.org"
    want.append((fqdn, typ, val))

cache, bad = {}, 0
for fqdn, typ, val in want:
    key = (fqdn, typ)
    if key not in cache: cache[key] = [norm(x) for x in dns(fqdn, typ)]
    exp = norm(val)
    ok = exp in cache[key]
    print(("  ok   " if ok else "  MISS ") + f"{fqdn:56} {typ:5} {exp[:52]}")
    if not ok:
        bad += 1
        print(f"         live: {cache[key]}")

print(f"\n{len(want)} records checked, {bad} mismatched")
sys.exit(1 if bad else 0)
