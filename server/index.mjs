import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = join(root, 'data');
const databasePath = join(dataDirectory, 'catalog.sqlite');
const port = Number(process.env.PORT || 3001);

mkdirSync(dataDirectory, { recursive: true });
if (!existsSync(databasePath)) {
  throw new Error(`SQLite database not found at ${databasePath}. Restore the database before starting the API.`);
}
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
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

const itemQuery = database.prepare(`
  SELECT items.*, interviews.transcript
  FROM items LEFT JOIN interviews ON interviews.item_id = items.id
  ORDER BY items.format = 'Audio', items.id
`);
const interviewQuery = database.prepare(`
  SELECT items.id, items.title, items.source_date AS date, items.year, items.author, items.description,
         items.collection, items.sport, items.team, items.audio_url AS audioUrl, interviews.transcript
  FROM items JOIN interviews ON interviews.item_id = items.id
  ORDER BY items.id
`);

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

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  response.end(body);
}

function sendText(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(value),
    'Access-Control-Allow-Origin': '*',
  });
  response.end(value);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/items') {
      sendJson(response, 200, itemQuery.all().map(itemResponse));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/items') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const id = String(payload.id || '').trim();
      const format = String(payload.format || '').trim();
      if (!id || !['Image', 'Audio'].includes(format)) {
        return sendJson(response, 400, { error: 'id and format (Image or Audio) are required' });
      }

      try {
        database.prepare(`
          INSERT INTO items
            (id, title, source_date, archive_date, author, description, collection, sport, team, format, year, image_url, audio_url, filesize)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, String(payload.title || ''), String(payload.sourceDate || ''), String(payload.archiveDate || ''),
          String(payload.author || ''), String(payload.description || ''), String(payload.collection || ''),
          String(payload.sport || ''), String(payload.team || ''), format,
          payload.year === null ? null : Number(payload.year), String(payload.image || ''), String(payload.audio || ''),
          payload.filesize === null ? null : Number(payload.filesize),
        );
        if (format === 'Audio') {
          database.prepare('INSERT INTO interviews (item_id, transcript) VALUES (?, ?)').run(id, String(payload.transcript || ''));
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          return sendJson(response, 409, { error: 'An item with that ID already exists' });
        }
        throw error;
      }

      const created = database.prepare(`
        SELECT items.*, interviews.transcript
        FROM items LEFT JOIN interviews ON interviews.item_id = items.id
        WHERE items.id = ?
      `).get(id);
      sendJson(response, 201, itemResponse(created));
      return;
    }

    const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (request.method === 'DELETE' && itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      const result = database.prepare('DELETE FROM items WHERE id = ?').run(id);
      if (result.changes === 0) return sendJson(response, 404, { error: 'Item not found' });
      sendJson(response, 200, { deleted: true });
      return;
    }

    if (request.method === 'PATCH' && itemMatch) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const id = decodeURIComponent(itemMatch[1]);
      const result = database.prepare(`
        UPDATE items SET title = ?, source_date = ?, archive_date = ?, author = ?, description = ?,
          collection = ?, sport = ?, team = ?, year = ?, image_url = ?, audio_url = ?, filesize = ?
        WHERE id = ?
      `).run(
        String(payload.title || ''), String(payload.sourceDate || ''), String(payload.archiveDate || ''),
        String(payload.author || ''), String(payload.description || ''), String(payload.collection || ''),
        String(payload.sport || ''), String(payload.team || ''), payload.year === null ? null : Number(payload.year),
        String(payload.image || ''), String(payload.audio || ''), payload.filesize === null ? null : Number(payload.filesize), id,
      );
      if (result.changes === 0) return sendJson(response, 404, { error: 'Item not found' });
      if (payload.format === 'Audio' && typeof payload.transcript === 'string') {
        database.prepare(`
          INSERT INTO interviews (item_id, transcript) VALUES (?, ?)
          ON CONFLICT(item_id) DO UPDATE SET transcript = excluded.transcript
        `).run(id, payload.transcript);
      }
      sendJson(response, 200, { saved: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/interviews') {
      sendJson(response, 200, interviewQuery.all());
      return;
    }

    const transcriptMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/transcript$/);
    if (request.method === 'GET' && transcriptMatch) {
      const row = database.prepare('SELECT transcript FROM interviews WHERE item_id = ?').get(decodeURIComponent(transcriptMatch[1]));
      if (!row) return sendText(response, 404, 'Transcript not found');
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      response.end(row.transcript);
      return;
    }

    const interviewMatch = url.pathname.match(/^\/api\/interviews\/([^/]+)$/);
    if (request.method === 'PATCH' && interviewMatch) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      if (typeof payload.transcript !== 'string') return sendJson(response, 400, { error: 'transcript must be a string' });
      const result = database.prepare('UPDATE interviews SET transcript = ? WHERE item_id = ?').run(payload.transcript, decodeURIComponent(interviewMatch[1]));
      if (result.changes === 0) return sendJson(response, 404, { error: 'Interview not found' });
      sendJson(response, 200, { saved: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/proxy') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return sendJson(response, 400, { error: 'url parameter is required' });
      }
      try {
        const proxyResponse = await fetch(targetUrl);
        const contentType = proxyResponse.headers.get('content-type') || 'application/json';
        const body = await proxyResponse.text();
        response.writeHead(proxyResponse.status, {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(body),
          'Access-Control-Allow-Origin': '*',
        });
        response.end(body);
      } catch (error) {
        console.error(`Proxy error for ${targetUrl}:`, error);
        sendJson(response, 502, { error: 'Failed to fetch the requested URL' });
      }
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(port, () => console.log(`CPL catalog API listening on http://localhost:${port}`));
