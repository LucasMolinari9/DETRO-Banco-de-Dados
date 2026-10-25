#!/usr/bin/env python3
"""Extract skill blocks verbatim. Ref form: FILE.md#Name (Name = bold class name or heading text
before any parenthetical qualifier, e.g. 'Core discipline')."""
import os, re, sys

SKILL = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill_dir")).read().strip()


def extract(ref):
    fname, name = ref.split("#", 1)
    lines = open(os.path.join(SKILL, fname), encoding="utf-8").read().split("\n")
    # Heading block: '## Name (...)' or '## Name' up to next '## ' / '# ' heading.
    for i, l in enumerate(lines):
        m = re.match(r"^(#{2,4}) (.+?)\s*$", l)
        if m:
            text = re.sub(r"\s*\(.*\)\s*$", "", m.group(2)).strip()
            if text == name:
                lvl = len(m.group(1))
                j = i + 1
                while j < len(lines):
                    m2 = re.match(r"^(#{1,4}) ", lines[j])
                    if m2 and len(m2.group(1)) <= lvl:
                        break
                    j += 1
                return "\n".join(lines[i:j]).rstrip()
    # Bold class block: line starting with **Name** up to next bold class line or heading.
    for i, l in enumerate(lines):
        m = re.match(r"^\*\*(.+?)\*\*", l)
        if m and m.group(1) == name:
            j = i + 1
            while j < len(lines) and not re.match(r"^\*\*[^*]+\*\*", lines[j]) and not re.match(r"^#{1,4} ", lines[j]):
                j += 1
            return "\n".join(lines[i:j]).rstrip()
    raise SystemExit(f"block not found: {ref}")


if __name__ == "__main__":
    for r in sys.argv[1:]:
        print(f"----- BEGIN {r} -----")
        print(extract(r))
        print(f"----- END {r} -----\n")
