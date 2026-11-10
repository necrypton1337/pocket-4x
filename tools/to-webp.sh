#!/bin/sh
# Сжимает отрендеренные PNG в WebP и кладёт в assets/. Использование: tools/to-webp.sh <папка_с_png>
set -e
SRC="$1"; DST="$(dirname "$0")/../assets"
rm -rf "$DST"; mkdir -p "$DST"
for f in "$SRC"/*.png; do
  n=$(basename "$f" .png)
  cwebp -quiet -q 86 -alpha_q 90 -m 6 "$f" -o "$DST/$n.webp"
done
python3 - "$SRC/manifest.json" "$DST/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m['ext'] = 'webp'
json.dump(m, open(sys.argv[2], 'w'), indent=0)
PY
du -sh "$DST"
