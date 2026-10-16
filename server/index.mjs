import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handle } from './app.mjs';

// Local development server. On Vercel the same handler runs as api/index.mjs.
const port = Number(process.env.PORT || 3001);

const server = createServer(async (request, response) => {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const webRequest = new Request(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`), {
    method: request.method,
    headers: request.headers,
    body: hasBody ? Readable.toWeb(request) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });

  const webResponse = await handle(webRequest);
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
});

server.listen(port, () => console.log(`CPL catalog API listening on http://localhost:${port}`));
