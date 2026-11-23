#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'vite';

const { positionals, values } = parseArgs({
  // `pnpm dev -- --port 5600` passes the `--` through, unlike npm.
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '5599' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});
if (positionals.length !== 1 || positionals[0] !== 'dev') {
  throw new Error('Usage: miloa-plugin dev [--port 5599] [--host 127.0.0.1]');
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('--port must be an integer from 1 to 65535');
}

let outDir: string;
await build({
  build: { watch: {} },
  plugins: [{
    name: 'miloa-plugin-dev',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
  }],
});

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const serve = async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const file = basename(decodeURIComponent(url.pathname));
    if (!file.endsWith('.miloaplugin')) {
      res.writeHead(404).end('not found');
      return;
    }

    const body = await readFile(join(outDir, file)).catch(() => undefined);
    if (body === undefined) {
      res.writeHead(404).end('not found');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200).end(body);
  };

  serve().catch(() => {
    res.writeHead(500).end('internal error');
  });
});

server.listen(port, values.host, () => {
  console.log(`Serving ${outDir} at http://${values.host}:${port}/<id>.miloaplugin`);
});
