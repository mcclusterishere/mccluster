#!/usr/bin/env bash
# Scratch helper (not part of any patch): in an existing scratch worktree, check out <commit>
# detached, merge claude/new-session-83ken5 without committing, resolve only the two
# conflicted Equity Uprise source files (union of map entries by path; report regenerated
# by the verifier), then run the published-import closure test. Nothing is committed.
# usage: combined-check.sh <scratch-worktree> <commit> <label>
set -u
wt=$1; commit=$2; label=$3; tools=$(dirname "$0")
cd "$wt" || exit 2
git merge --abort >/dev/null 2>&1 || true
git reset -q --hard && git clean -qfd
git checkout -q --detach "$commit" || exit 2
echo "# combined check $label: scratch worktree at $(git rev-parse HEAD) + git merge --no-ff --no-commit claude/new-session-83ken5 ($(git rev-parse claude/new-session-83ken5)); $(date -u +%FT%TZ), node $(node --version)"
echo "## merge"
git -c user.name=Claude -c user.email=noreply@anthropic.com merge --no-ff --no-commit claude/new-session-83ken5 2>&1
echo "## unresolved after merge:"
git diff --name-only --diff-filter=U
echo "## resolution 1: source map = union of entries by path (union_source_map.py, index stages 2 and 3)"
python3 -I "$tools/union_source_map.py" "$PWD"
echo "## resolution 2: regenerate the coverage report with the verifier on the merged tree"
python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py 2>&1; echo "verifier exit=$?"
git add docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json docs/design/equity-uprise-building/production/generated/equity-uprise-repo-source-coverage-report.json
echo "## unresolved after resolution:"
git diff --name-only --diff-filter=U
echo "## node --test scripts/test/published-import-closure.test.mjs"
node --test scripts/test/published-import-closure.test.mjs 2>&1; echo "exit=$?"
