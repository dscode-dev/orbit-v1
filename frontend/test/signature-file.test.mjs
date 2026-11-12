import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const testedModule = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(new URL('../packages/utils/signature-file.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: testedModule, exports: testedModule.exports, File, atob, Uint8Array,
  fetch: () => { throw new Error('Network conversion is blocked by the production CSP'); },
});
const { signatureDataUrlToFile } = testedModule.exports;

test('converts the captured PNG into a multipart-compatible file without a network request', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
  const file = signatureDataUrlToFile(`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(file.name, 'assinatura.png');
  assert.equal(file.type, 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  const form = new FormData(); form.append('file', file);
  assert.equal(form.get('file').size, bytes.length);
});

test('rejects an empty signature and unexpected image sources', () => {
  for(const value of ['data:image/png;base64,', 'https://example.test/image.png', 'data:text/html;base64,PHN2Zz4=', 'data:image/png;base64,!!!']) {
    assert.throws(() => signatureDataUrlToFile(value));
  }
});
