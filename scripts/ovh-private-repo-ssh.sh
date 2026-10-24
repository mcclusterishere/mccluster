#!/usr/bin/env bash
# Run ON the OVH host as root. Never send the private key to GitHub or to chat.
# A failed SSH preflight must not alter the active reconciliation transport.
set -Eeuo pipefail

MODE="${1:-prepare}"
KEY_DIR=/var/lib/mccluster/reconcile/ssh
KEY="${KEY_DIR}/github_deploy_ed25519"
KNOWN="${KEY_DIR}/github_known_hosts"
REPO="git@github.com:mcclusterishere/mccluster.git"
DROPIN_DIR=/etc/systemd/system/mccluster-vps-reconcile.service.d
DROPIN="${DROPIN_DIR}/50-github-readonly-ssh.conf"
GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
GITHUB_FINGERPRINT="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
SSH_COMMAND="/usr/bin/ssh -F /dev/null -i ${KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN} -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This host-only setup must run as root on OVH." >&2
  exit 2
fi
if [[ "${MODE}" != "prepare" && "${MODE}" != "activate" ]]; then
  echo "usage: sudo bash scripts/ovh-private-repo-ssh.sh prepare|activate" >&2
  exit 2
fi
for cmd in ssh-keygen git systemctl stat; do
  command -v "${cmd}" >/dev/null || { echo "required command unavailable: ${cmd}" >&2; exit 2; }
done

install -d -o root -g root -m 0700 "${KEY_DIR}"
if [[ -L "${KEY_DIR}" || -L "${KEY}" || -L "${KEY}.pub" || -L "${KNOWN}" ]]; then
  echo "Refusing symlinked SSH credential or host-key file." >&2
  exit 2
fi

if [[ "${MODE}" == "prepare" && ! -e "${KEY}" ]]; then
  # Generate a NEW key on OVH if none is configured at this path.
  # The private half never leaves this host.
  (umask 077; ssh-keygen -q -t ed25519 -a 100 -N "" -f "${KEY}" -C "mccluster-ovh-readonly-reconcile")
fi
if [[ ! -f "${KEY}" || ! -f "${KEY}.pub" ]]; then
  echo "OVH key pair missing. Run prepare on the host first." >&2
  exit 2
fi
if [[ "$(stat -c %u "${KEY}")" != "0" ]]; then
  echo "The deploy key must be owned by root." >&2
  exit 2
fi
key_mode="$(stat -c %a "${KEY}")"
if (( (8#${key_mode} & 077) != 0 )); then
  echo "The deploy key is accessible to group/other; refusing use." >&2
  exit 2
fi

# Pin GitHub's published Ed25519 host key, never trust ssh-keyscan / TOFU.
printf '%s\n' "${GITHUB_HOST_KEY}" > "${KNOWN}"
chmod 0600 "${KNOWN}"
if ! ssh-keygen -lf "${KNOWN}" -E sha256 | grep -Fq "${GITHUB_FINGERPRINT}"; then
  echo "GitHub host key fingerprint does not match pinned value." >&2
  exit 2
fi

if [[ "${MODE}" == "prepare" ]]; then
  echo "Register ONLY the following public key as a read-only Deploy key:"
  echo "https://github.com/mcclusterishere/mccluster/settings/keys"
  cat "${KEY}.pub"
  echo "Leave 'Allow write access' OFF, then run this script with activate."
  exit 0
fi

# Prove the key can read BOTH protected refs before installing the override.
refs="$(GIT_SSH_COMMAND="${SSH_COMMAND}" git ls-remote "${REPO}" refs/heads/main refs/heads/deploy/ovh-production)"
grep -Fq $'\trefs/heads/main' <<< "${refs}" || { echo "Cannot read main over SSH." >&2; exit 3; }
grep -Fq $'\trefs/heads/deploy/ovh-production' <<< "${refs}" || { echo "Cannot read production ref over SSH." >&2; exit 3; }

install -d -o root -g root -m 0755 "${DROPIN_DIR}"
tmp="$(mktemp "${DROPIN}.XXXXXX")"
trap 'rm -f "${tmp}"' EXIT
cat > "${tmp}" <<EOF
[Service]
Environment="MCCLUSTER_REPO_URL=${REPO}"
Environment="GIT_SSH_COMMAND=${SSH_COMMAND}"
EOF
chmod 0644 "${tmp}"
mv -f "${tmp}" "${DROPIN}"
systemctl daemon-reload
systemctl start mccluster-vps-reconcile.service
systemctl is-active --quiet mccluster-vps-reconcile.timer
echo "OVH reconciler switched to authenticated read-only GitHub SSH after verified ref access."
echo "Confirm a subsequent timer cycle and /health serving SHA before making the repository private."
