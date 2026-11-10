#!/bin/sh
# Assembles the Firefox build in dist/firefox and zips it for AMO.
# The source is shared with Chrome; only the manifest differs.
set -e
cd "$(dirname "$0")/.."
rm -rf dist/firefox dist/api-header-appender-firefox.zip
mkdir -p dist/firefox/icons
cp -R background.js lib popup dist/firefox/
cp icons/*.png dist/firefox/icons/
cp manifest.firefox.json dist/firefox/manifest.json
(cd dist/firefox && zip -qr ../api-header-appender-firefox.zip .)
echo "Built dist/firefox and dist/api-header-appender-firefox.zip"
