// SPDX-FileCopyrightText: Copyright (c) 2026 Reefy AI
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function waitForOutput(stream, expected) {
  let output = '';
  for await (const chunk of stream) {
    output += chunk.toString();
    if (output.includes(expected)) {
      return;
    }
  }
  throw new Error(`process exited before writing ${expected}`);
}

test('serves the viewer and relays a WebSocket upgrade', async () => {
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), '<h1>viewer-ready</h1>');

  let upstreamRequest = '';
  const upstream = createServer((socket) => {
    let handshakeComplete = false;
    socket.on('data', (chunk) => {
      if (!handshakeComplete) {
        upstreamRequest += chunk.toString();
        if (upstreamRequest.includes('\r\n\r\n')) {
          handshakeComplete = true;
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Connection: Upgrade\r\n' +
            'Upgrade: websocket\r\n\r\nUPSTREAM_READY',
          );
        }
        return;
      }
      socket.write(`ECHO:${chunk.toString()}`);
    });
  });

  const signalPort = await listen(upstream);
  const reservation = createServer();
  const viewerPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));

  const viewer = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(viewerPort),
      SIGNAL_HOST: '127.0.0.1',
      SIGNAL_PORT: String(signalPort),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  try {
    let startupTimer;
    try {
      await Promise.race([
        waitForOutput(viewer.stdout, 'Reefy Isaac viewer listening'),
        new Promise((_, reject) => {
          startupTimer = setTimeout(
            () => reject(new Error('viewer startup timeout')),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(startupTimer);
    }

    const response = await fetch(`http://127.0.0.1:${viewerPort}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<h1>viewer-ready</h1>');

    const browser = connect(viewerPort, '127.0.0.1');
    await once(browser, 'connect');
    browser.write(
      'GET /signal HTTP/1.1\r\n' +
      `Host: 127.0.0.1:${viewerPort}\r\n` +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Sec-WebSocket-Key: c3ludGhldGlj\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n',
    );

    let browserData = '';
    while (!browserData.includes('UPSTREAM_READY')) {
      const [chunk] = await once(browser, 'data');
      browserData += chunk.toString();
    }
    assert.match(browserData, /101 Switching Protocols/);
    assert.match(upstreamRequest, /^GET \/signal HTTP\/1\.1/);
    assert.match(upstreamRequest, new RegExp(`Host: 127.0.0.1:${signalPort}`));

    browser.write('PING');
    const [echo] = await once(browser, 'data');
    assert.equal(echo.toString(), 'ECHO:PING');
    browser.destroy();
  } finally {
    viewer.kill('SIGTERM');
    await once(viewer, 'exit');
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dist, { recursive: true, force: true });
  }
});
