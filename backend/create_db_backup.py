import os
import subprocess
from datetime import datetime
from sqlalchemy.engine import make_url

database_url = None

with open(".env") as f:
    for line in f:
        if line.strip().startswith("DATABASE_URL="):
            database_url = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

if not database_url:
    raise SystemExit("DATABASE_URL not found")

url = make_url(database_url)

if not all([url.host, url.username, url.password, url.database]):
    raise SystemExit("Incomplete database configuration")

config = "/tmp/paper_portal_mysql_backup.cnf"

def escape(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')

try:
    with open(config, "w") as f:
        f.write("[client]\n")
        f.write(f'host="{escape(url.host)}"\n')
        f.write(f'port="{url.port or 3306}"\n')
        f.write(f'user="{escape(url.username)}"\n')
        f.write(f'password="{escape(url.password)}"\n')

    os.chmod(config, 0o600)

    os.makedirs("backups", exist_ok=True)
    filename = "backups/pre_multi_college_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".sql"

    print("Creating RDS database backup...")

    with open(filename, "wb") as output:
        result = subprocess.run([
            "mysqldump",
            f"--defaults-extra-file={config}",
            "--single-transaction",
            "--set-gtid-purged=OFF",
            "--skip-lock-tables",
            "--routines",
            "--triggers",
            "--hex-blob",
            "--no-tablespaces",
            url.database
        ], stdout=output, stderr=subprocess.PIPE, text=True)

    if result.returncode != 0:
        if os.path.exists(filename):
            os.remove(filename)
        raise SystemExit("Backup failed: " + result.stderr)

    if os.path.getsize(filename) == 0:
        os.remove(filename)
        raise SystemExit("Backup file is empty")

    print("BACKUP SUCCESSFUL")
    print("File:", filename)
    print("Size:", os.path.getsize(filename), "bytes")

finally:
    if os.path.exists(config):
        os.remove(config)
