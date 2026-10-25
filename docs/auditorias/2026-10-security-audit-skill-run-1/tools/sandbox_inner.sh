#!/bin/sh
# Trusted parent-side sandbox body. Runs as root inside fresh mount/net/pid/ipc/uts
# namespaces (created by unshare in run_check.py), builds a read-only view of the host
# with only the agent scratch tmpfs writable, then drops to uid/gid 65534 with no
# capabilities and no_new_privs, an empty allowlisted environment and rlimits.
# Args: ROOT SCRATCH CWD OUTNAME TIMEOUT LOOPBACK CPU_S FSIZE NOFILE NPROC [NAME=VALUE ...] -- cmd args...
set -eu
R="$1"; SCR="$2"; CWD="$3"; OUTNAME="$4"; TMO="$5"; LO="$6"
CPU_S="$7"; FSIZE="$8"; NOFILE="$9"; shift 9; NPROC="$1"; shift 1

mount --make-rprivate /
mount --rbind / "$R"
# Remount every mount under $R read-only, deepest first. Any failure aborts (fail closed).
awk -v r="$R" '$5==r || index($5, r"/")==1 {print $5}' /proc/self/mountinfo | sort -r |
while IFS= read -r mp; do
  mp=$(printf '%b' "$mp")
  mount -o remount,bind,ro,nosuid "$mp"
done
mount -t proc -o nosuid,nodev,noexec proc "$R/proc"
# Scratch (parent-mounted, size-limited tmpfs) is the only writable path.
mount --bind "$SCR" "$R/sbx/scratch"
mount -o remount,bind,rw,nosuid,nodev "$R/sbx/scratch"
# /tmp and /dev/shm are redirected into scratch (dirs pre-created and verified no-follow by run_check.py).
mount --bind "$R/sbx/scratch/tmp" "$R/tmp"
mount -o remount,bind,rw,nosuid,nodev "$R/tmp"
mount --bind "$R/sbx/scratch/shm" "$R/dev/shm"
mount -o remount,bind,rw,nosuid,nodev "$R/dev/shm"

if [ "$LO" = "1" ]; then
  /usr/bin/python3 -I -c '
import socket, fcntl, struct
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ifr = struct.pack("16sH14s", b"lo", 0, b"")
flags = struct.unpack("16sH14s", fcntl.ioctl(s, 0x8913, ifr))[1]
fcntl.ioctl(s, 0x8914, struct.pack("16sH14s", b"lo", flags | 0x1, b""))
'
fi

# Split NAME=VALUE env allowlist from the command at "--".
ENVS=""
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
  ENVS="$ENVS
$1"
  shift
done
[ "$#" -gt 0 ] && shift  # drop --
# Env values are validated by run_check.py to ^[A-Za-z0-9_./:@+-]*$, so word splitting is safe.
exec chroot "$R" /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups \
  --inh-caps=-all --bounding-set=-all --no-new-privs -- \
  /usr/bin/env -i $(printf '%s' "$ENVS" | tr '\n' ' ') \
  /usr/bin/prlimit --cpu="$CPU_S" --fsize="$FSIZE" --nofile="$NOFILE" --nproc="$NPROC" --core=0 -- \
  /usr/bin/timeout -s KILL "$TMO" \
  /bin/sh -c 'cd "$1" || exit 97; out="$2"; shift 2; exec "$@" >"/sbx/scratch/$out" 2>&1 </dev/null' sbx "$CWD" "$OUTNAME" "$@"
