"""Require a real original import receipt from the installed native app."""
import sqlite3
import sys
from pathlib import Path

connection = sqlite3.connect(f'file:{Path(sys.argv[1]) / "data" / "kuraki.db"}?mode=ro', uri=True)
count = connection.execute('SELECT COUNT(*) FROM capture_receipts c JOIN assets a ON a.id=c.asset_id AND a.owner_id=c.owner_id WHERE a.deleted_at IS NULL AND a.size_bytes=c.size_bytes AND a.content_hash=c.content_hash').fetchone()[0]
assert count > 0, 'Installed app did not import any confirmed originals'
print(f'Installed native app imported {count} confirmed originals.')
