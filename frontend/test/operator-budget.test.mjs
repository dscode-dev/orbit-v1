import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../apps/operator/lib/budget.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function setup({ status = 'DRAFT', approvalFails = false, renderFails = false } = {}) {
  const calls = [];
  const state = { status };
  const budgetsApi = {
    async getBudget(id) { calls.push('get'); return { id, status: state.status }; },
    async approveBudget(id) {
      calls.push('approve');
      if (approvalFails) throw new Error('Approval rejected');
      state.status = 'APPROVED';
      return { id, status: state.status };
    },
    async renderBudget() { calls.push('render'); if (renderFails) throw new Error('PDF failed'); },
  };
  const testedModule = { exports: {} };
  runInNewContext(compiled, { module: testedModule, exports: testedModule.exports, require: () => ({ budgetsApi }) });
  return { complete: testedModule.exports.approveAndRenderOperatorBudget, calls, budgetsApi, state };
}

test('approves before generating the official PDF and checkpoints the approval', async () => {
  const { complete, calls } = setup();
  await complete('budget-1', budget => { assert.equal(budget.status, 'APPROVED'); calls.push('checkpoint'); });
  assert.deepEqual(calls, ['get', 'approve', 'checkpoint', 'render']);
});

test('does not generate or expose a PDF when approval is rejected', async () => {
  const { complete, calls } = setup({ approvalFails: true });
  await assert.rejects(complete('budget-1', () => calls.push('checkpoint')), /Approval rejected/);
  assert.deepEqual(calls, ['get', 'approve']);
});

test('retries a failed render without repeating the saved approval', async () => {
  const { complete, calls, budgetsApi } = setup({ renderFails: true });
  const checkpoint = budget => { assert.equal(budget.status, 'APPROVED'); calls.push('checkpoint'); };
  await assert.rejects(complete('budget-1', checkpoint), /PDF failed/);
  budgetsApi.renderBudget = async () => { calls.push('render'); };
  await complete('budget-1', checkpoint);
  assert.equal(calls.filter(call => call === 'approve').length, 1);
  assert.deepEqual(calls.slice(-3), ['get', 'checkpoint', 'render']);
});

test('recovers an approval whose response was lost by reading the server decision', async () => {
  const { complete, calls } = setup({ status: 'APPROVED' });
  await complete('budget-1', () => calls.push('checkpoint'));
  assert.deepEqual(calls, ['get', 'checkpoint', 'render']);
});
