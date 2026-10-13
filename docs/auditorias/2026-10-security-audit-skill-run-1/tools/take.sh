#!/bin/sh
# take.sh <agent-id>: extract hunter result + apply to ledger
set -e
D=$(dirname "$0"); OUT=$(cat $D/out_root)
TID=$(python3 -I -c "import json,sys; print(json.load(open('$D/taskmap.json'))[sys.argv[1]])" "$1")
python3 -I $D/extract_result.py "$TID" "$OUT/parent/results/$1.json"
python3 -I $D/apply_hunter.py "$1" "$OUT/parent/results/$1.json"
