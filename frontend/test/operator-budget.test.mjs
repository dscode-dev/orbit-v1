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
  return { complete: testedModule.exports.confirmOperatorBudgetAcceptance, render: testedModule.exports.renderOperatorBudget, calls, budgetsApi, state };
}

test('records explicit customer acceptance before regenerating the PDF', async () => {
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


test('generates a pending proposal without approving or changing the decision', async () => {
  const { render, calls, state } = setup({ status: 'PENDING' });
  await render('budget-1', budget => { assert.equal(budget.status, 'PENDING'); calls.push('loaded'); });
  assert.deepEqual(calls, ['get', 'loaded', 'render']);
  assert.equal(state.status, 'PENDING');
});

test('retries PDF generation on pending proposals without recording acceptance', async () => {
  const { render, calls, budgetsApi, state } = setup({ status: 'PENDING', renderFails: true });
  await assert.rejects(render('budget-1', () => {}), /PDF failed/);
  budgetsApi.renderBudget = async () => { calls.push('render'); };
  await render('budget-1', () => {});
  assert.equal(calls.filter(call => call === 'approve').length, 0);
  assert.equal(state.status, 'PENDING');
});
