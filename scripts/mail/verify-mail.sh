#!/usr/bin/env bash
# ============================================================
# THE VERIFIER — run this before any real mail depends on the box, and
# again after any DNS change.
#
# It exists because every way self-hosted mail fails is SILENT. Postfix
# accepts the message, reports 250, queues it, and Gmail drops it into
# spam or /dev/null without telling anyone. From the application's side
# that is indistinguishable from success. So the checks that matter are
# the ones nobody gets an error for, and this script fails loudly on
# them instead.
#
# It does not print a pass unless every REQUIRED check passed. A partial
# pass on a mail server is not a pass; it is mail going missing.
#
# Run on the VPS (all checks) or anywhere (DNS checks only).
#
#   MAIL_MODE=send-only  (default) the box sends; mail is received elsewhere
#   MAIL_MODE=full       the box sends AND receives; MX should point here
# ============================================================
set -uo pipefail

MAIL_HOST="${MAIL_HOST:-mail.mccluster.org}"
MAIL_DOMAIN="${MAIL_DOMAIN:-mccluster.org}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mail}"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; WARN=$((WARN+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Resolve without depending on dig being installed, so this runs anywhere.
dns() { # dns <name> <type>
  curl -fsS -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=$1&type=$2" 2>/dev/null \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(a['data']) for a in (d.get('Answer') or [])]" 2>/dev/null
}

head_ "1. Identity: does this host look like who it claims to be?"

A_REC="$(dns "${MAIL_HOST}" A | tail -1)"
if [[ -n "${A_REC}" ]]; then ok "${MAIL_HOST} -> ${A_REC}"
else bad "${MAIL_HOST} has no A record"; fi

if [[ -n "${A_REC}" ]]; then
  REV="$(printf '%s' "${A_REC}" | awk -F. '{print $4"."$3"."$2"."$1".in-addr.arpa"}')"
  PTR="$(dns "${REV}" PTR | sed 's/\.$//' | tail -1)"
  if [[ "${PTR}" == "${MAIL_HOST}" ]]; then
    ok "reverse DNS forward-confirms (${A_REC} -> ${MAIL_HOST} -> ${A_REC})"
  elif [[ -n "${PTR}" ]]; then
    bad "reverse DNS is '${PTR}', not '${MAIL_HOST}'. Gmail requires these to agree; a generic VPS hostname here is treated as a spam signal."
  else
    bad "no reverse DNS for ${A_REC}. Set it OVH-side; most receivers reject mail without one."
  fi
fi

head_ "2. Authentication: the three records receivers actually check"

SPF="$(dns "${MAIL_DOMAIN}" TXT | tr -d '"' | grep -i '^v=spf1' | head -1)"
if [[ -z "${SPF}" ]]; then
  bad "no SPF record on ${MAIL_DOMAIN}"
elif [[ -n "${A_REC}" && "${SPF}" == *"ip4:${A_REC}"* ]]; then
  ok "SPF authorises ${A_REC}"
elif [[ "${SPF}" == *"a:${MAIL_HOST}"* || "${SPF}" == *"mx"* ]]; then
  ok "SPF authorises this host indirectly"
else
  bad "SPF does not authorise ${A_REC:-the mail host} (no ip4/a/mx term covers it). Mail from this box will fail SPF. Current: ${SPF}"
fi
# Keeping Google in SPF matters: the owner still sends normal mail from
# Workspace, and dropping the include silently breaks THAT instead.
if [[ "${SPF}" == *"_spf.google.com"* ]]; then
  ok "SPF still includes Google Workspace (the owner's own mail keeps working)"
else
  warn "SPF no longer includes _spf.google.com -- mail sent from Gmail as this domain will now fail SPF"
fi

DKIM="$(dns "${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}" TXT | tr -d '"')"
if [[ "${DKIM}" == *"p="* ]]; then
  ok "DKIM key published at ${DKIM_SELECTOR}._domainkey"
  # If we are on the server, the published key must be the one we sign with.
  LOCAL="/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt"
  if [[ -r "${LOCAL}" ]]; then
    WANT="$(tr -d '\n' < "${LOCAL}" | sed 's/.*p=//; s/[";) ].*//' | head -c 40)"
    GOT="$(printf '%s' "${DKIM}" | sed 's/.*p=//; s/[";) ].*//' | head -c 40)"
    if [[ -n "${WANT}" && "${WANT}" == "${GOT}" ]]; then
      ok "published DKIM key matches the key this server signs with"
    else
      bad "published DKIM key does NOT match this server's key. Every signature will fail verification."
    fi
  fi
else
  bad "no DKIM key at ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}"
fi

DMARC="$(dns "_dmarc.${MAIL_DOMAIN}" TXT | tr -d '"' | head -1)"
if [[ "${DMARC}" == v=DMARC1* ]]; then
  ok "DMARC present: ${DMARC}"
  [[ "${DMARC}" == *"p=none"* ]] && warn "DMARC is p=none (monitoring only). Correct while warming up; tighten to quarantine once reports are clean."
else
  bad "no DMARC record. Gmail and Yahoo require one from bulk senders."
fi

head_ "3. Where does incoming mail go?"
# What is correct here depends entirely on which half is built, and
# getting it backwards costs the owner their inbox either way. So the
# mode is explicit rather than guessed:
#
#   send-only  the box sends but cannot receive; MX must stay elsewhere.
#   full       the box receives too; MX must point here and a mailbox
#              must actually exist to catch what arrives.
#
# Default is send-only because that is the safe assumption: asserting a
# host receives mail when it does not is how mail disappears.
MAIL_MODE="${MAIL_MODE:-send-only}"
# Flattened to one line: a domain with five MX hosts otherwise smears a
# single PASS across five lines and stops being readable at a glance.
MX="$(dns "${MAIL_DOMAIN}" MX | tr '[:upper:]' '[:lower:]' | awk '{print $NF}' | sed 's/\.$//' | paste -sd' ' -)"
echo "  mode: ${MAIL_MODE}"

