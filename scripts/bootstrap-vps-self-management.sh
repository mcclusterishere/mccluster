#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap-vps-self-management must run as root" >&2
  exit 2
fi

for path in   "${SOURCE_DIR}/scripts/mccluster-vps-reconcile.sh"   "${SOURCE_DIR}/core/systemd/mccluster-vps-reconcile.service"   "${SOURCE_DIR}/core/systemd/mccluster-vps-reconcile.timer"   "${SOURCE_DIR}/core/systemd/mccluster-core-system-health.service"   "${SOURCE_DIR}/core/systemd/mccluster-core-system-health.timer"; do
  [[ -f "${path}" ]] || { echo "missing bootstrap source: ${path}" >&2; exit 2; }
done

for cmd in git rsync flock node npm systemctl; do
  command -v "${cmd}" >/dev/null || { echo "missing required command: ${cmd}" >&2; exit 2; }
done

install -d -o root -g root -m 0755 /var/lib/mccluster/reconcile /opt/mccluster/reconcile

install -o root -g root -m 0755 \
  "${SOURCE_DIR}/scripts/mccluster-vps-reconcile.sh" \
  /opt/mccluster/reconcile/mccluster-vps-reconcile.sh

for unit in   mccluster-vps-reconcile.service   mccluster-vps-reconcile.timer   mccluster-core-system-health.service   mccluster-core-system-health.timer; do
  install -o root -g root -m 0644     "${SOURCE_DIR}/core/systemd/${unit}"     "/etc/systemd/system/${unit}"
done

systemctl daemon-reload
systemctl enable --now mccluster-vps-reconcile.timer
systemctl enable --now mccluster-core-system-health.timer

# Bootstrap now instead of waiting for the first timer interval.
systemctl start mccluster-vps-reconcile.service

systemctl is-enabled --quiet mccluster-vps-reconcile.timer
systemctl is-active --quiet mccluster-vps-reconcile.timer
systemctl is-enabled --quiet mccluster-core-system-health.timer
systemctl is-active --quiet mccluster-core-system-health.timer
systemctl is-active --quiet mccluster-core-runner.service
systemctl is-active --quiet mccluster-core-tool-broker.service

echo "OVH self-management bootstrap complete."
echo "desired_ref=deploy/ovh-production"
cat /var/lib/mccluster/reconcile/deployed_sha 2>/dev/null || true
