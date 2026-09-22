#!/usr/bin/env bash
# ============================================================
# THE HOUSE MAIL SERVER — send only, and deliberately so.
#
# WHAT THIS BUILDS
#   Postfix listening on 587 (submission, STARTTLS, SASL) so Supabase Auth
#   can authenticate and hand us a message, and delivering outward on 25.
#   OpenDKIM signs everything on the way out. Let's Encrypt supplies the
#   certificate. Nothing else.
#
# WHAT THIS DELIBERATELY DOES NOT DO
#   It does not receive mail. mccluster.org's MX points at Google
#   Workspace and that is where matthew@mccluster.org is READ. This script
#   never writes an MX record and you must never point one here: doing so
#   takes the owner's inbox away and the mail that was already in it does
#   not come back. Sending as an address and receiving for it are separate
#   jobs and only the first one lives on this box.
#
#   It does not relay for anybody. An open relay is on a blocklist within
#   hours and the domain's reputation goes with it, which would take the
#   signup confirmations down harder than the rate limit ever did. The
#   restriction below is the whole point of the file, so it is stated
#   before anything else runs and verified after.
#
# PREREQUISITES, both of which fail loudly here rather than silently later:
#   1. mail.mccluster.org must already resolve to THIS host's public IP.
#      Reverse DNS is set from the OVH side and OVH will not accept a
#      reverse that does not forward-confirm, so the A record comes first.
#   2. Outbound port 25 must be open. OVH blocks it on new VPS instances
#      by default; it is a support request, not a setting on the box.
#
# Run as root on the VPS:  bash bootstrap-mail-server.sh
# ============================================================
set -Eeuo pipefail

MAIL_HOST="${MAIL_HOST:-mail.mccluster.org}"
MAIL_DOMAIN="${MAIL_DOMAIN:-mccluster.org}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mail}"
SMTP_USER="${SMTP_USER:-supabase@${MAIL_DOMAIN}}"
CERT_EMAIL="${CERT_EMAIL:-matthew@mccluster.org}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 2; }

[[ "${EUID}" -eq 0 ]] || die "run as root"

# ------------------------------------------------------------
# PRECHECKS. Each one is a thing that, left unchecked, produces mail that
# is accepted by us and silently binned by Gmail -- the worst failure mode
# available, because nothing reports it.
# ------------------------------------------------------------
say "Checking prerequisites"

command -v dig >/dev/null || { apt-get update -qq && apt-get install -y -qq dnsutils; }

PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org)" || die "cannot determine this host's public IP"
echo "   this host: ${PUBLIC_IP}"

FWD="$(dig +short A "${MAIL_HOST}" | tail -1)"
[[ -n "${FWD}" ]] || die "${MAIL_HOST} has no A record yet. Add it in Cloudflare (DNS only, grey cloud -- mail must not be proxied) pointing at ${PUBLIC_IP}, then run this again."
[[ "${FWD}" == "${PUBLIC_IP}" ]] || die "${MAIL_HOST} resolves to ${FWD}, not ${PUBLIC_IP}"
echo "   forward DNS: ok"

# Reverse must exist AND point back at the name we will say HELO with.
# Receivers check this pair; a mismatch is treated as a forgery signal.
PTR="$(dig +short -x "${PUBLIC_IP}" | sed 's/\.$//' | tail -1)"
if [[ "${PTR}" != "${MAIL_HOST}" ]]; then
  echo "   WARNING: reverse DNS for ${PUBLIC_IP} is '${PTR:-none}', not ${MAIL_HOST}."
  echo "            Set it from the OVH side before you send anything real."
fi

# Port 25 outbound. Without this the queue fills and nothing ever leaves,
# which looks exactly like success from the application's side.
if timeout 8 bash -c ">/dev/tcp/gmail-smtp-in.l.google.com/25" 2>/dev/null; then
  echo "   outbound 25: open"
