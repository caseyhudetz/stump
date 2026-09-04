#!/bin/sh
# The suites serve real copies of the map libraries instead of letting the
# browser reach a CDN — partly because the sandbox these run in cannot reach
# one, and partly because a test that silently falls back to no-map is a test
# that passes for the wrong reason. npm is reachable where CDNs are not, so
# the copies come from the registry and land in test/vendor/ (gitignored).
#
# Run once per checkout:  sh test/vendor.sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
out="$here/vendor"
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

grab() {   # package@version  path-inside-package  destination
  npm pack "$1" --silent > /dev/null
  tgz=$(ls ./*.tgz | head -1)
  tar -xzf "$tgz" "package/$2"
  cp "package/$2" "$out/$3"
  rm -rf package "$tgz"
  echo "  $3  <- $1"
}

echo "vendoring map libraries into test/vendor/"
grab leaflet@1.9.4                          dist/leaflet.js      real-leaflet.js
grab leaflet@1.9.4                          dist/leaflet.css     real-leaflet.css
grab maplibre-gl@4.7.1                      dist/maplibre-gl.js  ml.js
grab maplibre-gl@4.7.1                      dist/maplibre-gl.css ml.css
grab @maplibre/maplibre-gl-leaflet@0.1.4    leaflet-maplibre-gl.js mlleaf.js
echo "done"
