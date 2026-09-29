"""Recover external Jet4 long values from an exported ACCDB, preserving provenance.

Outputs stay outside the repository. The original JSONL and ACCDB are never changed.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path


def recover(data, descriptor):
    raw = bytes.fromhex(descriptor)
    flags = int.from_bytes(raw[:4], 'little')
    size = flags & 0x3fffffff
    assert len(raw) == 12 and size > 0
    pointer = int.from_bytes(raw[4:8], 'little')
    result = bytearray()
    seen = set()
    while pointer:
        assert pointer not in seen, 'cyclic long-value chain'
        seen.add(pointer)
        page, slot = pointer >> 8, pointer & 0xff
        buf = data[page * 4096:(page + 1) * 4096]
        assert len(buf) == 4096 and buf[4:8] == b'LVAL'
        count = struct.unpack_from('<H', buf, 12)[0]
        assert slot < count
        start = struct.unpack_from('<H', buf, 14 + slot * 2)[0] & 0x1fff
        end = 4096 if slot == 0 else struct.unpack_from('<H', buf, 12 + slot * 2)[0] & 0x1fff
        assert 14 + count * 2 <= start <= end <= 4096
        value = buf[start:end]
        if flags & 0x40000000:
            result.extend(value)
            pointer = 0
        else:
            assert len(value) >= 4
            pointer = int.from_bytes(value[:4], 'little')
            result.extend(value[4:])
        assert len(result) <= size
    assert len(result) == size, (len(result), size)
    # These export descriptors reference uncompressed UTF-16LE memo values.
    # Decode strictly; malformed data is recorded as an error by the caller.
    text = result.decode('utf-16le', errors='strict')
    assert '\ufffd' not in text
    return text, hashlib.sha256(result).hexdigest(), size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('accdb', type=Path)
    ap.add_argument('export', type=Path)
    ap.add_argument('output', type=Path)
    args = ap.parse_args()
    data = args.accdb.read_bytes()
    manifest = json.loads((args.export / 'manifest.json').read_text())
    recovered, errors = [], []
    for table in manifest['tables']:
        fields = [c['name'] for c in table['columns'] if c['access_type'] == 'Memo']
        if not fields:
            continue
        for line in (args.export / table['file']).read_text().splitlines():
            row = json.loads(line)
            for field in fields:
                pointer = row['row'].get(field)
                if not isinstance(pointer, str) or not re.fullmatch('[0-9a-f]{24}', pointer):
                    continue
                base = dict(source_table=table['name'], source_page=row['page'],
                            source_slot=row['slot'], record_sha256=row['record_sha256'],
                            coluna=field, ponteiro=pointer)
                try:
                    text, digest, length = recover(data, pointer)
                    recovered.append(dict(base, texto=text, bytes_sha256=digest, tamanho_bytes=length))
                except Exception as exc:
                    errors.append(dict(base, erro=str(exc)))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'memos.json').write_text(json.dumps(recovered, ensure_ascii=False))
    (args.output / 'memo_errors.json').write_text(json.dumps(errors, ensure_ascii=False))
    print(json.dumps(dict(source_sha256=hashlib.sha256(data).hexdigest(),
                         recovered=len(recovered), errors=len(errors),
                         by_table={t:sum(x['source_table']==t for x in recovered)
                                   for t in sorted({x['source_table'] for x in recovered})})))


if __name__ == '__main__':
    main()