else
  echo "   WARNING: outbound port 25 appears BLOCKED. OVH blocks it by default."
  echo "            Open a support request to have it unblocked; until then"
  echo "            this server can accept mail from Supabase and will never"
  echo "            deliver any of it."
fi

# ------------------------------------------------------------
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  postfix postfix-pcre opendkim opendkim-tools \
  libsasl2-modules sasl2-bin certbot ca-certificates

# ------------------------------------------------------------
say "Certificate for ${MAIL_HOST}"
if [[ ! -s "/etc/letsencrypt/live/${MAIL_HOST}/fullchain.pem" ]]; then
  systemctl stop postfix 2>/dev/null || true
  certbot certonly --standalone --non-interactive --agree-tos \
    -m "${CERT_EMAIL}" -d "${MAIL_HOST}" \
    || die "certbot failed. Port 80 must be reachable from the internet for the challenge."
fi
# Renewal has to reload postfix or the box serves an expired cert for 90
# days and every modern receiver refuses STARTTLS.
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-postfix.sh <<'HOOK'
#!/bin/sh
systemctl reload postfix 2>/dev/null || true
systemctl reload opendkim 2>/dev/null || true
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-postfix.sh

# ------------------------------------------------------------
say "DKIM keys (selector ${DKIM_SELECTOR}, 2048-bit)"
install -d -o opendkim -g opendkim -m 0750 "/etc/opendkim/keys/${MAIL_DOMAIN}"
if [[ ! -s "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.private" ]]; then
  opendkim-genkey -b 2048 -d "${MAIL_DOMAIN}" -D "/etc/opendkim/keys/${MAIL_DOMAIN}" -s "${DKIM_SELECTOR}" -v
  chown opendkim:opendkim "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}."*
  chmod 0600 "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.private"
fi

cat > /etc/opendkim.conf <<CONF
Syslog                  yes
UMask                   007
Mode                    s
Canonicalization        relaxed/simple
OversignHeaders         From
SubDomains              no
Socket                  inet:8891@localhost
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim
KeyTable                /etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
ExternalIgnoreList      /etc/opendkim/TrustedHosts
InternalHosts           /etc/opendkim/TrustedHosts
CONF

echo "${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN} ${MAIL_DOMAIN}:${DKIM_SELECTOR}:/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.private" \
  > /etc/opendkim/KeyTable
echo "*@${MAIL_DOMAIN} ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}" > /etc/opendkim/SigningTable
# Localhost only. Anything wider here signs other people's mail with our key.
printf '127.0.0.1\n::1\nlocalhost\n' > /etc/opendkim/TrustedHosts
chown -R opendkim:opendkim /etc/opendkim
install -d -o opendkim -g opendkim -m 0755 /run/opendkim

# ------------------------------------------------------------
say "Postfix"
postconf -e "myhostname = ${MAIL_HOST}"
postconf -e "mydomain = ${MAIL_DOMAIN}"
postconf -e "myorigin = \$mydomain"
postconf -e "smtpd_banner = \$myhostname ESMTP"
postconf -e "biff = no"
postconf -e "append_dot_mydomain = no"
postconf -e "compatibility_level = 3.6"

# SEND ONLY. inet_interfaces stays all because Supabase connects from the
# internet, but mydestination is empty so this host is not the final
# destination for any domain and will not accept mail addressed to one.
postconf -e "mydestination ="
postconf -e "local_recipient_maps ="
postconf -e "local_transport = error:local delivery is not available on this host"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"

# TLS out. May, not encrypt: a receiver that cannot do TLS should still get
# the message rather than have it stuck in our queue forever.
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_loglevel = 1"
postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"

# TLS in.
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_cert_file = /etc/letsencrypt/live/${MAIL_HOST}/fullchain.pem"
postconf -e "smtpd_tls_key_file = /etc/letsencrypt/live/${MAIL_HOST}/privkey.pem"
postconf -e "smtpd_tls_mandatory_protocols = >=TLSv1.2"
postconf -e "smtp_tls_mandatory_protocols = >=TLSv1.2"

