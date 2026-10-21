#!/usr/bin/env bash
# Hermetic regression for verify-mail.sh: all network/provider probes are mocked.
# No mail, DNS, host configuration, or credentials are touched.
set -Eeuo pipefail
cd "$(dirname "$0")"
REAL_PYTHON_BIN="$(command -v python3)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin"

cat > "$ROOT/bin/curl" <<'SH'
#!/usr/bin/env bash
if [[ "$*" == *api.ipify.org* ]]; then
  printf '%s\n' "$MOCK_HERE"
  exit 0
fi
url=""
for arg in "$@"; do url="$arg"; done
data=""
case "$url" in
  *'name=mail.example.test&type=A'*) data='203.0.113.5' ;;
  *'name=5.113.0.203.in-addr.arpa&type=PTR'*) data='mail.example.test.' ;;
  *'name=mail._domainkey.example.test&type=TXT'*) data='v=DKIM1; p=FAKE_TEST_PUBLIC_KEY' ;;
  *'name=_dmarc.example.test&type=TXT'*) data='v=DMARC1; p=none' ;;
  *'name=example.test&type=TXT'*) data='v=spf1 ip4:203.0.113.5 include:_spf.google.com ~all' ;;
  *'name=example.test&type=MX'*) data="10 $MOCK_MX." ;;
esac
if [[ -z "$data" ]]; then
  printf '{"Answer":[]}\n'
else
  printf '{"Answer":[{"data":"%s"}]}\n' "$data"
fi
SH

cat > "$ROOT/bin/python3" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "-c" ]]; then exec "$REAL_PYTHON_BIN" "$@"; fi
printf '%s\n' "$MOCK_RELAY"
SH

cat > "$ROOT/bin/postconf" <<'SH'
#!/usr/bin/env bash
printf 'example.test\n'
SH

cat > "$ROOT/bin/systemctl" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$ROOT/bin/timeout" <<'SH'
#!/usr/bin/env bash
if [[ "$*" == *'gmail-smtp-in.l.google.com/25'* && "$MOCK_EGRESS" == 'blocked' ]]; then exit 1; fi
if [[ "$*" == *'mail.example.test/993'* && "$MOCK_IMAPS" == 'blocked' ]]; then exit 1; fi
exit 0
SH

chmod +x "$ROOT/bin/"*
export PATH="$ROOT/bin:$PATH"
export REAL_PYTHON_BIN MAIL_HOST=mail.example.test MAIL_DOMAIN=example.test
export MOCK_HERE=203.0.113.5 MOCK_MX=google.example.test
export MOCK_RELAY=REFUSED MOCK_EGRESS=open MOCK_IMAPS=open MAIL_MODE=send-only

test_ok() {
  local name="$1" needle="$2"
  shift 2
  if ! env "$@" bash ./verify-mail.sh > "$ROOT/last" 2>&1; then
    echo "FAIL $name: expected success"
    cat "$ROOT/last"
    exit 1
  fi
  if ! grep -Fq "$needle" "$ROOT/last"; then
    echo "FAIL $name: missing $needle"
    cat "$ROOT/last"
    exit 1
  fi
  echo "PASS $name"
}

test_bad() {
  local name="$1" needle="$2"
  shift 2
  if env "$@" bash ./verify-mail.sh > "$ROOT/last" 2>&1; then
    echo "FAIL $name: false readiness"
    cat "$ROOT/last"
    exit 1
  fi
  if ! grep -Fq "$needle" "$ROOT/last"; then
    echo "FAIL $name: missing $needle"
    cat "$ROOT/last"
    exit 1
  fi
  echo "PASS $name"
}

test_ok 'send-only with external MX' 'HOST PRECHECK PASSED'
test_bad 'off-host cannot attest port 25' 'outbound port 25 is UNVERIFIED' MOCK_HERE=198.51.100.55
test_bad 'full cannot claim readiness on Google MX' 'full mode requires MX to point exclusively' MAIL_MODE=full
test_ok 'staged on external MX' 'STAGING PRECHECK PASSED' MAIL_MODE=staged
test_bad 'staged cannot accept premature MX' 'prematurely switched MX' MAIL_MODE=staged MOCK_MX=mail.example.test
test_bad 'unreachable IMAPS is not readiness' 'IMAP availability is unverified' MAIL_MODE=full MOCK_MX=mail.example.test MOCK_IMAPS=blocked
test_bad 'open-relay safety must be verified' 'open-relay safety is UNVERIFIED' MOCK_RELAY=UNREACHABLE
test_bad 'blocked remote MX port 25 is not readiness' 'outbound port 25 is BLOCKED' MOCK_EGRESS=blocked
test_ok 'full with exclusive MX and host attestations' 'MX points exclusively' MAIL_MODE=full MOCK_MX=mail.example.test
echo 'All mail readiness regression checks passed (mocked; no production claim).'
