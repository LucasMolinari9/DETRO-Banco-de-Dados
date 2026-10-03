#!/usr/bin/env python3
"""Backup integral: snapshot único, restauração estrita e artifact somente age.

Credencial da origem apenas em memória/env. Nunca imprimir stderr do PostgreSQL:
erros de COPY, funções e configuração de roles podem conter dados ou segredos.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit

PROJECT_REF = "gontnlfmothfglssbyyk"
REQUIRED_SCHEMAS = {
    "public", "divat_integracao", "divat_historico", "stage_access_20260928",
    "audit", "private",
}
TABLES_SQL = """
select n.nspname, c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
order by n.nspname, c.relname
"""


class BackupError(Exception):
    """Somente mensagens fixas, revisadas para não conter dados/credenciais."""


def source_environment(raw):
    try:
        url = urlsplit(raw)
        query = parse_qs(url.query, keep_blank_values=True)
        valid = (
            url.scheme in ("postgres", "postgresql") and not url.fragment
            and url.hostname and url.hostname.endswith(".pooler.supabase.com")
            and url.port == 5432 and url.path == "/postgres"
            and unquote(url.username or "") == "postgres." + PROJECT_REF
            and bool(url.password)
            and set(query) <= {"sslmode", "connect_timeout"}
            and all(len(values) == 1 for values in query.values())
        )
        if not valid:
            raise ValueError()
        # Não herdar PGOPTIONS/PGSERVICE/PGDATABASE do ambiente do runner.
        env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        env.pop("SUPABASE_BACKUP_DATABASE_URL", None)
        env.pop("BACKUP_AGE_PUBLIC_KEY", None)
        env.update(
            PGHOST=url.hostname, PGPORT="5432", PGDATABASE="postgres",
            PGUSER=unquote(url.username), PGPASSWORD=unquote(url.password),
            PGSSLMODE="verify-full", PGSSLROOTCERT="system",
            PGCONNECT_TIMEOUT="30",
            PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=1800000",
        )
        return env
    except Exception:
        raise BackupError("Conexão recusada: use o Session pooler 5432 do banco oficial.") from None


def command(args, *, env, output=None):
    # capture_output nunca chega ao log. stdout de dumps vai para arquivo privado.
    result = subprocess.run(args, env=env, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        # Somente categorias fixas, nunca a mensagem/SQL retornada pelo servidor.
        stderr = result.stderr.lower()
        category = next((label for token, label in (
            (b"permission denied", "privilégio insuficiente"),
            (b"already exists", "objeto existente no destino"),
            (b"extension", "extensão indisponível/incompatível"),
            (b"password authentication failed", "autenticação recusada"),
            (b"certificate", "verificação TLS falhou"),
            (b"could not connect", "conexão indisponível"),
        ) if token in stderr), "erro do comando")
        raise BackupError("Falha no comando " + Path(args[0]).name + ": " + category
                          + "; nenhum artifact aprovado.")
    return result.stdout


def counts(conn):
    from psycopg import sql
    result = []
    # Inclui tabelas vazias, partições, schemas internos e tabelas de extensões.
    # Falta de privilégio ou RLS que impeça leitura aborta; não excluir tabela.
    for schema, table in conn.execute(TABLES_SQL).fetchall():
        count = conn.execute(sql.SQL("select count(*) from {}.{}").format(
            sql.Identifier(schema), sql.Identifier(table))).fetchone()[0]
        result.append({"schema": schema, "table": table, "rows": count})
    return result


def compare_counts(source, restored):
    def keyed(rows):
        entries = {(r["schema"], r["table"]): r["rows"] for r in rows}
        if len(entries) != len(rows):
            raise BackupError("Inventário contém tabela duplicada.")
        return entries
    original, target = keyed(source), keyed(restored)
    if not original or original != target:
        raise BackupError("Restauração reprovada: tabelas ausentes, extras ou contagens divergentes.")
    return {"approved": True, "tables_compared": len(original), "mismatches": 0}


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    raw = os.environ.get("SUPABASE_BACKUP_DATABASE_URL", "")
    recipient = os.environ.get("BACKUP_AGE_PUBLIC_KEY", "").strip()
    if not raw or not recipient:
        raise BackupError("Os dois secrets são obrigatórios; nenhum artifact será publicado.")
    if not re.fullmatch(r"age1[ac-hj-np-z02-9]{58}", recipient):
        raise BackupError("BACKUP_AGE_PUBLIC_KEY deve conter uma única chave pública age X25519.")
    source_env = source_environment(raw)
    bin_dir = Path(os.environ.get("PG_BIN", "/usr/lib/postgresql/17/bin"))
    # Criar a saída exclusiva evita misturar runs ou publicar arquivo antigo após falha.
    root = Path(os.environ["RUNNER_TEMP"])
    destination = root / "divat-backup-encrypted"
    destination.mkdir(mode=0o700, exist_ok=False)
    output = destination / "divat-backup.tar.age"
    local_env = {k: v for k, v in source_env.items() if not k.startswith("PG")}
    local_env.update(PGHOST="127.0.0.1", PGPORT="5432", PGDATABASE="divat_restore",
                     PGUSER="divat_restore_runner", PGSSLMODE="disable",
                     PGCONNECT_TIMEOUT="10")
    safe_env = {k: v for k, v in local_env.items() if not k.startswith("PG")}
    encrypted_ok = False
    try:
        import psycopg
        # Chave inválida falha antes de iniciar o dump. Não imprimir o destinatário.
        subprocess.run(["age", "-r", recipient, "-o", os.devnull], input=b"preflight",
                       env=safe_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       check=True)
        with tempfile.TemporaryDirectory(prefix="divat-backup-", dir=root) as work:
            folder = Path(work)
            dump, roles = folder / "database.dump", folder / "roles.sql"
            # A conexão fica aberta até o pg_dump terminar; ele importa ESTE snapshot.
            with psycopg.connect(
                host=source_env["PGHOST"], port=5432, dbname="postgres",
                user=source_env["PGUSER"], password=source_env["PGPASSWORD"],
                sslmode="verify-full", sslrootcert="system", connect_timeout=30,
                options=source_env["PGOPTIONS"], autocommit=True,
            ) as source:
                source.execute("begin isolation level repeatable read read only")
                source.execute("set local row_security = off")
                snapshot = source.execute("select pg_export_snapshot()").fetchone()[0]
                started, version, size = source.execute(
                    "select now(), current_setting('server_version'), pg_database_size(current_database())"
                ).fetchone()
                schemas = [r[0] for r in source.execute(
                    "select nspname from pg_namespace where nspname !~ '^pg_' "
                    "and nspname <> 'information_schema' order by nspname"
                ).fetchall()]
                if not REQUIRED_SCHEMAS <= set(schemas) or not version.startswith("17."):
                    raise BackupError("Origem inesperada: versão ou schemas obrigatórios ausentes.")
                extensions = [dict(name=r[0], version=r[1], schema=r[2]) for r in source.execute(
                    "select extname, extversion, nspname from pg_extension "
                    "join pg_namespace on pg_namespace.oid=extnamespace order by extname"
                ).fetchall()]
                source_counts = counts(source)
                command([str(bin_dir / "pg_dump"), "-Fc", "--snapshot=" + snapshot,
                         "--lock-wait-timeout=60s", "--file=" + str(dump)], env=source_env)
                with roles.open("wb") as handle:
                    command([str(bin_dir / "pg_dumpall"), "--roles-only", "--no-role-passwords"],
                            env=source_env, output=handle)
                source.execute("rollback")
            # Superusuário temporário não colide com postgres/roles do dump da origem.
            command([str(bin_dir / "psql"), "-X", "--set=ON_ERROR_STOP=1",
                     "--file=" + str(roles)], env=local_env)
            command([str(bin_dir / "pg_restore"), "--exit-on-error", "--single-transaction",
                     "--dbname=divat_restore", str(dump)], env=local_env)
            with psycopg.connect(host="127.0.0.1", port=5432, dbname="divat_restore",
                                 user="divat_restore_runner", autocommit=True) as restored:
                restored.execute("begin isolation level repeatable read read only")
                restored.execute("set local row_security = off")
                restored_counts = counts(restored)
                result = compare_counts(source_counts, restored_counts)
                restored.execute("rollback")
            manifest = {
                "format": 1, "project_ref": PROJECT_REF, "scope": "entire_database",
                "snapshot_at": started.isoformat(), "server_version": version,
                "database_bytes": size, "consistent_snapshot": True,
                "git_sha": os.environ.get("GITHUB_SHA"),
                "workflow_run_id": os.environ.get("GITHUB_RUN_ID"),
                "schemas": schemas, "extensions": extensions,
                "files": {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size}
                          for p in (dump, roles)},
                "source_counts": source_counts, "restored_counts": restored_counts,
                "restore": {**result, "engine": "postgres:17",
                            "completed_at": datetime.now(timezone.utc).isoformat(),
                            "owners_and_acls": True, "roles_without_passwords": True},
            }
            (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
            archive = folder / "divat-backup.tar"
            with tarfile.open(archive, "w") as tar:
                for name in ("database.dump", "roles.sql", "manifest.json"):
                    tar.add(folder / name, arcname=name)
            command(["age", "-r", recipient, "-o", str(output), str(archive)], env=safe_env)
            if not output.exists() or output.stat().st_size == 0:
                raise BackupError("Criptografia não produziu pacote; publicação recusada.")
            encrypted_ok = True
            # Log público contém só resultado agregado, sem nomes/contagens de tabelas.
            print("Restauração aprovada: todas as " + str(result["tables_compared"])
                  + " tabelas conferidas; pacote age pronto.")
    finally:
        if not encrypted_ok:
            output.unlink(missing_ok=True)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except BackupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Sem traceback/str(error): ambos podem imprimir credencial ou SQL com dados.
        print("Backup interrompido por erro; nenhum artifact aprovado.", file=sys.stderr)
        sys.exit(1)
