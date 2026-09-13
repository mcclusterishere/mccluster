#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-$(pwd)}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap must run as root" >&2
  exit 2
fi
if [[ ! -f "${SOURCE_DIR}/scripts/mccluster-vps-reconcile.sh" ]]; then
  echo "expected repository checkout at ${SOURCE_DIR}" >&2
  exit 2
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y git rsync util-linux ca-certificates curl jq

install -d -m 0755 /var/lib/mccluster/reconcile
install -m 0755 "${SOURCE_DIR}/scripts/mccluster-vps-reconcile.sh" /usr/local/sbin/mccluster-vps-reconcile
install -m 0644 "${SOURCE_DIR}/core/systemd/mccluster-vps-reconcile.service" /etc/systemd/system/mccluster-vps-reconcile.service
install -m 0644 "${SOURCE_DIR}/core/systemd/mccluster-vps-reconcile.timer" /etc/systemd/system/mccluster-vps-reconcile.timer

systemctl daemon-reload
systemctl enable --now mccluster-vps-reconcile.timer

# Run once immediately; failure leaves the timer installed for later recovery and is surfaced to caller.
systemctl start mccluster-vps-reconcile.service

systemctl is-enabled --quiet mccluster-vps-reconcile.timer
systemctl is-active --quiet mccluster-vps-reconcile.timer

echo "McCluster VPS self-management enabled. Routine deployments now follow deploy/ovh-production outbound from GitHub."
