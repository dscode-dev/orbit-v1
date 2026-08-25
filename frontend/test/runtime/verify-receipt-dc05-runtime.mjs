import { readFile, writeFile } from 'node:fs/promises';

if (process.env.ORBIT_RUNTIME_VERIFY !== 'true') throw new Error('ORBIT_RUNTIME_VERIFY=true is required.');
const base = process.env.ORBIT_RUNTIME_API ?? 'http://127.0.0.1:4000/api/v1';
const credentialsPath = process.env.ORBIT_RUNTIME_CREDENTIALS ?? '/private/tmp/orbit-dc05-credentials.json';
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));

async function request(path, token, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (init.binary) {
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') };
  }
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body.data;
}

const auth = await request('/auth/login', '', { method: 'POST', body: JSON.stringify(credentials) });
const token = auth.accessToken;
const me = await request('/users/me', token);
const customers = await request('/customers?page=1&limit=20', token);
const customer = await request(`/customers/${customers.items[0].id}`, token);
const address = customer.addresses.find((item) => item.isPrimary) ?? customer.addresses[0];
const signatures = await request('/signatures?page=1&limit=100&active=true', token);
const signature = signatures.items.find((item) => item.isDefault && item.hasImage) ?? signatures.items.find((item) => item.hasImage);
if (!address || !signature) throw new Error('Runtime requires one customer address and one active signature image.');

const operation = await request('/operations', token, {
  method: 'POST',
  body: JSON.stringify({
    customerId: customer.id,
    addressId: address.id,
    operatorId: me.user.id,
    type: 'PROJETO',
    documentType: 'RECEIPT',
    status: 'DRAFT',
    receiptIssuedAt: '2026-07-18',
    receiptAmount: 1275.9,
    receiptAmountInWords: 'um mil duzentos e setenta e cinco reais e noventa centavos',
    receiptDescription: 'Higienização e revisão do sistema de climatização',
    receiptWarrantyDays: 90,
    receiptDeclaration: `Recebemos de ${customer.tradeName ?? customer.name} a quantia de R$ 1.275,90 (um mil duzentos e setenta e cinco reais e noventa centavos), correspondente aos serviços prestados. Descrição dos serviços: Higienização e revisão do sistema de climatização.\n\nDamos, por este recibo, a devida quitação e garantia de 90 dias sobre os serviços prestados, contados a partir da data deste documento.`,
  }),
});
let handoff = await request('/documents/handoffs', token, { method: 'POST', body: JSON.stringify({ operationId: operation.id, type: 'RECEIPT' }) });
handoff = await request(`/documents/${handoff.id}/handoff/technical-signature`, token, { method: 'PATCH', body: JSON.stringify({ signatureId: signature.id }) });
await request(`/documents/${handoff.id}/handoff/review`, token, { method: 'POST' });
handoff = await request(`/documents/${handoff.id}/handoff/finalize`, token, { method: 'POST', body: JSON.stringify({ confirm: true }) });
const preview = await request(`/documents/${handoff.id}/preview`, token);
const rendered = await request(`/documents/${handoff.id}/render`, token, { method: 'POST', body: JSON.stringify({}) });
const pdf = await request(`/documents/${handoff.id}/download`, token, { binary: true });
const repository = await request(`/documents?page=1&limit=20&type=RECEIPT&search=${encodeURIComponent(preview.metadata.documentNumber)}`, token);
const result = {
  operationId: operation.id,
  documentId: handoff.id,
  documentNumber: preview.metadata.documentNumber,
  manualReceiptCreated: operation.requestedDocumentType === 'RECEIPT',
  noSyntheticWorkOrder: !operation.documents.some((item) => item.type === 'WORK_ORDER'),
  previewSections: preview.sections.map((section) => section.id),
  technicalSignatureOnly: preview.sections.find((section) => section.id === 'signature')?.components[0]?.signatures?.length === 1,
  rendered: Boolean(rendered.renderedAt ?? rendered.document?.renderedAt ?? rendered.storage?.fileSize),
  pdfHeaderValid: pdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  pdfBytes: pdf.bytes.length,
  pdfContentType: pdf.contentType,
  repositoryRegistered: repository.items.some((item) => item.id === handoff.id && item.type === 'RECEIPT'),
};
if (Object.entries(result).filter(([key]) => !['operationId', 'documentId', 'documentNumber', 'previewSections', 'pdfBytes', 'pdfContentType'].includes(key)).some(([, value]) => value !== true)) {
  throw new Error(`DC-05 runtime failed: ${JSON.stringify(result)}`);
}
await writeFile('/private/tmp/orbit-dc05-receipt.pdf', pdf.bytes);
await writeFile('/private/tmp/orbit-dc05-runtime-evidence.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