if [[ "${MAIL_MODE}" == "full" ]]; then
  if [[ "${MX}" == *"${MAIL_HOST}"* ]]; then
    ok "MX points at ${MAIL_HOST}"
  elif [[ -z "${MX}" ]]; then
    bad "${MAIL_DOMAIN} has no MX record. Mail to the domain is bouncing."
  else
    warn "MX is '${MX}', not ${MAIL_HOST}. Mail still goes elsewhere -- correct if you have not cut over yet."
  fi
  # In full mode the receiving side has to be real, not just pointed at.
  if command -v postconf >/dev/null; then
    if postconf -h virtual_mailbox_domains 2>/dev/null | grep -qi "${MAIL_DOMAIN}"; then
      ok "postfix accepts mail for ${MAIL_DOMAIN}"
    else
      bad "MX says mail comes here but postfix does not accept ${MAIL_DOMAIN}. Every message will be rejected."
    fi
    if systemctl is-active --quiet dovecot 2>/dev/null; then ok "dovecot is running"
    else bad "dovecot is not running -- accepted mail has nowhere to be delivered"; fi
  fi
  # IMAP has to be reachable and encrypted, or the mailbox cannot be read
  # without handing the password to the internet.
  if [[ -n "${A_REC}" ]] && timeout 8 bash -c ">/dev/tcp/${MAIL_HOST}/993" 2>/dev/null; then
    ok "IMAPS reachable on ${MAIL_HOST}:993"
  else
    warn "could not reach ${MAIL_HOST}:993 from here (firewall, or not up yet)"
  fi
else
  if [[ "${MX}" == *"${MAIL_HOST}"* ]]; then
    bad "MX points at ${MAIL_HOST} but this is a SEND-ONLY server. Incoming mail to ${MAIL_DOMAIN} is being discarded right now. Either run bootstrap-mailbox.sh or point the MX back."
  elif [[ -n "${MX}" ]]; then
    ok "MX points elsewhere (${MX}) -- correct for a send-only relay"
  else
    bad "${MAIL_DOMAIN} has no MX record. Mail to the domain is bouncing."
  fi
fi

head_ "4. Can anything actually leave?"
# Port 25 is a property of the SENDING host, so testing it from a laptop or
# a CI box answers a question nobody asked. Establish where we are first,
# and say we do not know rather than reporting somebody else's firewall as
# though it were the mail server's.
HERE="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
if [[ -n "${A_REC}" && "${HERE}" == "${A_REC}" ]]; then
  if timeout 8 bash -c ">/dev/tcp/gmail-smtp-in.l.google.com/25" 2>/dev/null; then
    ok "outbound port 25 is open from the mail host"
  else
    bad "outbound port 25 is BLOCKED on the mail host. Postfix will accept mail from Supabase and never deliver it -- which looks exactly like success to the website. OVH blocks 25 by default; this is a support request."
  fi
else
  warn "not running on ${MAIL_HOST} (this host is ${HERE:-unknown}), so outbound port 25 was not tested. Re-run this on the VPS before trusting it."
fi

head_ "5. Are we an open relay?"
# The check that protects the domain. If this one fails, stop everything:
# an open relay is on a blocklist within hours and takes the signup
# confirmations down with it.
if [[ -z "${A_REC}" ]]; then
  warn "skipped: ${MAIL_HOST} does not resolve yet, so there is nothing to probe"
elif ! command -v python3 >/dev/null; then
  warn "skipped: python3 not available to run the probe"
else
  RELAY="$(python3 - "$MAIL_HOST" <<'PY' 2>/dev/null
import smtplib, socket, sys
host = sys.argv[1]
try:
    s = smtplib.SMTP(host, 587, timeout=10)
    s.ehlo(); s.starttls(); s.ehlo()
    # No AUTH on purpose. A correctly configured relay refuses this.
    code, _ = s.mail("probe@example.net")
    code, _ = s.rcpt("probe@example.org")
    s.quit()
    print("OPEN" if 200 <= code < 300 else "REFUSED")
except smtplib.SMTPRecipientsRefused:
    print("REFUSED")
except smtplib.SMTPSenderRefused:
    print("REFUSED")
except (socket.error, smtplib.SMTPException) as e:
    print("UNREACHABLE")
PY
)"
  case "${RELAY}" in
    REFUSED)     ok "relay refuses unauthenticated mail" ;;
    OPEN)        bad "THIS IS AN OPEN RELAY. Stop and fix smtpd_relay_restrictions before sending anything." ;;
    *)           warn "could not reach ${MAIL_HOST}:587 to test relaying (firewall, or the server is not up yet)" ;;
  esac
fi

head_ "Result"
printf '  %d passed, %d failed, %d warnings\n\n' "${PASS}" "${FAIL}" "${WARN}"
if (( FAIL > 0 )); then
  printf '\033[31mNOT READY.\033[0m Do not point Supabase at this server yet: the failures above\nare all things that lose mail without reporting an error.\n\n'
  exit 1
fi
printf '\033[32mReady.\033[0m Send one real test to a Gmail address and confirm it lands in the\ninbox rather than spam before you move signup confirmations over.\n\n'
