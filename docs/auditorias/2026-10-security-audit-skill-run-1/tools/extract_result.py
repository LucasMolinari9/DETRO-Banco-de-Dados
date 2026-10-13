#!/usr/bin/env python3
"""Extract an agent's final hand-back from its transcript and save it as a parent-owned file.
Prints only a short summary (never the content). Usage: extract_result.py <task-id> <dest.json>"""
import json, os, sys

TASKS = "/tmp/claude-0/-home-user-DETRO-Banco-de-Dados/619ba0e6-16ce-5804-beaf-84241fdfceaf/tasks"


def final_text(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    for l in reversed(lines):
        try:
            o = json.loads(l)
        except ValueError:
            continue
        c = o.get("message", {}).get("content")
        if not isinstance(c, list):
            continue
        for x in reversed(c):
            if x.get("type") == "tool_use" and x.get("name") == "SubagentHandback":
                return x["input"]["message"]
        if o.get("message", {}).get("role") == "assistant":
            texts = [x.get("text", "") for x in c if x.get("type") == "text"]
            if any(t.strip() for t in texts):
                return "\n".join(texts)
    return None


def parse_json(text):
    t = text.strip()
    if t.startswith("```"):
        return None, "fenced (prose-wrapped) — malformed per contract"
    try:
        return json.loads(t), None
    except ValueError as e:
        return None, f"not a bare JSON object: {e}"


if __name__ == "__main__":
    tid, dest = sys.argv[1], sys.argv[2]
    text = final_text(os.path.join(TASKS, f"{tid}.output"))
    if text is None:
        print("NO FINAL MESSAGE"); sys.exit(1)
    obj, err = parse_json(text)
    with open(dest + ".raw.txt", "w", encoding="utf-8") as f:
        f.write(text)
    if err:
        print("MALFORMED:", err, "| chars", len(text)); sys.exit(2)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    if isinstance(obj, dict) and "units" in obj:
        print("units:", [(u.get("coverage_id", "")[:60], u.get("disposition")) for u in obj["units"]])
        print("candidates:", [(c.get("fingerprint"), c.get("proposed_verdict"), c.get("title")) for c in obj.get("candidates", [])])
        print("hardening:", len(obj.get("hardening", [])), "uncovered:", len(obj.get("uncovered", [])))
    else:
        print("keys:", list(obj.keys()) if isinstance(obj, dict) else type(obj).__name__)
