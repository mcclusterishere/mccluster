#!/usr/bin/env bash
# ============================================================
# THE MAILBOX — the receiving half. Run AFTER bootstrap-mail-server.sh.
#
# After this, mail addressed to @mccluster.org arrives on this box, is
# filtered here, is stored here, and is read over IMAP from here. Google
# Workspace is not in the path at all.
#
# WHAT IT ADDS
#   Postfix  accepts mail for the domain on 25 and hands it to Dovecot.
#   Dovecot  stores it as Maildir and serves IMAP on 993 (implicit TLS).
#   rspamd   scores spam locally, with redis for its state. No external
#            reputation service, no third party seeing the mail.
#
# IT ALSO REPLACES THE SASL BACKEND. The send-only script authenticated
# submission against sasldb because there were no mailboxes yet. Now that
# Dovecot owns the users, submission authenticates against Dovecot too, so
# ONE password works for both reading and sending and there is no second
# credential store to drift. The old sasldb is removed rather than left
# lying around as a second way in.
#
# WHAT YOU OWN NOW THAT YOU DID NOT BEFORE
#   The mail itself. If this disk dies, the mail is gone. OVH's automated
#   backup on this VPS keeps ONE restore point, so a loss you do not
#   notice within a day is permanent. backup-mail.sh exists for that and
#   this script installs its timer.
#
# Run as root on the VPS:  bash bootstrap-mailbox.sh
# ============================================================
set -Eeuo pipefail

MAIL_HOST="${MAIL_HOST:-mail.mccluster.org}"
MAIL_DOMAIN="${MAIL_DOMAIN:-mccluster.org}"
MAILBOX_USER="${MAILBOX_USER:-matthew@${MAIL_DOMAIN}}"
VMAIL_DIR="/var/mail/vhosts"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 2; }
[[ "${EUID}" -eq 0 ]] || die "run as root"

[[ -s "/etc/letsencrypt/live/${MAIL_HOST}/fullchain.pem" ]] \
  || die "no certificate for ${MAIL_HOST}. Run bootstrap-mail-server.sh first."

say "Installing Dovecot and rspamd"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  dovecot-core dovecot-imapd dovecot-lmtpd dovecot-sieve dovecot-managesieved \
  rspamd redis-server

# ------------------------------------------------------------
say "Mail storage"
# One unprivileged owner for all mail. Mail is never owned by root and
# never lives in a shell user's home, so a compromised mail path cannot
# reach anything else on the box.
getent group vmail  >/dev/null || groupadd -g 5000 vmail
getent passwd vmail >/dev/null || useradd -g vmail -u 5000 vmail -d "${VMAIL_DIR}" -s /usr/sbin/nologin
install -d -o vmail -g vmail -m 0770 "${VMAIL_DIR}" "${VMAIL_DIR}/${MAIL_DOMAIN}"

# ------------------------------------------------------------
say "Mailbox password for ${MAILBOX_USER}"
MBOX_PASS="$(openssl rand -base64 18)"
HASH="$(doveadm pw -s SSHA512 -p "${MBOX_PASS}")"
install -d -m 0750 -o root -g dovecot /etc/dovecot/private
printf '%s:%s::::/var/mail/vhosts/%s/%s::\n' \
  "${MAILBOX_USER}" "${HASH}" "${MAIL_DOMAIN}" "${MAILBOX_USER%%@*}" \
  > /etc/dovecot/private/users
chown root:dovecot /etc/dovecot/private/users
chmod 0640 /etc/dovecot/private/users

# ------------------------------------------------------------
say "Dovecot"
cat > /etc/dovecot/local.conf <<CONF
protocols = imap lmtp sieve
listen = *

mail_location = maildir:${VMAIL_DIR}/%d/%n
mail_uid = vmail
mail_gid = vmail
mail_privileged_group = vmail

# Implicit TLS only. Plaintext IMAP on 143 is not offered: this server is
# on the public internet and a password read off the wire is the whole
# mailbox.
ssl = required
ssl_cert = </etc/letsencrypt/live/${MAIL_HOST}/fullchain.pem
ssl_key  = </etc/letsencrypt/live/${MAIL_HOST}/privkey.pem
ssl_min_protocol = TLSv1.2
disable_plaintext_auth = yes
auth_mechanisms = plain login

passdb {
  driver = passwd-file
  args = scheme=SSHA512 /etc/dovecot/private/users
}
userdb {
  driver = passwd-file
  args = /etc/dovecot/private/users
  default_fields = uid=vmail gid=vmail home=${VMAIL_DIR}/%d/%n
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

# Postfix authenticates submission against THIS, so there is one password
# for reading and sending rather than two stores that drift apart.
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}

protocol imap {
  mail_max_userip_connections = 20
}

plugin {
  sieve = file:${VMAIL_DIR}/%d/%n/sieve;active=${VMAIL_DIR}/%d/%n/.dovecot.sieve
}
CONF

