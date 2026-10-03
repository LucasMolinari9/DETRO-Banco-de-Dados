import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backup_private.py"
spec = importlib.util.spec_from_file_location("backup_private", SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupGuards(unittest.TestCase):
    def test_counts_require_empty_tables_private_schemas_and_no_extras(self):
        source = [dict(schema="public", table="lines", rows=12),
                  dict(schema="private", table="empty", rows=0)]
        for invalid in (source[:1], source + [dict(schema="audit", table="extra", rows=0)],
                        [source[0], dict(schema="private", table="empty", rows=1)]):
            with self.subTest(invalid=invalid), self.assertRaises(backup.BackupError):
                backup.compare_counts(source, invalid)
        self.assertTrue(backup.compare_counts(source, list(reversed(source)))["approved"])
        with self.assertRaises(backup.BackupError):
            backup.compare_counts([], [])

    def test_duplicate_inventory_cannot_hide_a_table(self):
        rows = [dict(schema="public", table="t", rows=1)] * 2
        with self.assertRaises(backup.BackupError):
            backup.compare_counts(rows, rows)

    def test_credentials_never_appear_in_process_arguments_or_errors(self):
        # Marcador sintético, sem credencial real.
        marker = "synthetic-sensitive-marker"
        url = "postgresql://postgres." + backup.PROJECT_REF + ":" + marker
        url += "@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
        env = backup.source_environment(url)
        self.assertEqual(env["PGPASSWORD"], marker)
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertIn("default_transaction_read_only=on", env["PGOPTIONS"])
        for invalid in (url.replace(":5432/", ":6543/"), url.replace(backup.PROJECT_REF, "wrong"),
                        url + "?options=-c%20ssl=off", marker):
            with self.subTest(invalid=invalid):
                try:
                    backup.source_environment(invalid)
                except backup.BackupError as error:
                    self.assertNotIn(marker, str(error))
                else:
                    self.fail("Conexão inesperada foi aceita")
        try:
            backup.command([sys.executable, "-c", "import os,sys; "
                            "sys.stderr.write(os.environ['PGPASSWORD']); sys.exit(2)"], env=env)
        except backup.BackupError as error:
            self.assertNotIn(marker, str(error))
        else:
            self.fail("Comando com erro foi aceito")

    def test_missing_encryption_secret_fails_before_connecting_or_creating_files(self):
        env = dict(os.environ)
        env.pop("BACKUP_AGE_PUBLIC_KEY", None)
        env["SUPABASE_BACKUP_DATABASE_URL"] = "synthetic-sensitive-marker"
        result = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b"synthetic-sensitive-marker", result.stderr + result.stdout)
        self.assertIn(b"secrets", result.stderr)


if __name__ == "__main__":
    unittest.main()
