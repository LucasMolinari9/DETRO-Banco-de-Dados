#!/bin/sh
# Parent-side: create agents/<id>/{scratch (64MiB tmpfs, owned 65534), artifacts (root 0700)} + promotion allowlist.
set -eu
OUT=$(cat "$(dirname "$0")/out_root")
for id in "$@"; do
  echo "$id" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,63}$' || { echo "bad id $id"; exit 1; }
  case "$id" in con|prn|aux|nul|com[1-9]|lpt[1-9]) echo "reserved id"; exit 1;; esac
  A="$OUT/agents/$id"
  [ -e "$A" ] && { echo "exists: $A"; exit 1; }
  mkdir -p "$A/scratch" "$A/artifacts"
  chmod 0700 "$A/artifacts"
  mount -t tmpfs -o size=64m,mode=0755,uid=65534,gid=65534,nosuid,nodev "sbx-$id" "$A/scratch"
  python3 -I - "$A" <<'PY'
import json, sys
allow = [f"check-{i:02d}.out" for i in range(1, 21)] + [f"evidence-{i:02d}.txt" for i in range(1, 21)]
json.dump({"allow": allow, "per_file_max": 131072, "cumulative_max": 2097152}, open(sys.argv[1] + "/promotion.json", "w"), indent=1)
PY
  echo "ready $A"
done
