#!/bin/sh
set -eu

name="endlessnet-client"
install_dir="${ENDLESSNET_INSTALL_DIR:-/usr/local/bin}"
server_url="${ENDLESSNET_SERVER_URL:-}"
auth_token="${ENDLESSNET_AUTH_TOKEN:-}"
network="${ENDLESSNET_NETWORK:-}"
hostname_value="${ENDLESSNET_HOSTNAME:-$(hostname)}"
release_base="${ENDLESSNET_RELEASE_BASE_URL:-}"
download_url="${ENDLESSNET_DOWNLOAD_URL:-}"
go_package="${ENDLESSNET_GO_PACKAGE:-}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

tmp="${TMPDIR:-/tmp}/endlessnet-install.$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT INT TERM

bin="$tmp/$name"

fetch() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    echo "curl or wget is required" >&2
    exit 1
  fi
}

install_bin() {
  src="$1"
  mkdir -p "$install_dir" 2>/dev/null || true
  if [ -w "$install_dir" ]; then
    install -m 0755 "$src" "$install_dir/$name"
  elif command -v sudo >/dev/null 2>&1; then
    sudo install -m 0755 "$src" "$install_dir/$name"
  else
    echo "Cannot write to $install_dir and sudo is not available" >&2
    exit 1
  fi
}

if [ -n "$download_url" ]; then
  archive="$tmp/endlessnet-download"
  fetch "$download_url" "$archive"
  case "$download_url" in
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$tmp"
      found="$(find "$tmp" -type f -name "$name" | head -n 1)"
      [ -n "$found" ] || { echo "$name not found in archive" >&2; exit 1; }
      [ "$found" = "$bin" ] || cp "$found" "$bin"
      ;;
    *)
      cp "$archive" "$bin"
      ;;
  esac
elif [ -n "$release_base" ]; then
  archive="$tmp/endlessnet.tar.gz"
  fetch "$release_base/${name}_${os}_${arch}.tar.gz" "$archive"
  tar -xzf "$archive" -C "$tmp"
  found="$(find "$tmp" -type f -name "$name" | head -n 1)"
  [ -n "$found" ] || { echo "$name not found in release archive" >&2; exit 1; }
  [ "$found" = "$bin" ] || cp "$found" "$bin"
elif [ -n "$go_package" ]; then
  command -v go >/dev/null 2>&1 || { echo "go is required for ENDLESSNET_GO_PACKAGE installs" >&2; exit 1; }
  GOBIN="$tmp" go install "$go_package"
else
  cat >&2 <<'EOF'
EndlessNet install source is not configured.

Set one of:
  ENDLESSNET_DOWNLOAD_URL      direct binary or tar.gz URL
  ENDLESSNET_RELEASE_BASE_URL  release directory with endlessnet-client_<os>_<arch>.tar.gz
  ENDLESSNET_GO_PACKAGE        Go package, for example github.com/<owner>/<repo>/cmd/endlessnet-client@latest
EOF
  exit 1
fi

chmod +x "$bin"
install_bin "$bin"

cat <<EOF
EndlessNet client installed:
  $install_dir/$name

Next:
  $name login --server "${server_url:-<server-url>}" --token "${auth_token:-<token>}"
  $name up --network "${network:-<network>}" --hostname "$hostname_value" --output ./wg-endlessnet.conf
EOF

if [ "${ENDLESSNET_AUTO_LOGIN:-0}" = "1" ] && [ -n "$server_url" ] && [ -n "$auth_token" ]; then
  "$install_dir/$name" login --server "$server_url" --token "$auth_token"
fi

if [ "${ENDLESSNET_AUTO_UP:-0}" = "1" ] && [ -n "$network" ]; then
  "$install_dir/$name" up --network "$network" --hostname "$hostname_value" --output ./wg-endlessnet.conf
fi
