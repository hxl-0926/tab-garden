import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') { response.writeHead(302, { Location: '/app/index.html' }); response.end(); return; }
    const relative = pathname === '/' ? 'app/index.html' : pathname.replace(/^\//, '');
    const full = path.resolve(root, relative);
    if (!full.startsWith(root) || !['app', 'src', 'assets'].includes(relative.split('/')[0])) { response.writeHead(403); response.end(); return; }
    const body = await readFile(full);
    response.writeHead(200, { 'Content-Type': types[path.extname(full)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'" });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Tab Garden demo: http://127.0.0.1:${server.address().port}`));
