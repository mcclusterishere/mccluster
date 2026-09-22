#!/usr/bin/env bash
# ============================================================
# MAIL BACKUP.
#
# OVH's automated backup on this VPS keeps ONE restore point, taken daily.
# That covers a dead disk. It does not cover anything you do not notice
# within a day -- a bad sieve rule filing mail into oblivion, a client
# syncing a deletion, a broken migration -- because by the time you look,
# the only restore point is already the damaged one.
#
# So this keeps its own generations, more often, and refuses to call a
# backup good until it has read it back.
#
# A COPY ON THE SAME DISK IS NOT A BACKUP. It survives mistakes; it does
# not survive the disk. Set BACKUP_REMOTE to somewhere else and this will
# push there too, and say plainly in its output when it has not.
# ============================================================
set -Eeuo pipefail

VMAIL_DIR="${VMAIL_DIR:-/var/mail/vhosts}"
DEST="${BACKUP_DIR:-/var/backups/mail}"
KEEP="${BACKUP_KEEP:-28}"          # generations; at 6-hourly that is a week
REMOTE="${BACKUP_REMOTE:-}"        # e.g. user@host:/path, or an rclone target

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${DEST}/mail-${stamp}.tar.zst"

install -d -m 0700 "${DEST}"

[[ -d "${VMAIL_DIR}" ]] || { echo "no mail store at ${VMAIL_DIR}" >&2; exit 2; }

# Dovecot writes Maildir atomically per message, so a running server does
# not need stopping: the worst case is a message that arrives mid-archive
# is missing from this generation and present in the next.
tar --use-compress-program='zstd -3' \
    -cf "${archive}" -C "$(dirname "${VMAIL_DIR}")" "$(basename "${VMAIL_DIR}")"

# Read it back. An archive that cannot be listed is not a backup, and the
# time to discover that is now rather than during a restore.
if ! tar --use-compress-program='zstd -d' -tf "${archive}" >/dev/null 2>&1; then
  rm -f "${archive}"
  echo "BACKUP FAILED: ${archive} did not verify and was removed" >&2
  exit 1
fi

size="$(du -h "${archive}" | cut -f1)"
echo "backed up ${VMAIL_DIR} -> ${archive} (${size}, verified)"

# Rotate only AFTER a good new one exists, so a failing backup never eats
# the last working generation.
ls -1t "${DEST}"/mail-*.tar.zst 2>/dev/null | tail -n "+$((KEEP+1))" | while read -r old; do
  rm -f -- "${old}"
  echo "rotated out ${old}"
done

if [[ -n "${REMOTE}" ]]; then
  if command -v rclone >/dev/null && [[ "${REMOTE}" == *:* && "${REMOTE}" != *@*:* ]]; then
    rclone copy "${archive}" "${REMOTE}" && echo "copied offsite to ${REMOTE}"
  else
    rsync -a "${archive}" "${REMOTE}/" && echo "copied offsite to ${REMOTE}"
  fi
else
  echo "WARNING: BACKUP_REMOTE is unset. These backups are on the same disk as the mail."
  echo "         That survives a mistake. It does not survive the disk."
fi