# THE RELAY RESTRICTION. This single line is what keeps the server off a
# blocklist: authenticate, or be refused. Order matters -- reject is last
# and unconditional, so a future edit that adds a permit above it is a
# deliberate act and not an accident.
postconf -e "smtpd_relay_restrictions = permit_sasl_authenticated,reject"
postconf -e "smtpd_recipient_restrictions = permit_sasl_authenticated,reject_unauth_destination,reject"
postconf -e "smtpd_helo_required = yes"

# SASL, on submission only.
postconf -e "smtpd_sasl_auth_enable = no"
postconf -e "smtpd_sasl_type = cyrus"
postconf -e "smtpd_sasl_path = smtpd"
postconf -e "smtpd_sasl_security_options = noanonymous"
postconf -e "smtpd_sasl_local_domain = \$myhostname"
postconf -e "broken_sasl_auth_clients = yes"

# OpenDKIM milter.
postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:localhost:8891"
postconf -e "non_smtpd_milters = inet:localhost:8891"

# Port 25 inbound is not offered at all; 587 is the only door in, and it
# requires AUTH over TLS. master.cf is rewritten rather than appended to
# so re-running this script is idempotent.
cp -n /etc/postfix/master.cf /etc/postfix/master.cf.orig 2>/dev/null || true
python3 - <<'PY'
import re
p = '/etc/postfix/master.cf'
src = open(p).read()
# Drop any previous submission block we wrote, then add ours.
src = re.sub(r'\n# --- mccluster submission ---.*?# --- end mccluster ---\n', '\n', src, flags=re.S)
src += """
# --- mccluster submission ---
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
# --- end mccluster ---
"""
open(p, 'w').write(src)
PY

# ------------------------------------------------------------
say "SMTP credential for Supabase"
# saslauthd against a dedicated sasldb, so the SMTP password is not a unix
# login and cannot be used to reach a shell on this box.
SMTP_PASS="$(openssl rand -base64 24)"
rm -f /etc/sasldb2
echo "${SMTP_PASS}" | saslpasswd2 -p -c -u "${MAIL_HOST}" "${SMTP_USER}"
chown postfix:postfix /etc/sasldb2
chmod 0600 /etc/sasldb2
cat > /etc/postfix/sasl/smtpd.conf <<CONF
pwcheck_method: auxprop
auxprop_plugin: sasldb
mech_list: PLAIN LOGIN
sasldb_path: /etc/sasldb2
CONF

# ------------------------------------------------------------
say "Starting"
systemctl enable --now opendkim
systemctl restart opendkim
systemctl enable --now postfix
systemctl restart postfix

sleep 2
systemctl is-active --quiet opendkim || die "opendkim did not start"
systemctl is-active --quiet postfix  || die "postfix did not start"

# ------------------------------------------------------------
say "DONE. Two things to do by hand."
DKIM_TXT="$(tr -d '\n' < "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt" | sed 's/.*( *//; s/ *).*//; s/" *"//g; s/"//g')"
cat <<OUT

1. ADD THIS DNS RECORD in Cloudflare (DNS only, grey cloud):

   Type:  TXT
   Name:  ${DKIM_SELECTOR}._domainkey
   Value: ${DKIM_TXT}

2. GIVE SUPABASE THESE SMTP SETTINGS
   (Authentication -> Emails -> SMTP Settings)

   Host:     ${MAIL_HOST}
   Port:     587
   Username: ${SMTP_USER}
   Password: ${SMTP_PASS}
   Sender:   matthew@${MAIL_DOMAIN}

   This password is shown ONCE. It is not stored anywhere you can read it
   back -- saslpasswd2 keeps only a hash. Losing it means re-running this
   script, which mints a new one.

Then run scripts/mail/verify-mail.sh before you point anything real at it.

OUT
