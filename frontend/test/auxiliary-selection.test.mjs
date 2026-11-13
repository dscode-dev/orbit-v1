import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relative, dependencies = {}) {
  const testedModule = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: testedModule, exports: testedModule.exports, require: () => dependencies, DOMException });
  return testedModule.exports;
}

test('prefill removes unavailable users while keeping the original crew history untouched', () => {
  const { activeAuxiliaryOperatorIds } = load('../packages/utils/assignment-selection.ts');
  const member = (id, user = {}, status = 'ASSIGNED') => ({assignedTo:id,status,assignee:{role:'OPERATOR',isActive:true,disabledAt:null,deletedAt:null,...user}});
  const history = [member('active'),member('deleted',{deletedAt:'2026-11-12T12:00:00Z'}),member('inactive',{isActive:false}),member('disabled',{disabledAt:'2026-11-12T12:00:00Z'}),member('viewer',{role:'VIEWER'}),member('canceled',{},'CANCELED'),member('rejected',{},'REJECTED')];
  const before = structuredClone(history);
  assert.deepEqual(Array.from(activeAuxiliaryOperatorIds(history)),['active']);
  assert.deepEqual(history,before);
});

test('directory reconciliation loads later pages instead of discarding valid selections beyond the first 100 users', async () => {
  const calls=[];
  const { listAllOperationalUsers } = load('../packages/api/users.ts',{api:{get:async (path,opts)=>{
    calls.push({path,page:opts.query.page});
    return {items:opts.query.page===1 ? Array.from({length:100},(_,i)=>({id:`user-${i}`,isActive:true,role:'OPERATOR'})) : [{id:'last-page-user',isActive:true,role:'OPERATOR'},{id:'inactive',isActive:false,role:'OPERATOR'},{id:'viewer',isActive:true,role:'VIEWER'}],pagination:{totalPages:2}};
  }}});
  const users=await listAllOperationalUsers({signal:new AbortController().signal});
  assert.equal(users.length,101);
  assert.ok(users.some(user=>user.id==='last-page-user'));
  assert.deepEqual(calls,[{path:'/users',page:1},{path:'/users',page:2}]);
});

test('a later-page failure never exposes a partial directory that would erase valid selections', async () => {
  const { listAllOperationalUsers } = load('../packages/api/users.ts',{api:{get:async (_path,opts)=>{
    if(opts.query.page===2)throw new Error('Connection lost');
    return {items:[{id:'first-page-user',isActive:true,role:'OPERATOR'}],pagination:{totalPages:2}};
  }}});
  await assert.rejects(listAllOperationalUsers({signal:new AbortController().signal}),/Connection lost/);
});

test('an aborted directory request stops before reconciliation', async () => {
  const { listAllOperationalUsers } = load('../packages/api/users.ts');
  const controller=new AbortController();controller.abort();
  await assert.rejects(listAllOperationalUsers({signal:controller.signal}),{name:'AbortError'});
});
