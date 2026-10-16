import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

// Remote Turso database when TURSO_DATABASE_URL is set (Vercel), otherwise the local SQLite file.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localDatabaseUrl = pathToFileURL(join(root, 'data', 'catalog.sqlite')).href;

const database = createClient({
  url: process.env.TURSO_DATABASE_URL || localDatabaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let schemaReady;
function ensureSchema() {
  schemaReady ??= database.executeMultiple(`
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
  `).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

const itemSelect = `
  SELECT items.*, interviews.transcript
  FROM items LEFT JOIN interviews ON interviews.item_id = items.id
`;

function rowsOf(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

function itemResponse(row) {
  return {
    id: row.id,
    title: row.title,
    sourceDate: row.source_date,
    archiveDate: row.archive_date,
    author: row.author,
    description: row.description,
    collection: row.collection,
    sport: row.sport,
    team: row.team,
    format: row.format,
    year: row.year,
    image: row.image_url,
    audio: row.audio_url,
    transcript: row.transcript || '',
    transcriptUrl: row.transcript ? `/api/items/${encodeURIComponent(row.id)}/transcript` : '',
    filesize: row.filesize,
  };
}

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function text(status, value) {
  return new Response(value, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function nullableNumber(value) {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

async function route(request, pathname, searchParams) {
  const { method } = request;

  if (method === 'GET' && pathname === '/api/items') {
    const result = await database.execute(`${itemSelect} ORDER BY items.format = 'Audio', items.id`);
    return json(200, rowsOf(result).map(itemResponse));
  }

  if (method === 'POST' && pathname === '/api/items') {
    const payload = await request.json();
    const id = String(payload.id || '').trim();
    const format = String(payload.format || '').trim();
    if (!id || !['Image', 'Audio'].includes(format)) {
      return json(400, { error: 'id and format (Image or Audio) are required' });
    }

    const statements = [{
      sql: `
        INSERT INTO items
          (id, title, source_date, archive_date, author, description, collection, sport, team, format, year, image_url, audio_url, filesize)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id, String(payload.title || ''), String(payload.sourceDate || ''), String(payload.archiveDate || ''),
        String(payload.author || ''), String(payload.description || ''), String(payload.collection || ''),
        String(payload.sport || ''), String(payload.team || ''), format,
        nullableNumber(payload.year), String(payload.image || ''), String(payload.audio || ''),
        nullableNumber(payload.filesize),
      ],
    }];
    if (format === 'Audio') {
      statements.push({ sql: 'INSERT INTO interviews (item_id, transcript) VALUES (?, ?)', args: [id, String(payload.transcript || '')] });
    }

    try {
      await database.batch(statements, 'write');
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return json(409, { error: 'An item with that ID already exists' });
      }
      throw error;
    }

    const created = await database.execute({ sql: `${itemSelect} WHERE items.id = ?`, args: [id] });
    return json(201, itemResponse(rowsOf(created)[0]));
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (method === 'DELETE' && itemMatch) {
    const id = decodeURIComponent(itemMatch[1]);
    // Remote connections don't keep PRAGMA foreign_keys, so remove the transcript explicitly.
    const [, result] = await database.batch([
      { sql: 'DELETE FROM interviews WHERE item_id = ?', args: [id] },
      { sql: 'DELETE FROM items WHERE id = ?', args: [id] },
    ], 'write');
    if (result.rowsAffected === 0) return json(404, { error: 'Item not found' });
    return json(200, { deleted: true });
  }

  if (method === 'PATCH' && itemMatch) {
    const payload = await request.json();
    const id = decodeURIComponent(itemMatch[1]);
    const result = await database.execute({
      sql: `
        UPDATE items SET title = ?, source_date = ?, archive_date = ?, author = ?, description = ?,
          collection = ?, sport = ?, team = ?, year = ?, image_url = ?, audio_url = ?, filesize = ?
        WHERE id = ?
      `,
      args: [
        String(payload.title || ''), String(payload.sourceDate || ''), String(payload.archiveDate || ''),
        String(payload.author || ''), String(payload.description || ''), String(payload.collection || ''),
        String(payload.sport || ''), String(payload.team || ''), nullableNumber(payload.year),
        String(payload.image || ''), String(payload.audio || ''), nullableNumber(payload.filesize), id,
      ],
    });
    if (result.rowsAffected === 0) return json(404, { error: 'Item not found' });
    if (payload.format === 'Audio' && typeof payload.transcript === 'string') {
      await database.execute({
        sql: `
          INSERT INTO interviews (item_id, transcript) VALUES (?, ?)
          ON CONFLICT(item_id) DO UPDATE SET transcript = excluded.transcript
        `,
        args: [id, payload.transcript],
      });
    }
    return json(200, { saved: true });
  }

  if (method === 'GET' && pathname === '/api/interviews') {
    const result = await database.execute(`
      SELECT items.id, items.title, items.source_date AS date, items.year, items.author, items.description,
             items.collection, items.sport, items.team, items.audio_url AS audioUrl, interviews.transcript
      FROM items JOIN interviews ON interviews.item_id = items.id
      ORDER BY items.id
    `);
    return json(200, rowsOf(result));
  }

  const transcriptMatch = pathname.match(/^\/api\/items\/([^/]+)\/transcript$/);
  if (method === 'GET' && transcriptMatch) {
    const result = await database.execute({
      sql: 'SELECT transcript FROM interviews WHERE item_id = ?',
      args: [decodeURIComponent(transcriptMatch[1])],
    });
    const row = rowsOf(result)[0];
    if (!row) return text(404, 'Transcript not found');
    return text(200, row.transcript);
  }

  const interviewMatch = pathname.match(/^\/api\/interviews\/([^/]+)$/);
  if (method === 'PATCH' && interviewMatch) {
    const payload = await request.json();
    if (typeof payload.transcript !== 'string') return json(400, { error: 'transcript must be a string' });
    const result = await database.execute({
      sql: 'UPDATE interviews SET transcript = ? WHERE item_id = ?',
      args: [payload.transcript, decodeURIComponent(interviewMatch[1])],
    });
    if (result.rowsAffected === 0) return json(404, { error: 'Interview not found' });
    return json(200, { saved: true });
  }

  if (method === 'GET' && pathname === '/api/proxy') {
    const targetUrl = searchParams.get('url');
    if (!targetUrl) return json(400, { error: 'url parameter is required' });
    try {
      const proxyResponse = await fetch(targetUrl);
      return new Response(await proxyResponse.text(), {
        status: proxyResponse.status,
        headers: { ...corsHeaders, 'Content-Type': proxyResponse.headers.get('content-type') || 'application/json' },
      });
    } catch (error) {
      console.error(`Proxy error for ${targetUrl}:`, error);
      return json(502, { error: 'Failed to fetch the requested URL' });
    }
  }

  return json(404, { error: 'Not found' });
}

export async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' },
    });
  }

  const url = new URL(request.url);
  // On Vercel every /api/* path is rewritten to the single function with the original path in `__path`.
  const rewrittenPath = url.searchParams.get('__path');
  const pathname = rewrittenPath === null ? url.pathname : `/api/${rewrittenPath}`;
  url.searchParams.delete('__path');

  try {
    await ensureSchema();
    return await route(request, pathname, url.searchParams);
  } catch (error) {
    console.error(error);
    if (error instanceof SyntaxError) return json(400, { error: 'Invalid JSON body' });
    return json(500, { error: 'Internal server error' });
  }
}
