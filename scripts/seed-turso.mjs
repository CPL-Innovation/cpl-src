import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

// Copies data/catalog.sqlite into the Turso database named by TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.
// Existing rows with the same id are left untouched, so re-running only adds missing records.
if (!process.env.TURSO_DATABASE_URL) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this script.');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = createClient({ url: pathToFileURL(join(root, 'data', 'catalog.sqlite')).href });
const target = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await target.executeMultiple(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_date TEXT NOT NULL DEFAULT '',
    archive_date TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    collection TEXT NOT NULL DEFAULT '',
    sport TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL,
    year INTEGER,
    image_url TEXT NOT NULL DEFAULT '',
    audio_url TEXT NOT NULL DEFAULT '',
    filesize INTEGER
  );
  CREATE TABLE IF NOT EXISTS interviews (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    transcript TEXT NOT NULL DEFAULT ''
  );
`);

async function copyTable(table) {
  const { columns, rows } = await source.execute(`SELECT * FROM ${table}`);
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    await target.batch(chunk.map((row) => ({ sql, args: columns.map((_, index) => row[index]) })), 'write');
  }
  console.log(`${table}: copied ${rows.length} rows`);
}

await copyTable('items');
await copyTable('interviews');
