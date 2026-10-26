import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';

// Production frontend with intercepted API fixtures; no real account or customer data is used.
if (process.env.ORBIT_RUNTIME_VERIFY !== 'true') throw new Error('ORBIT_RUNTIME_VERIFY=true is required.');
const base = process.env.ORBIT_RUNTIME_FRONTEND ?? 'http://127.0.0.1:3011';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('This UI verification is local-only.');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9367', `--user-data-dir=${await mkdtemp('/private/tmp/orbit-mobile-budget-chrome-')}`, 'about:blank',
], { stdio: 'ignore' });
const sockets = [];
let currentPage;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
  for (let i = 0; i < 160; i++) { if (await fn()) return; await sleep(100); }
  throw new Error(`Timed out: ${description}`);
}
const customer = { id: 'customer-1', name: 'Cliente de teste', tradeName: 'Cliente de teste', addresses: [{ id: 'address-1', street: 'Rua de teste', number: '10', city: 'Recife', state: 'PE' }] };
const signature = { id: 'signature-1', name: 'Responsável', title: 'Engenheiro', active: true, isDefault: true, hasImage: true };
const operation = { id: 'operation-1', number: 23, status: 'COMPLETED', customer, address: customer.addresses[0], equipment: { id: 'equipment-1' }, serviceDescription: 'Serviços da OS', inspectedEquipments: [] };
const paginated = items => ({ items, pagination: { page: 1, limit: 100, total: items.length, totalPages: 1 } });
async function page(role = 'OWNER', { signatureFailures = 0, renderFailures = 0 } = {}) {
  const target = await (await fetch('http://127.0.0.1:9367/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const calls = [];
  let saved;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const promise = pending.get(message.id); pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error))); else promise.resolve(message.result);
    }
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method;
    if (method === 'OPTIONS') {
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [
        {name:'Access-Control-Allow-Origin',value:'*'},
        {name:'Access-Control-Allow-Headers',value:'Authorization, Content-Type, X-Request-Id'},
        {name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,OPTIONS'},
      ] });
      return;
    }
    const payload = request.postData ? JSON.parse(request.postData) : null;
    calls.push({ path, method, payload });
    let result = paginated([]), status = 200, binary = false;
    if (path === '/users/me') result = { user: { id: 'user-1', name: `${role} de teste`, role, mustChangePassword: false, isActive: true }, role, permissions: { canReports: true, canSchedules: true }, organization: { id: 'org-1', primaryColor: '#2563eb', secondaryColor: '#123456', legalName: 'Empresa teste', tradeName: 'Empresa teste' } };
    else if (path === '/customers') result = paginated([customer]);
    else if (path === '/customers/customer-1') result = customer;
    else if (path === '/equipments') result = paginated([{ id: 'equipment-1', name: 'Split de teste', type: 'SPLIT' }]);
    else if (path === '/operations') result = paginated([operation]);
    else if (path === '/operations/operation-1') result = operation;
    else if (path === '/signatures') result = paginated([signature]);
    else if (path === '/signatures/signature-1/download') result = { mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' };
    else if (path.includes('budget-material-descriptions') || path.includes('maintenance-checklists') || path.includes('technical-catalog')) result = [];
    else if (path === '/budgets' && method === 'POST') {
      saved = { ...payload, id: 'budget-1', number: 1, status: 'DRAFT', total: 450, customer, document: { id: 'document-1', number: 'ORC-000001' }, items: payload.items };
      result = saved; status = 201;
    } else if (path === '/budgets/budget-1' && method === 'PATCH') { saved = { ...saved, ...payload }; result = saved; }
    else if (path === '/budgets/budget-1') result = saved;
    else if (path === '/documents/document-1/handoff/technical-signature') {
      if (signatureFailures-- > 0) { status = 400; result = 'Assinatura indisponível. Tente novamente.'; }
      else result = {};
    } else if (path === '/budgets/budget-1/approve') { saved.status = 'APPROVED'; result = saved; }
    else if (path === '/budgets/budget-1/render') {
      if (renderFailures-- > 0) { status = 500; result = 'Falha temporária ao gerar PDF'; }
      else { result = { documentId: 'document-1' }; status = 201; }
    } else if (path === '/budgets/budget-1/download') { result = '%PDF-1.4\nTest PDF\n%%EOF'; binary = true; }
    const headers = [
      { name: 'Content-Type', value: binary ? 'application/pdf' : 'application/json' },
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: '*' },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' },
      { name: 'Access-Control-Expose-Headers', value: 'Content-Disposition' },
      ...(binary ? [{ name: 'Content-Disposition', value: 'attachment; filename="ORC-000001.pdf"' }] : []),
    ];
    const body = binary ? result : JSON.stringify(status < 400 ? { success: true, data: result } : { success: false, error: { code: 'TEST_ERROR', message: result } });
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(body).toString('base64') });
  });
  await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/v1/*', requestStage: 'Request' }] });
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    for (const scope of ['operator','platform']) {
      localStorage.setItem('erp.'+scope+'.accessToken',${JSON.stringify(token)});
      localStorage.setItem('erp.'+scope+'.refreshToken','synthetic-refresh');
    }
    window.__downloads = []; window.__shares = [];
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[download]');
      if(link) { event.preventDefault(); window.__downloads.push(link.download); }
    }, true);
    Object.defineProperty(navigator, 'share', { configurable:true, value:async data => { window.__shares.push({name:data.files[0].name,type:data.files[0].type}); } });
    Object.defineProperty(navigator, 'canShare', { configurable:true, value:()=>true });
  ` });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const navigate = async (route, { allowRedirect = false } = {}) => {
    const marker = Math.random().toString(36);
    await evaluate(`window.__navigationMarker = ${JSON.stringify(marker)}`);
    await send('Page.navigate', { url: base + route });
    await until(() => evaluate(`window.__navigationMarker !== ${JSON.stringify(marker)} && location.origin === ${JSON.stringify(new URL(base).origin)} && document.readyState === 'complete' && (${allowRedirect} || location.pathname === ${JSON.stringify(route)})`), route);
  };
  const text = () => evaluate('document.body.innerText');
  const waitText = snippet => until(async () => (await text()).includes(snippet), snippet);
  const click = label => evaluate(`(() => {const el=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)}); if(!el||el.disabled)throw Error('Missing or disabled button: '+${JSON.stringify(label)}); el.click();})()`);
  const input = (label, value) => evaluate(`(() => {
    const parent=Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});
    const el=parent?.querySelector('input,textarea,select'); if(!el)throw Error('Missing input '+${JSON.stringify(label)});
    const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const next = async () => { await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Continuar'&&!el.disabled)`), 'enabled Continue'); await click('Continuar'); await sleep(100); };
  const fill = async ({ fromOperation = false } = {}) => {
    await waitText('Criação manual');
    if (fromOperation) {
      await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('A partir de uma OS concluída')).click()`);
      await waitText('OS-000023');
      await input('Ordem de Serviço concluída', 'operation-1');
    }
    await next(); await waitText('Dados gerais');
    if (!fromOperation) {
      await until(() => evaluate(`!!document.querySelector('button[aria-label="Cliente"]')`), 'customer picker');
      await evaluate(`document.querySelector('button[aria-label="Cliente"]').click()`);
      await waitText('Cliente de teste');
      await evaluate(`document.querySelector('[role="option"]').click()`);
    }
    await until(() => evaluate(`Array.from(document.querySelectorAll('select option')).some(el=>el.value==='address-1')`), 'customer details');
    await next(); await waitText('Serviços orçados');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Continuar').disabled`), true);
    await input('Descrição do serviço', 'Manutenção de campo');
    await input('Valor unitário (R$)', '500');
    await click('Adicionar');
    await input('Valor do desconto (R$)', '50');
    await next(); await waitText('Materiais e fornecimentos');
    await next(); await waitText('Valor por extenso');
    assert.ok((await text()).includes('450,00'));
    await next(); await waitText('Validade da proposta (dias)');
    await next(); await waitText('Assinatura técnica');
    await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Salvar e aprovar'&&!el.disabled)`), 'signature chosen');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  };
  return { send, evaluate, navigate, text, waitText, click, input, fill, calls };
}

try {
  await until(async () => { try { return (await fetch('http://127.0.0.1:9367/json/version')).ok; } catch { return false; } }, 'Chrome');
  const owner = await page('OWNER', { signatureFailures: 1, renderFailures: 1 });
  currentPage = owner;
  await owner.navigate('/operator/atendimento');
  await owner.waitText('Criar orçamento');
  const buttons = await owner.evaluate(`Array.from(document.querySelectorAll('button')).map(el=>el.textContent)`);
  assert.ok(buttons.findIndex(label=>label.includes('Criar orçamento')) > buttons.findIndex(label=>label.includes('Executar PMOC')));
  await owner.evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('Criar orçamento')).click()`);
  await owner.fill();
  await owner.click('Salvar e aprovar'); await owner.waitText('Assinatura indisponível');
  await owner.click('Salvar e aprovar'); await owner.waitText('Falha temporária ao gerar PDF');
  assert.equal(owner.calls.filter(call=>call.path==='/budgets'&&call.method==='POST').length,1);
  await owner.click('Gerar PDF');
  await until(() => owner.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Compartilhar'&&!el.disabled)`), 'ready to share');
  assert.equal(owner.calls.filter(call=>call.path.endsWith('/approve')).length,1);
  await owner.click('Compartilhar');
  assert.equal(await owner.evaluate('window.__shares[0].name'), 'ORC-000001.pdf');
  await owner.click('Baixar PDF');
  assert.equal(await owner.evaluate('window.__downloads[0]'), 'ORC-000001.pdf');
  const pdfRequests = owner.calls.filter(call=>call.path.endsWith('/download')).length;
  await owner.evaluate(`Object.defineProperty(navigator,'share',{configurable:true,value:undefined})`);
  await owner.click('Compartilhar'); await owner.waitText('PDF baixado.');
  assert.equal(owner.calls.filter(call=>call.path.endsWith('/download')).length,pdfRequests);
  console.log('PASS owner menu order, seven shared steps, values, safe signature/PDF retries, download and sharing');

  const draft = await page();
  await draft.navigate('/operator/orcamento'); await draft.fill({ fromOperation: true });
  await draft.click('Salvar rascunho'); await draft.waitText('Orçamento salvo como rascunho');
  const creation = draft.calls.find(call=>call.path==='/budgets'&&call.method==='POST');
  assert.equal(creation.payload.operationId,'operation-1');
  assert.equal(creation.payload.status,'DRAFT');
  assert.ok(!draft.calls.some(call=>call.path.endsWith('/approve')||call.path.endsWith('/render')));
  await draft.click('Aprovar e gerar PDF');
  await until(() => draft.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Baixar PDF'&&!el.disabled)`), 'draft approved');
  console.log('PASS completed OS origin, draft option, later approval and PDF');

  const operator = await page('OPERATOR');
  currentPage = operator;
  await operator.navigate('/operator/atendimento'); await operator.waitText('O que você vai realizar?');
  assert.ok(!(await operator.text()).includes('Criar orçamento'));
  await operator.navigate('/operator/orcamento', { allowRedirect: true });
  await until(() => operator.evaluate(`location.pathname === '/operator'`), 'operator blocked from direct URL');
  assert.ok(!operator.calls.some(call=>call.path.startsWith('/budgets')));
  console.log('PASS operator cannot see the button or open the budget route');

  const manager = await page('MANAGER');
  currentPage = manager;
  await manager.navigate('/operator/orcamento', { allowRedirect: true });
  await until(() => manager.evaluate(`location.pathname !== '/operator/orcamento'`), 'manager blocked from mobile URL');
  assert.ok(!manager.calls.some(call=>call.path.startsWith('/budgets')));
  console.log('PASS manager cannot open the owner mobile flow');
  console.log('Mobile budget browser checks passed against production frontend; API fixtures intercepted.');
} catch (error) {
  if(currentPage) console.error(JSON.stringify({body:await currentPage.text(),calls:currentPage.calls.map(({path,method})=>({path,method}))}));
  throw error;
} finally {
  for (const socket of sockets) socket.close();
  chrome.kill('SIGTERM');
}
