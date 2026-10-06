import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(
  new URL('../apps/operator/lib/atendimento.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const failedStep of ['finalizeHandoffReview', 'renderDocument']) {
  test(`resumes after ${failedStep} fails without duplicating the operation or its new equipment`, async () => {
    const calls = [];
    let status = 'ASSIGNED';
    let failed = false;
    let operationId = null;
    const document = { id: 'document', number: 'OS-000001', type: 'WORK_ORDER' };
    const operation = { id: 'operation', documents: [document] };
    const api = {
      operationApi: {
        createOperation: async (payload) => {
          calls.push(['create', payload]);
          return operation;
        },
        getOperation: async () => operation,
      },
      assignmentsApi: {
        listMyAssignments: async () => ({ items: [{ id: 'assignment', status }] }),
        acceptAssignment: async () => {
          calls.push(['accept']);
          status = 'ACCEPTED';
        },
        startAssignment: async () => {
          calls.push(['start']);
          status = 'STARTED';
        },
        completeAssignment: async () => {
          calls.push(['complete']);
          status = 'COMPLETED';
        },
      },
      documentsApi: Object.fromEntries(
        [
          'saveHandoffDraft',
          'getHandoff',
          'selectHandoffTechnicalSignature',
          'collectCustomerSignature',
          'submitHandoff',
          'finalizeHandoffReview',
          'renderDocument',
        ].map((method) => [
          method,
          async () => {
            calls.push([method]);
            if (method === failedStep && !failed) {
              failed = true;
              throw new Error('Temporary failure');
            }
            return document;
          },
        ]),
      ),
      rvtApi: {},
    };
    const testedModule = { exports: {} };
    runInNewContext(compiled, { module: testedModule, exports: testedModule.exports, require: () => api, Date, Intl });
    const draft = {
      documentType: 'WORK_ORDER',
      customerId: 'customer',
      addressId: 'address',
      equipmentId: 'existing',
      inspectedEquipments: [{ equipmentId: 'existing', sector: 'Sala' }],
      newEquipments: ['Novo 1', 'Novo 2'].map((model) => ({
        equipmentTypeCatalogId: 'catalog',
        manufacturer: 'Carrier',
        model,
        capacity: '18000 BTU/h',
      })),
      serviceType: 'INSTALACAO',
      checklist: [],
      maintenanceChecklist: [],
      reportedIssue: '',
      serviceDescription: '',
      observations: '',
      recommendations: [],
      objective: [],
      conditions: [],
      conclusion: [],
      photos: [],
      signature: 'signature',
      signerName: 'Cliente',
      signerRole: '',
      signedAt: null,
      technicalSignatureId: 'technical',
    };
    const options = () => ({
      operationId,
      onCreated: (id) => {
        operationId = id;
      },
    });
    await assert.rejects(
      testedModule.exports.createOperationFromDraft(draft, options()),
      /Temporary failure/,
    );
    const result = await testedModule.exports.createOperationFromDraft(draft, options());
    assert.equal(result.operation.id, operation.id);
    assert.equal(calls.filter(([method]) => method === 'create').length, 1);
    assert.equal(calls.find(([method]) => method === 'create')[1].newEquipments.length, 2);
    for (const method of [
      'accept',
      'start',
      'complete',
      'saveHandoffDraft',
      'collectCustomerSignature',
    ]) {
      assert.equal(calls.filter(([called]) => called === method).length, 1);
    }
  });
}
