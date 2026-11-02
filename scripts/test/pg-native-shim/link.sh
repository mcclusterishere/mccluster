#!/usr/bin/env sh
# Materialise the stand-in where the fixtures' PGLITE_DIR lookup expects it (node_modules is gitignored, so the
# source lives in ./pglite and is linked here). Usage: sh scripts/test/pg-native-shim/link.sh
set -e
d="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$d/node_modules/@electric-sql"
rm -rf "$d/node_modules/@electric-sql/pglite"
ln -s "$d/pglite" "$d/node_modules/@electric-sql/pglite"
echo "PGLITE_DIR=$d/node_modules"
