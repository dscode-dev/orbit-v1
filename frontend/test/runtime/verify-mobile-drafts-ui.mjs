import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';

// Local production build + synthetic API responses. Never uses production accounts.
if (process.env.ORBIT_RUNTIME_VERIFY !== 'true') throw Error('ORBIT_RUNTIME_VERIFY=true is required');
const base = process.env.ORBIT_RUNTIME_FRONTEND ?? 'http://127.0.0.1:3011';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local frontend required');
const port = 9371;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${await mkdtemp('/private/tmp/orbit-field-drafts-chrome-')}`,'about:blank'], {stdio:'ignore'});
const sockets=[];
let current;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label) { for(let i=0;i<250;i++){if(await fn())return;await pause(100);}throw Error('Timed out: '+label); }
const paginated=items=>({items,pagination:{page:1,limit:100,total:items.length,totalPages:1}});
const equipmentType='11111111-1111-4111-8111-111111111111';
const customer={id:'customer-1',name:'Cliente cadastrado',addresses:[{id:'address-1',street:'Rua de teste',number:'10',district:'Centro',city:'Recife',state:'PE'}]};
const equipment={id:'equipment-1',name:'Split de teste',manufacturer:'Marca',model:'Modelo',capacity:'12000 BTU',sector:'Sala',customer,address:customer.addresses[0]};
const signature={id:'signature-1',name:'Técnico',title:'Técnico',active:true,hasImage:true};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
async function page(userId='user-a',type='WORK_ORDER') {
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map(),calls=[];
  let revision='2026-11-14T09:00:00Z', handoffFailure=false;
  let operation={id:'operation-1',number:23,type:'CORRETIVA',requestedDocumentType:type,serviceTypes:['CORRETIVA'],status:'IN_PROGRESS',customer,address:customer.addresses[0],equipment,operator:{id:userId,name:'Técnico'},assignment:{id:'assignment-1',assignedBy:'owner-1',assignedTo:userId},photos:[],documents:[],cancellations:[],checklist:[{label:'Verificação de teste',done:false}],maintenanceChecklistItems:[],inspectedEquipments:[{equipmentId:equipment.id,sector:'Sala',equipment,brandSnapshot:'Marca',modelSnapshot:'Modelo',capacitySnapshot:'12000 BTU'}],auxiliaryAssignments:[],reportedIssue:'',serviceDescription:'',createdAt:revision,scheduledFor:revision};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',async event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}
    if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params;const url=new URL(request.url),path=url.pathname.replace('/api/v1',''),method=request.method;
    const headers=[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'Authorization, Content-Type, X-Request-Id'},{name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,DELETE,OPTIONS'}];
    if(method==='OPTIONS'){await send('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:headers});return;}
    const payload=request.postData?JSON.parse(request.postData):null;calls.push({path,method,payload});
    let result=paginated([]),status=200;
    if(path==='/users/me')result={user:{id:userId,name:userId,email:userId+'@example.test',role:'OPERATOR',mustChangePassword:false,isActive:true},role:'OPERATOR',permissions:{canReports:true,canSchedules:true},organization:{id:'org-1',primaryColor:'#2563eb',secondaryColor:'#123456',legalName:'Empresa teste',tradeName:'Empresa teste'}};
    else if(path==='/assignments/assignment-1')result={id:'assignment-1',operationId:operation.id,operation,status:'STARTED',assignedAt:revision,assignedTo:userId,isPrimary:true,assignee:{id:userId,name:userId},assigner:{id:'owner-1',name:'Gestor'}};
    else if(path==='/operations/operation-1'&&method==='PATCH') {
      operation={...operation,...payload,photos:[...operation.photos,...(payload.photos??[]).map((photo,i)=>({id:'server-photo-'+(operation.photos.length+i),caption:photo.caption,mimeType:'image/jpeg',fileSize:100}))]};result=operation;
    }
    else if(path==='/operations/operation-1')result=operation;
    else if(path==='/operations')result=paginated([operation]);
    else if(path.startsWith('/assignments/history/')||path.endsWith('/materials'))result=[];
    else if(path==='/assignments/my')result=paginated([]);
    else if(path==='/customers')result=paginated([customer]);
    else if(path==='/customers/customer-1')result=customer;
    else if(path==='/equipments')result=paginated([equipment]);
    else if(path==='/equipments/equipment-1')result=equipment;
    else if(path==='/technical-catalogs'&&url.searchParams.get('type')==='EQUIPMENT_TYPE')result=paginated([{id:equipmentType,title:'Split',active:true,type:'EQUIPMENT_TYPE'}]);
    else if(path.includes('technical-catalog'))result=paginated([]);
    else if(path.includes('checklist'))result=[];
    else if(path==='/service-types')result=paginated([{key:'CORRETIVA',label:'Corretiva',active:true}]);
    else if(path==='/signatures/me')result=signature;
    else if(path==='/signatures/me/download')result={...signature,mimeType:'image/png',contentBase64:png};
    else if(path==='/documents/handoffs') {
      if(handoffFailure){status=500;result='Falha simulada depois do envio das fotos';}
      else result={id:'document-1',number:'OS-000023',type};
    } else if(path.includes('/handoff'))result={id:'document-1',number:'OS-000023',type};
    else if(path==='/assignments/assignment-1/complete')result={status:'COMPLETED'};
    else if(path==='/documents/document-1/render')result={documentId:'document-1'};
    await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:headers,body:Buffer.from(JSON.stringify(status<400?{success:true,data:result}:{success:false,error:{code:'TEST_ERROR',message:result}})).toString('base64')});
  });
  await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTimezoneOverride',{timezoneId:'America/Recife'});
  await send('Fetch.enable',{patterns:[{urlPattern:'*api/v1/*',requestStage:'Request'}]});
  const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('erp.operator.accessToken',${JSON.stringify(token)});localStorage.setItem('erp.operator.refreshToken','synthetic');`});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const text=()=>evaluate('document.body.innerText');
  const waitText=label=>until(async()=>(await text()).includes(label),label);
  const navigate=async route=>{const marker=Math.random().toString(36);await evaluate(`window.__marker=${JSON.stringify(marker)}`);await send('Page.navigate',{url:base+route});await until(()=>evaluate(`window.__marker!==${JSON.stringify(marker)}&&document.readyState==='complete'&&location.pathname===${JSON.stringify(new URL(base+route).pathname)}`),'navigate '+route);};
  const click=label=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button missing/disabled: '+${JSON.stringify(label)});b.click();})()`);
  const partial=label=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes(${JSON.stringify(label)}));if(!b||b.disabled)throw Error('Button missing/disabled');b.click();})()`);
  const input=(label,value)=>evaluate(`(()=>{const parent=Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});const el=parent?.querySelector('input,textarea,select');if(!el)throw Error('Input missing: '+${JSON.stringify(label)});const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const textarea=(label,value)=>input(label,value);
  const records=()=>evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('erp-operator-field-drafts',1);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve([]);return;}const tx=db.transaction('drafts');const q=tx.objectStore('drafts').getAll();q.onsuccess=()=>resolve(q.result.map(item=>({...item,data:{...item.data,photos:item.data.photos.map(p=>({name:p.name,size:p.file.size,type:p.file.type,caption:p.caption}))}})));tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);})`);
  const photo=async(camera=false)=>{
    await evaluate(`(async()=>{if(!window.__sourcePhoto){const c=document.createElement('canvas');c.width=2600;c.height=1950;const ctx=c.getContext('2d'),data=ctx.createImageData(c.width,c.height);let seed=123456;for(let i=0;i<data.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));window.__sourcePhoto=new File([blob],'large-original.png',{type:'image/png'});}if(window.__sourcePhoto.size<=5*1024*1024)throw Error('Fixture must exceed API limit');const dt=new DataTransfer();dt.items.add(window.__sourcePhoto);const el=document.querySelector('input[aria-label="${camera?'Tirar foto com a câmera':'Escolher fotos da galeria'}"]');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate(`!document.body.innerText.includes('Preparando e compactando fotos…')&&!!document.querySelector('input[placeholder="Legenda opcional"]')`),'photo compression');
  };
  const caption=value=>evaluate(`(()=>{const inputs=document.querySelectorAll('input[placeholder="Legenda opcional"]');const el=inputs[inputs.length-1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const nextStep=async()=>{await click('Continuar');await pause(100);};
  return {send,evaluate,navigate,text,waitText,click,partial,input,textarea,records,photo,caption,nextStep,calls,setRevision:value=>{revision=value;},failHandoff:value=>{handoffFailure=value;}};
}

try {
  await until(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'Chrome');
  const a=await page();current=a;
  await a.navigate('/operator/execucao/assignment-1');await a.waitText('Salvar rascunho e sair');
  await a.nextStep();await a.textarea('Defeito ou solicitação','Texto manual do atendimento');await a.nextStep();
  await a.waitText('Tirar foto');await a.photo(true);await a.caption('Evidência preservada');
  assert.equal((await a.records()).length,0,'no automatic draft creation');
  await a.click('Salvar rascunho e sair');await until(()=>a.evaluate(`location.pathname==='/operator/services/assignment-1'`),'saved exit');
  let saved=await a.records();assert.equal(saved.length,1);assert.equal(saved[0].data.photos.length,1);assert.ok(saved[0].data.photos[0].size<=512*1024);assert.equal(saved[0].data.photos[0].type,'image/jpeg');
  await a.navigate('/operator/execucao/assignment-1');await a.waitText('Rascunho recuperado.');await a.waitText('Tirar foto');
  assert.equal(await a.evaluate(`document.querySelector('input[placeholder="Legenda opcional"]').value`),'Evidência preservada');
  await until(()=>a.evaluate(`Array.from(document.querySelectorAll('img')).some(el=>el.src.startsWith('blob:')&&el.naturalWidth>0)`),'restored image preview');
  await a.nextStep();await a.click('Voltar');await a.waitText('Tirar foto');
  await until(()=>a.evaluate(`Array.from(document.querySelectorAll('img')).some(el=>el.src.startsWith('blob:')&&el.naturalWidth>0)`),'preview survives changing steps');
  await a.click('Voltar');assert.equal(await a.evaluate(`Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim()==='Defeito ou solicitação').querySelector('textarea').value`),'Texto manual do atendimento');
  const b=await page('user-b');current=b;await b.navigate('/operator/execucao/assignment-1');await b.waitText('Salvar rascunho e sair');
  assert.ok(!(await b.text()).includes('Rascunho recuperado.'));
  assert.equal(await b.evaluate(`document.querySelector('h1').textContent`),'Checklist');
  console.log('Assigned OS: manual save, real compression of >5 MiB camera image, Blob/caption/text/step restoration, preview lifetime, and user isolation passed.');

  current=a;
  // A fresh revision cannot receive data collected under an earlier assignment.
  a.setRevision('2026-11-14T15:00:00Z');await a.navigate('/operator/execucao/assignment-1');await a.waitText('Salvar rascunho e sair');
  assert.equal(await a.evaluate(`document.querySelector('h1').textContent`),'Checklist');assert.equal((await a.records()).length,0);

  // New guest OS: incomplete client/equipment fields are saved without creating a customer/operation.
  await a.navigate('/operator/atendimento');await a.waitText('O que você vai realizar?');await a.partial('Ordem de Serviço');
  await a.waitText('OS avulso — cliente novo');await a.partial('OS avulso — cliente novo');await a.waitText('Cliente novo (atendimento avulso)');
  await a.input('Nome / Razão social *','Cliente avulso do rascunho');await a.input('Logradouro *','Rua preservada');
  await a.input('Marca *','Marca ainda não adicionada');
  await a.click('Salvar rascunho e sair');await until(()=>a.evaluate(`location.pathname==='/operator'`),'new guest draft saved');
  saved=await a.records();assert.equal(saved.length,1);assert.equal(saved[0].kind,'new');assert.equal(saved[0].data.walkEquipmentInput.manufacturer,'Marca ainda não adicionada');
  assert.equal(a.calls.filter(call=>call.path==='/customers/walk-in'||(call.path==='/operations'&&call.method==='POST')).length,0);
  await b.navigate('/operator/atendimento');await b.waitText('O que você vai realizar?');await b.partial('Ordem de Serviço');await b.waitText('OS avulso — cliente novo');await b.partial('OS avulso — cliente novo');await b.waitText('Cliente novo (atendimento avulso)');
  assert.ok(!(await b.text()).includes('Continuar um rascunho?'));
  current=a;await a.navigate('/operator/atendimento');await a.waitText('O que você vai realizar?');await a.partial('Ordem de Serviço');await a.waitText('OS avulso — cliente novo');await a.partial('OS avulso — cliente novo');await a.waitText('Continuar um rascunho?');
  await a.partial('Cliente avulso do rascunho');await a.waitText('Rascunho recuperado.');
  assert.equal(await a.evaluate(`Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim()==='Marca *').querySelector('input').value`),'Marca ainda não adicionada');
  await a.input('Cidade *','Recife');await a.input('Número *','10');await a.input('Bairro *','Centro');await a.input('UF *','PE');await a.input('Nome do contato *','Contato teste');await a.input('Telefone *','81999999999');
  await until(()=>a.evaluate(`Array.from(document.querySelectorAll('option')).some(el=>el.value==='${equipmentType}')`),'equipment catalog');
  await a.input('Tipo *',equipmentType);await a.input('Modelo *','Modelo');await a.input('Capacidade *','12000 BTU');await a.click('Adicionar equipamento');
  await a.nextStep();await a.waitText('Execução');await a.partial('Corretiva');await a.nextStep();await a.nextStep();await a.nextStep();await a.waitText('Tirar foto');await a.photo(false);await a.caption('Galeria compactada');
  await a.click('Salvar rascunho e sair');await until(()=>a.evaluate(`location.pathname==='/operator'`),'updated guest draft');
  saved=await a.records();assert.equal(saved.length,1);assert.equal(saved[0].data.photos[0].caption,'Galeria compactada');assert.ok(saved[0].data.photos[0].size<=512*1024);
  await a.navigate('/operator/atendimento');await a.waitText('O que você vai realizar?');await a.partial('Ordem de Serviço');await a.waitText('OS avulso — cliente novo');await a.partial('OS avulso — cliente novo');await a.waitText('Continuar um rascunho?');
  await a.click('Iniciar novo atendimento');await a.waitText('Cliente novo (atendimento avulso)');
  assert.equal(await a.evaluate(`Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim()==='Nome / Razão social *').querySelector('input').value`),'');
  console.log('Guest OS: partial fields and unfinished equipment inputs restored; no server writes on save; gallery compression, updating the same draft, clean start, and cross-user list isolation passed.');

  const rvt=await page('user-a','TECHNICAL_REPORT');current=rvt;
  await rvt.navigate('/operator/execucao/assignment-1');await rvt.waitText('Salvar rascunho e sair');await rvt.nextStep();await rvt.nextStep();await rvt.waitText('Tirar foto');await rvt.photo(false);await rvt.caption('Foto RVT');await rvt.click('Salvar rascunho e sair');await until(()=>rvt.evaluate(`location.pathname==='/operator/services/assignment-1'`),'RVT saved');
  await rvt.navigate('/operator/execucao/assignment-1');await rvt.waitText('Rascunho recuperado.');assert.equal(await rvt.evaluate(`document.querySelector('input[placeholder="Legenda opcional"]').value`),'Foto RVT');
  console.log('Assigned RVT: automatic draft/step/photo restoration passed.');
  await rvt.nextStep();await rvt.nextStep();await rvt.waitText('Usar minha assinatura nesta atividade');
  await rvt.evaluate(`(()=>{const el=document.querySelector('input[placeholder="Nome do cliente/responsável"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Cliente que assinou');el.dispatchEvent(new Event('input',{bubbles:true}));const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();for(const [type,x,y] of [['pointerdown',20,30],['pointermove',50,60],['pointermove',100,25],['pointerup',130,40]])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:rect.left+x,clientY:rect.top+y,pointerId:1,pointerType:'touch'}));})()`);
  await rvt.click('Confirmar assinatura');await rvt.click('Salvar rascunho e sair');await until(()=>rvt.evaluate(`location.pathname==='/operator/services/assignment-1'`),'signature draft saved');
  await rvt.navigate('/operator/execucao/assignment-1');await rvt.waitText('Rascunho recuperado.');await rvt.waitText('Assinatura já coletada para este atendimento.');
  const signed=(await rvt.records()).find(item=>item.kind==='assigned');assert.ok(signed.data.signature.startsWith('data:image/png;base64,'));assert.equal(signed.data.signerName,'Cliente que assinou');
  rvt.failHandoff(true);await rvt.nextStep();await rvt.click('Concluir e gerar PDF');await rvt.waitText('Falha simulada depois do envio das fotos');
  const checkpointed=(await rvt.records()).find(item=>item.kind==='assigned');assert.equal(checkpointed.data.photos.length,0);assert.equal(checkpointed.data.persistedPhotoCount,1);
  await rvt.click('Salvar rascunho e sair');await until(()=>rvt.evaluate(`location.pathname==='/operator/services/assignment-1'`),'checkpoint saved');
  rvt.failHandoff(false);await rvt.navigate('/operator/execucao/assignment-1');await rvt.waitText('Rascunho recuperado.');await rvt.click('Concluir e gerar PDF');
  await until(async()=>!(await rvt.records()).some(item=>item.kind==='assigned'),'completed draft removed');
  const writes=rvt.calls.filter(call=>call.path==='/operations/operation-1'&&call.method==='PATCH');assert.equal(writes.length,2);assert.equal(writes[0].payload.photos.length,1);assert.equal(writes[1].payload.photos.length,0);
  console.log('Confirmed customer signature restoration, checkpointed photo upload, retry without duplicate photos, and draft removal after completion passed.');

  // A distinct guest RVT list does not mix in the saved guest OS.
  current=a;await a.navigate('/operator/atendimento');await a.waitText('O que você vai realizar?');await a.partial('Visita Técnica');await a.waitText('RVT avulso');await a.partial('RVT avulso');await a.waitText('RVT avulso — cliente novo');await a.partial('RVT avulso — cliente novo');await a.waitText('Cliente novo (atendimento avulso)');
  assert.ok(!(await a.text()).includes('Continuar um rascunho?'));
  await a.input('Nome / Razão social *','Cliente RVT avulso');await a.click('Salvar rascunho e sair');await until(()=>a.evaluate(`location.pathname==='/operator'`),'guest RVT saved');
  await a.navigate('/operator/atendimento');await a.waitText('O que você vai realizar?');await a.partial('Visita Técnica');await a.waitText('RVT avulso');await a.partial('RVT avulso');await a.waitText('RVT avulso — cliente novo');await a.partial('RVT avulso — cliente novo');await a.waitText('Continuar um rascunho?');
  assert.ok((await a.text()).includes('Cliente RVT avulso'));assert.ok(!(await a.text()).includes('Cliente avulso do rascunho'));
  await a.partial('Cliente RVT avulso');await a.waitText('Rascunho recuperado.');
  // A storage failure must leave the technician in the form with their data.
  await a.evaluate(`window.__realOpen=IDBFactory.prototype.open;IDBFactory.prototype.open=function(){throw new Error('Espaço indisponível no teste');}`);
  await a.click('Salvar rascunho e sair');await a.waitText('Espaço indisponível no teste');assert.equal(await a.evaluate('location.pathname'),'/operator/atendimento');
  await a.evaluate('IDBFactory.prototype.open=window.__realOpen');
  console.log('Guest RVT draft listing/resume, document-type separation, and storage-failure feedback without losing the form passed.');

} catch(error) {
  console.error(error);if(current)console.error((await current.text()).slice(0,7000),current.calls.map(({path,method})=>({path,method})));
  process.exitCode=1;
} finally { for(const socket of sockets)socket.close();chrome.kill('SIGTERM'); }
