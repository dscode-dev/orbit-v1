import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../apps/operator/lib/agenda-navigation.ts', import.meta.url), 'utf8');
const testedModule = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  module: testedModule, exports: testedModule.exports, URLSearchParams, Date,
});
const { agendaSelection, agendaHref, agendaDetailHref, agendaReturnHref } = testedModule.exports;
const today = new Date(2026, 10, 11, 8);
const localDay = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

test('calendar date is local and the displayed month can differ from the selected day', () => {
  const { selected, cursor } = agendaSelection(new URLSearchParams('date=2026-12-31&month=2027-01'), today);
  assert.deepEqual(localDay(selected), [2026, 12, 31]);
  assert.deepEqual(localDay(cursor), [2027, 1, 1]);
});

test('invalid, overflowing and incomplete dates safely default to today', () => {
  for (const date of ['', '2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01', '2026-11-00', '2026-11-1', 'garbage']) {
    const { selected, cursor } = agendaSelection(new URLSearchParams({ date, month: '2026-99' }), today);
    assert.deepEqual(localDay(selected), localDay(today));
    assert.deepEqual(localDay(cursor), [2026, 11, 1]);
  }
  const { selected } = agendaSelection(new URLSearchParams('date=2028-02-29'), today);
  assert.deepEqual(localDay(selected), [2028, 2, 29]);
});

test('opening an appointment and returning preserves the selected day and calendar month', () => {
  const selected = new Date(2026, 11, 31, 23, 59);
  const cursor = new Date(2027, 0, 1);
  const detail = new URL(agendaDetailHref('assignment-1', selected, cursor), 'https://example.test');
  assert.equal(detail.pathname, '/operator/services/assignment-1');
  assert.equal(detail.searchParams.get('from'), 'agenda');
  const returned = agendaReturnHref(detail.searchParams);
  assert.equal(returned, agendaHref(selected, cursor));
  assert.equal(returned, '/operator/agenda?date=2026-12-31&month=2027-01');
  const restored = agendaSelection(new URL(returned, detail).searchParams, today);
  assert.deepEqual(localDay(restored.selected), localDay(selected));
  assert.deepEqual(localDay(restored.cursor), localDay(cursor));
});

test('detail keeps its ordinary navigation unless opened from Agenda', () => {
  assert.equal(agendaReturnHref(new URLSearchParams()), null);
  assert.equal(agendaReturnHref(new URLSearchParams('from=services&date=2026-11-11')), null);
});

test('return navigation cannot be redirected to an external or arbitrary route', () => {
  const returned = new URL(agendaReturnHref(new URLSearchParams('from=agenda&date=https://evil.test&month=2026-11&returnTo=//evil.test')), 'https://example.test');
  assert.equal(returned.origin, 'https://example.test');
  assert.equal(returned.pathname, '/operator/agenda');
  assert.equal(returned.searchParams.has('returnTo'), false);
  assert.equal(returned.searchParams.get('month'), '2026-11');
});
