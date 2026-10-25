#!/bin/sh
# take_v.sh <verifier-id>: extract verifier result + apply to findings/ledger
set -e
D=$(dirname "$0"); OUT=$(cat $D/out_root)
TID=$(python3 -I -c "import json,sys; print(json.load(open('$D/taskmap.json'))[sys.argv[1]])" "$1")
FP=$(python3 -I -c "import json,sys; print(json.load(open('$D/fpmap.json'))[sys.argv[1]])" "$1")
python3 -I $D/extract_result.py "$TID" "$OUT/parent/results/$1.json"
python3 -I $D/apply_verifier.py "$1" "$OUT/parent/results/$1.json" "$FP"
