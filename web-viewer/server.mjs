// SPDX-FileCopyrightText: Copyright (c) 2026 Reefy AI
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(appRoot, 'dist');
const listenPort = Number(process.env.PORT || 8210);
const signalHost = process.env.SIGNAL_HOST || '127.0.0.1';
const signalPort = Number(process.env.SIGNAL_PORT || 49100);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

async function resolveStaticFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, '') || 'index.html';
  let candidate = join(staticRoot, relative);
  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    return null;
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      candidate = join(candidate, 'index.html');
      return { path: candidate, info: await stat(candidate) };
    }
    if (info.isFile()) {
      return { path: candidate, info };
    }
  } catch {
    // The generated viewer is a single-page app. Unknown paths fall back to
    // index.html so a browser refresh does not produce a server-side 404.
  }

  const fallback = join(staticRoot, 'index.html');
  try {
    return { path: fallback, info: await stat(fallback) };
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const asset = await resolveStaticFile(request.url || '/');
  if (!asset) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Length': asset.info.size,
    'Content-Type': contentTypes.get(extname(asset.path)) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(asset.path).pipe(response);
});

server.on('upgrade', (request, browserSocket, head) => {
  const simulatorSocket = connect(signalPort, signalHost);

  simulatorSocket.once('connect', () => {
    const headerLines = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      if (name.toLowerCase() !== 'host') {
        headerLines.push(`${name}: ${request.rawHeaders[index + 1]}`);
      }
    }
    headerLines.push(`Host: ${signalHost}:${signalPort}`);
    simulatorSocket.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` +
      `${headerLines.join('\r\n')}\r\n\r\n`,
    );
    if (head.length) {
      simulatorSocket.write(head);
    }
    browserSocket.pipe(simulatorSocket).pipe(browserSocket);
  });

  simulatorSocket.on('error', () => browserSocket.destroy());
  browserSocket.on('error', () => simulatorSocket.destroy());
  browserSocket.on('close', () => simulatorSocket.destroy());
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(
    `Reefy Isaac viewer listening on ${listenPort}; ` +
    `WebSocket signaling upstream ${signalHost}:${signalPort}`,
  );
});

