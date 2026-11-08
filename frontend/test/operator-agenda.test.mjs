import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../apps/operator/lib/agenda.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function loader(assignmentsApi) {
  const testedModule = { exports: {} };
  runInNewContext(compiled, {
    module: testedModule,
    exports: testedModule.exports,
    require: () => ({ assignmentsApi }),
    DOMException,
  });
  return testedModule.exports.loadOperatorAgenda;
}

for (const role of ['OWNER', 'OPERATOR', 'MANAGER']) {
  test(`${role} loads every calendar page from the appropriate endpoint`, async () => {
    const calls = [];
    const endpoint = role === 'OWNER' ? 'listOwnerAgenda' : 'listMyAssignments';
    const api = Object.fromEntries(
      ['listOwnerAgenda', 'listMyAssignments'].map((method) => [
        method,
        async (params) => {
          calls.push({ method, ...params });
          return {
            items: Array.from({ length: params.page === 1 ? 100 : 1 }, (_, index) => ({
              id: `${params.page}-${index}`,
            })),
            pagination: { totalPages: 2 },
          };
        },
      ]),
    );
    const signal = new AbortController().signal;
    const items = await loader(api)(role, signal);
    assert.equal(items.length, 101);
    assert.deepEqual(
      calls.map(({ method, page, limit }) => ({ method, page, limit })),
      [
        { method: endpoint, page: 1, limit: 100 },
        { method: endpoint, page: 2, limit: 100 },
      ],
    );
    assert.ok(calls.every((call) => call.signal === signal));
  });
}

test('does not display a partial calendar if a later page fails', async () => {
  const load = loader({
    listOwnerAgenda: async ({ page }) => {
      if (page === 2) throw new Error('Connection lost');
      return { items: [{ id: 'first-page' }], pagination: { totalPages: 2 } };
    },
  });
  await assert.rejects(load('OWNER', new AbortController().signal), /Connection lost/);
});

test('stops loading when the session or page changes and aborts the request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const load = loader({
    listOwnerAgenda: async () => {
      calls += 1;
      controller.abort();
      return { items: [], pagination: { totalPages: 2 } };
    },
  });
  await assert.rejects(load('OWNER', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
