#!/usr/bin/env python3
from pathlib import Path
from pglast import parser

ROOT = Path(__file__).resolve().parents[1]
files = sorted((ROOT / "supabase" / "migrations").glob("20260908213*.sql")) + sorted((ROOT / "supabase" / "migrations").glob("20260908214*.sql"))
if not files:
    raise SystemExit("No Policy OS migrations found")

failed = False
for path in files:
    sql = path.read_text(encoding="utf-8")
    try:
        parser.parse_sql(sql)
        print(f"OK  {path.relative_to(ROOT)}")
    except Exception as exc:
        failed = True
        print(f"ERR {path.relative_to(ROOT)}: {exc}")

if failed:
    raise SystemExit(1)
print(f"Parsed {len(files)} Policy OS migrations successfully")