install -d -m 0755 /etc/dovecot/conf.d
systemctl enable --now dovecot
systemctl restart dovecot

# ------------------------------------------------------------
say "Postfix: accept mail for ${MAIL_DOMAIN} and hand it to Dovecot"
# virtual, not mydestination: mydestination means local unix delivery and
# would try to write mail into /var/mail/<shell user>, which is not where
# any of this lives.
postconf -e "virtual_mailbox_domains = ${MAIL_DOMAIN}"
postconf -e "virtual_transport = lmtp:unix:private/dovecot-lmtp"
postconf -e "virtual_mailbox_maps = texthash:/etc/postfix/vmailbox"
postconf -e "virtual_alias_maps = texthash:/etc/postfix/virtual"

# Recipients that exist. A mail server that accepts anything and bounces
# later is a backscatter source and gets blocklisted for it.
printf '%s OK\n' "${MAILBOX_USER}" > /etc/postfix/vmailbox
{
  printf 'postmaster@%s %s\n' "${MAIL_DOMAIN}" "${MAILBOX_USER}"
  printf 'abuse@%s %s\n'      "${MAIL_DOMAIN}" "${MAILBOX_USER}"
  printf 'supabase@%s %s\n'   "${MAIL_DOMAIN}" "${MAILBOX_USER}"
} > /etc/postfix/virtual

# Switch submission SASL from sasldb to Dovecot, and retire sasldb.
postconf -e "smtpd_sasl_type = dovecot"
postconf -e "smtpd_sasl_path = private/auth"
rm -f /etc/sasldb2 /etc/postfix/sasl/smtpd.conf

# Size cap, so one enormous message cannot fill the disk the mail lives on.
postconf -e "message_size_limit = 52428800"
postconf -e "mailbox_size_limit = 0"

# rspamd sits in front of OpenDKIM in the milter chain: filter first, then
# sign what we send.
postconf -e "smtpd_milters = inet:localhost:11332,inet:localhost:8891"
postconf -e "non_smtpd_milters = inet:localhost:8891"

# ------------------------------------------------------------
say "rspamd"
systemctl enable --now redis-server
cat > /etc/rspamd/local.d/milter_headers.conf <<'CONF'
extended_spam_headers = true;
CONF
cat > /etc/rspamd/local.d/actions.conf <<'CONF'
# Nothing is rejected outright on score alone. A false positive on a
# rejected message is mail the owner never learns existed; a false
# positive in a spam folder is recoverable.
reject = null;
add_header = 6;
greylist = 4;
CONF
cat > /etc/rspamd/local.d/redis.conf <<'CONF'
servers = "127.0.0.1:6379";
CONF
systemctl enable --now rspamd
systemctl restart rspamd

# ------------------------------------------------------------
say "Spam goes to a folder, not a void"
cat > "${VMAIL_DIR}/${MAIL_DOMAIN}/sieve-default" <<'SIEVE'
require ["fileinto","mailbox"];
if header :contains "X-Spam" "Yes" {
  fileinto :create "Junk";
  stop;
}
SIEVE
chown -R vmail:vmail "${VMAIL_DIR}"

# ------------------------------------------------------------
say "Backups"
install -o root -g root -m 0755 "$(dirname "$0")/backup-mail.sh" /usr/local/sbin/backup-mail 2>/dev/null || true
if [[ -x /usr/local/sbin/backup-mail ]]; then
  cat > /etc/systemd/system/mccluster-mail-backup.service <<'UNIT'
[Unit]
Description=Back up the house mail store
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-mail
UNIT
  cat > /etc/systemd/system/mccluster-mail-backup.timer <<'UNIT'
[Unit]
Description=Back up the house mail store every 6 hours
[Timer]
OnCalendar=*-*-* 00,06,12,18:15:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now mccluster-mail-backup.timer
  echo "   backup timer installed (every 6h; OVH's own keeps only 1 restore point)"
else
  echo "   WARNING: backup-mail.sh not found next to this script; no mail backup installed"
fi

systemctl restart postfix
sleep 2
for svc in dovecot rspamd postfix redis-server; do
  systemctl is-active --quiet "$svc" || die "$svc did not start"
done

say "DONE — but the MX still points at Google"
cat <<OUT

Mail is not routed here yet. Read docs/control-plane/SELF-HOSTED-MAIL.md
and migrate the existing Workspace mail BEFORE changing the MX: flipping
it first means new mail lands here while the archive stays stranded in an
account you are trying to stop paying for.

IMAP for your mail client:
  Server:   ${MAIL_HOST}
  Port:     993  (SSL/TLS)
  Username: ${MAILBOX_USER}
  Password: ${MBOX_PASS}

This is also the SMTP password now (${MAIL_HOST}:587, STARTTLS) -- one
credential for reading and sending. Supabase's SMTP password changed with
it, so update that setting too.

Shown once. Only a hash is kept.

OUT
