#!/usr/bin/env bash
set -euo pipefail

# Bootstrap the OVH Core host as a headless autonomous game-production workstation.
# Designed for Ubuntu 24.04+ and safe to re-run.

GODOT_VERSION="${GODOT_VERSION:-4.7.2}"
BLENDER_VERSION="${BLENDER_VERSION:-5.2.1}"
INSTALL_ROOT="${MCCLUSTER_GAME_TOOLS_ROOT:-/opt/mccluster/tools}"
BIN_ROOT="${MCCLUSTER_GAME_BIN_ROOT:-/usr/local/bin}"
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
mkdir -p "$INSTALL_ROOT/godot" "$INSTALL_ROOT/blender" /var/lib/mccluster/game-artifacts
chmod 0755 /var/lib/mccluster/game-artifacts

install_godot() {
  local tag="${GODOT_VERSION}-stable"
  local api="https://api.github.com/repos/godotengine/godot-builds/releases/tags/${tag}"
  local json="$TMP_ROOT/godot-release.json"
  curl --fail --silent --show-error --location "$api" -o "$json"

  local asset_url asset_name
  asset_url="$(jq -r --arg v "$GODOT_VERSION" '.assets[] | select(.name == ("Godot_v"+$v+"-stable_linux.x86_64.zip")) | .browser_download_url' "$json" | head -n1)"
  asset_name="Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"
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
  ln -sfn "$binary" "$BIN_ROOT/godot"
  ln -sfn "$binary" "$BIN_ROOT/godot4"
}

install_blender() {
  local series="${BLENDER_VERSION%.*}"
  local archive="blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  local base="https://download.blender.org/release/Blender${series}"
  curl --fail --silent --show-error --location "$base/$archive" -o "$TMP_ROOT/$archive"
  curl --fail --silent --show-error --location "$base/blender-${BLENDER_VERSION}.sha256" -o "$TMP_ROOT/blender.sha256"

  # The official checksum file contains entries for every platform. Verify only our archive.
  grep "  ${archive}$" "$TMP_ROOT/blender.sha256" > "$TMP_ROOT/blender-linux.sha256"
  (cd "$TMP_ROOT" && sha256sum -c blender-linux.sha256)

  rm -rf "$INSTALL_ROOT/blender/$BLENDER_VERSION"
  mkdir -p "$INSTALL_ROOT/blender/$BLENDER_VERSION"
  tar -xJf "$TMP_ROOT/$archive" -C "$INSTALL_ROOT/blender/$BLENDER_VERSION" --strip-components=1
  ln -sfn "$INSTALL_ROOT/blender/$BLENDER_VERSION/blender" "$BIN_ROOT/blender"
}

install_godot
install_blender

cat >/etc/profile.d/mccluster-game-tools.sh <<EOF
export MCCLUSTER_GODOT_BIN="$BIN_ROOT/godot"
export MCCLUSTER_BLENDER_BIN="$BIN_ROOT/blender"
export MCCLUSTER_GAME_ARTIFACT_ROOT="/var/lib/mccluster/game-artifacts"
EOF
chmod 0644 /etc/profile.d/mccluster-game-tools.sh

# Persist runtime paths for systemd services without embedding credentials.
install -d -m 0750 /etc/mccluster
ENV_FILE=/etc/mccluster/game-runtime.env
touch "$ENV_FILE"
chmod 0640 "$ENV_FILE"
for kv in \
  "MCCLUSTER_GODOT_BIN=$BIN_ROOT/godot" \
  "MCCLUSTER_BLENDER_BIN=$BIN_ROOT/blender" \
  "MCCLUSTER_GAME_ARTIFACT_ROOT=/var/lib/mccluster/game-artifacts"; do
  key="${kv%%=*}"
  value="${kv#*=}"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '%s\n' "$kv" >> "$ENV_FILE"
  fi
done

"$BIN_ROOT/godot" --headless --version
"$BIN_ROOT/blender" --version | head -n1
ffmpeg -version | head -n1
git lfs version
cmake --version | head -n1
ninja --version

echo "McCluster game workstation bootstrap complete."
