#!/usr/bin/env bash
# VRENT Offerten — Vercel build.
# Installs jspdf (npm) + fonttools/pillow (pip), generates fonts/icons/logo
# via gen_assets.py, then assembles the static site in public/.
set -euo pipefail

echo "== VRENT Offerten build =="

if [ ! -f node_modules/jspdf/dist/jspdf.umd.min.js ]; then
  npm install --no-audit --no-fund
fi

python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --upgrade --user
pipi() { python3 -m pip install --quiet --disable-pip-version-check "$@" fonttools brotli pillow; }
pipi || pipi --user || pipi --break-system-packages

mkdir -p public
python3 gen_assets.py

cp index.html public/
cp manifest.webmanifest public/
cp sw.js public/
cp node_modules/jspdf/dist/jspdf.umd.min.js public/jspdf.umd.min.js

echo "build done"
