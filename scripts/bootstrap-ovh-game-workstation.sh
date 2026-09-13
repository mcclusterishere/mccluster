#!/usr/bin/env bash
set -euo pipefail

# Bootstrap the OVH Core host as a headless autonomous game-production workstation.
# Designed for Ubuntu 24.04+ and safe to re-run.

GODOT_VERSION="${GODOT_VERSION:-4.7.2}"
BLENDER_VERSION="${BLENDER_VERSION:-5.2.1}"
INSTALL_ROOT="${MCCLUSTER_GAME_TOOLS_ROOT:-/opt/mccluster/tools}"
BIN_ROOT="${MCCLUSTER_GAME_BIN_ROOT:-/usr/local/bin}"
ARTIFACT_ROOT="${MCCLUSTER_GAME_ARTIFACT_ROOT:-/var/lib/mccluster/game-artifacts}"
TMP_ROOT="$(mktemp -d /tmp/mccluster-game-tools.XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap must run as root" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH="x86_64" ;;
  *) echo "unsupported architecture: $(uname -m); current bootstrap supports x86_64" >&2; exit 1 ;;
esac

# Leave enough headroom for package installs, extraction, Godot import caches, and build artifacts.
FREE_KB="$(df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ -z "$FREE_KB" || "$FREE_KB" -lt 10485760 ]]; then
  echo "at least 10 GiB free on /opt filesystem is required before game-workstation bootstrap" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl jq unzip xz-utils git git-lfs \
  build-essential cmake ninja-build pkg-config python3 python3-venv python3-pip \
  ffmpeg rsync file \
  libgl1 libegl1 libx11-6 libxext6 libxrender1 libxi6 libxkbcommon0 libfontconfig1 \
  libsm6 libice6 libdbus-1-3 libpulse0 libasound2t64 \
  mesa-vulkan-drivers vulkan-tools

git lfs install --system
mkdir -p "$INSTALL_ROOT/godot" "$INSTALL_ROOT/blender"

# Core runs as mccluster-core. Make the persistent evidence directory writable by that service account.
if id mccluster-core >/dev/null 2>&1; then
  install -d -m 0750 -o mccluster-core -g mccluster-core "$ARTIFACT_ROOT"
else
  echo "mccluster-core service account is missing; deploy Core before bootstrapping game tools" >&2
  exit 1
fi

install_godot() {
  local tag="${GODOT_VERSION}-stable"
  local api="https://api.github.com/repos/godotengine/godot-builds/releases/tags/${tag}"
  local json="$TMP_ROOT/godot-release.json"
  curl --fail --silent --show-error --location "$api" -o "$json"

  local asset_url asset_name
  asset_name="Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"
  asset_url="$(jq -r --arg name "$asset_name" '.assets[] | select(.name == $name) | .browser_download_url' "$json" | head -n1)"
  if [[ -z "$asset_url" || "$asset_url" == "null" ]]; then
    echo "could not resolve Godot Linux x86_64 asset for ${tag}" >&2
    exit 1
  fi

  curl --fail --silent --show-error --location "$asset_url" -o "$TMP_ROOT/$asset_name"
  rm -rf "$INSTALL_ROOT/godot/$GODOT_VERSION"
  mkdir -p "$INSTALL_ROOT/godot/$GODOT_VERSION"
  unzip -q "$TMP_ROOT/$asset_name" -d "$INSTALL_ROOT/godot/$GODOT_VERSION"

  local binary
  binary="$(find "$INSTALL_ROOT/godot/$GODOT_VERSION" -maxdepth 1 -type f -name 'Godot*' -perm -u+x | head -n1)"
  if [[ -z "$binary" ]]; then
    echo "Godot binary not found after extraction" >&2
    exit 1
  fi
  chown -R root:root "$INSTALL_ROOT/godot/$GODOT_VERSION"
  ln -sfn "$binary" "$BIN_ROOT/godot"
  ln -sfn "$binary" "$BIN_ROOT/godot4"
}

install_blender() {
  local series="${BLENDER_VERSION%.*}"
  local archive="blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  local base="https://download.blender.org/release/Blender${series}"
  curl --fail --silent --show-error --location "$base/$archive" -o "$TMP_ROOT/$archive"
  curl --fail --silent --show-error --location "$base/blender-${BLENDER_VERSION}.sha256" -o "$TMP_ROOT/blender.sha256"

  # Official checksum manifests cover all platforms and may use one or two separators.
  awk -v file="$archive" '$NF == file {print $1 "  " file}' "$TMP_ROOT/blender.sha256" > "$TMP_ROOT/blender-linux.sha256"
  if [[ ! -s "$TMP_ROOT/blender-linux.sha256" ]]; then
    echo "Blender checksum entry for $archive was not found" >&2
    exit 1
  fi
  (cd "$TMP_ROOT" && sha256sum -c blender-linux.sha256)

  rm -rf "$INSTALL_ROOT/blender/$BLENDER_VERSION"
  mkdir -p "$INSTALL_ROOT/blender/$BLENDER_VERSION"
  tar -xJf "$TMP_ROOT/$archive" -C "$INSTALL_ROOT/blender/$BLENDER_VERSION" --strip-components=1
  chown -R root:root "$INSTALL_ROOT/blender/$BLENDER_VERSION"
  ln -sfn "$INSTALL_ROOT/blender/$BLENDER_VERSION/blender" "$BIN_ROOT/blender"
}

install_godot
install_blender

cat >/etc/profile.d/mccluster-game-tools.sh <<EOF
export MCCLUSTER_GODOT_BIN="$BIN_ROOT/godot"
export MCCLUSTER_BLENDER_BIN="$BIN_ROOT/blender"
export MCCLUSTER_GAME_ARTIFACT_ROOT="$ARTIFACT_ROOT"
EOF
chmod 0644 /etc/profile.d/mccluster-game-tools.sh

# Persist runtime paths for systemd services without embedding credentials.
install -d -m 0750 /etc/mccluster
ENV_FILE=/etc/mccluster/game-runtime.env
touch "$ENV_FILE"
chown root:mccluster-core "$ENV_FILE"
chmod 0640 "$ENV_FILE"
for kv in \
  "MCCLUSTER_GODOT_BIN=$BIN_ROOT/godot" \
  "MCCLUSTER_BLENDER_BIN=$BIN_ROOT/blender" \
  "MCCLUSTER_GAME_ARTIFACT_ROOT=$ARTIFACT_ROOT"; do
  key="${kv%%=*}"
  value="${kv#*=}"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s\n' "$kv" >> "$ENV_FILE"
  fi
done

"$BIN_ROOT/godot" --headless --version
"$BIN_ROOT/blender" --background --version | head -n1
ffmpeg -version | head -n1
git lfs version
cmake --version | head -n1
ninja --version

# Prove the service account can execute both tools and persist evidence.
sudo -u mccluster-core "$BIN_ROOT/godot" --headless --version >/dev/null
sudo -u mccluster-core "$BIN_ROOT/blender" --background --version >/dev/null
touch "$ARTIFACT_ROOT/.bootstrap-write-test"
chown mccluster-core:mccluster-core "$ARTIFACT_ROOT/.bootstrap-write-test"
sudo -u mccluster-core sh -c "echo ok > '$ARTIFACT_ROOT/.bootstrap-write-test'"
rm -f "$ARTIFACT_ROOT/.bootstrap-write-test"

echo "McCluster game workstation bootstrap complete."
