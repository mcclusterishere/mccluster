#!/usr/bin/env python3
"""Scratch mutation check (not part of any patch): apply one plausible regression at a time to a
scratch checkout of the series head and run scripts/test/prim3-topology-learning.test.mjs; every
mutation must turn at least one of the two W5 tests red. The checkout is restored after each.
  python3 -I mutations.py <scratch-worktree-at-series-head>"""
import subprocess, sys, re
wt = sys.argv[1]
RT, APP, LRN, SHIM = 'js/prim3-mission/topology-learning.mjs', 'js/prim3-mission/released-app.mjs', 'js/prim3-mission/released-learning.mjs', 'PRIM3/game/halo/adaptive/topology-learning.mjs'
HQ_NEW = "one cell is 12 ft (3.6576 m) on the building plan; tactical rules use the separate 3.54 m game tile"
def rd(p): return open(f'{wt}/{p}', encoding='utf-8').read()
def wr(p, s): open(f'{wt}/{p}', 'w', encoding='utf-8').write(s)
def sub(p, old, new, count=None):
    s = rd(p); n = s.count(old)
    assert n and (count is None or n == count), (p, old, n)
    wr(p, s.replace(old, new) if count is None else s.replace(old, new, count))
def first_line(p, new):  # replace only the B1 defend entry's frame
    s = rd(p); i = s.index("'equity-uprise-b1':"); j = s.index('\n', i)
    line = s[i:j]; assert HQ_NEW in line; wr(p, s[:i] + line.replace(HQ_NEW, '3.54 m/tile') + s[j:])
M = [
 ('M1 HQ/B1 cell metres rounded to 3.66', lambda: sub(RT, '(3.6576 m)', '(3.66 m)')),
 ('M2 HQ/B1 cell given as the rule tile 3.54', lambda: sub(RT, '(3.6576 m)', '(3.54 m)')),
 ('M3 rule-tile clause dropped', lambda: sub(RT, '; tactical rules use the separate 3.54 m game tile', '')),
 ('M4 rule tile misstated as 3.66', lambda: sub(RT, 'separate 3.54 m game tile', 'separate 3.66 m game tile')),
 ('M5 HQ/B1 origin shifted (x-4)', lambda: sub(RT, "frame:'X=x−3,", "frame:'X=x−4,")),
 ('M6 only B1 (defend) reverted to 3.54 m/tile', lambda: first_line(RT, None)),
 ('M7 Transit frame given the HQ cell', lambda: sub(RT, "frame:'X=x−32, Y=31−y; +X east, +Y north; 3.54 m/tile'", "frame:'X=x−32, Y=31−y; +X east, +Y north; 3.6576 m/tile'")),
 ('M8 released-app.mjs back on the private path', lambda: sub(APP, "from './topology-learning.mjs'", "from '../../PRIM3/game/halo/adaptive/topology-learning.mjs'")),
 ('M9 released-learning.mjs back on the private path', lambda: sub(LRN, "from './topology-learning.mjs'", "from '../../PRIM3/game/halo/adaptive/topology-learning.mjs'")),
 ('M10 private path a second copy, not a re-export', lambda: wr(SHIM, rd(RT))),
]
caught = 0
for name, mutate in M:
    subprocess.run(['git', '-C', wt, 'checkout', '-q', '--', '.'], check=True)
    mutate()
    r = subprocess.run(['node', '--test', 'scripts/test/prim3-topology-learning.test.mjs'], cwd=wt, capture_output=True, text=True)
    red = [l[len('not ok '):] for l in r.stdout.splitlines() if l.startswith('not ok ')]
    tally = re.findall(r'^# (pass|fail) (\d+)', r.stdout, re.M)
    ok = r.returncode != 0 and any('audit W5' in x for x in red)
    caught += ok
    print(f"{'CAUGHT' if ok else 'MISSED'}  {name}: exit={r.returncode} {dict(tally)} red={red}")
subprocess.run(['git', '-C', wt, 'checkout', '-q', '--', '.'], check=True)
print(f'{caught}/{len(M)} mutations caught; checkout restored: {subprocess.run(["git","-C",wt,"status","--short"],capture_output=True,text=True).stdout.strip() or "clean"}')
