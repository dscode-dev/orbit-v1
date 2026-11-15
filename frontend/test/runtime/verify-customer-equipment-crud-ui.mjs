import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';

// Production frontend with synthetic API responses; no production accounts or data.
if (process.env.ORBIT_RUNTIME_VERIFY !== 'true') throw Error('ORBIT_RUNTIME_VERIFY=true required');
const base=process.env.ORBIT_RUNTIME_FRONTEND??'http://127.0.0.1:3011';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const port=9375, sockets=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<250;i++){if(await fn())return;await pause(100);}throw Error('Timed out: '+label);}
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${await mkdtemp('/private/tmp/orbit-equipment-chrome-')}`,'about:blank'],{stdio:'ignore'});
const customer={id:'customer-current',name:'Cliente atual fora dos primeiros 100',tradeName:null,type:'COMPANY',isActive:true,createdAt:'2026-11-01T10:00:00Z',addresses:[{id:'address-1',name:'Matriz',street:'Rua teste',city:'Recife',state:'PE'}],contacts:[],attachments:[]};
const equipmentType={id:'11111111-1111-4111-8111-111111111111',title:'Split',tags:['legacy-split'],type:'EQUIPMENT_TYPE',active:true,areas:['GENERAL'],workflows:['GENERAL']};
const initial={id:'equipment-1',name:'Marca Modelo',manufacturer:'Marca',model:'Modelo',capacity:'12000 BTU',serialNumber:'SERIAL-1',sector:'Sala',type:'SPLIT',status:'ACTIVE',isActive:true,deletedAt:null,qrToken:'22222222-2222-4222-8222-222222222222',qrCode:'equipment:22222222-2222-4222-8222-222222222222',customerId:customer.id,customer,address:customer.addresses[0],equipmentTypeCatalogId:equipmentType.id,equipmentTypeCatalog:equipmentType,attachments:[],metrics:[],children:[]};
const paginated=(items,page=1,limit=100,total=items.length)=>({items,pagination:{page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit))}});
let current;
async function page(role='OWNER'){
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map(),calls=[];let rows=[{...initial}],failGet=false,failPatch=false,failDelete=false;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',async event=>{
    const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown') console.error('Browser exception:',JSON.stringify(m.params.exceptionDetails));
    if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params,url=new URL(request.url),path=url.pathname.replace('/api/v1',''),method=request.method;
    const headers=[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'Authorization, Content-Type, X-Request-Id'},{name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,DELETE,OPTIONS'}];
    if(method==='OPTIONS'){await send('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:headers});return;}
    const payload=request.postData?JSON.parse(request.postData):null;calls.push({path,method,payload,query:url.search});let result=paginated([]),status=200;
    if(path==='/users/me')result={user:{id:'user-'+role,name:'Usuário '+role,email:'user@example.test',role,isActive:true,mustChangePassword:false},role,permissions:{canReports:true,canSchedules:true,canUsers:true},organization:{id:'org-1',legalName:'Empresa de teste',tradeName:'Empresa de teste',primaryColor:'#2563eb',secondaryColor:'#123456'}};
    else if(path==='/customer-portal/accounts')result=[];
    else if(path==='/customers/'+customer.id)result=customer;
    else if(path==='/customers')result=paginated([{...customer,id:'other-customer',name:'Outro cliente'}]);
    else if(path==='/technical-catalogs')result=paginated([equipmentType]);
    else if(path==='/operations/stats')result={total:0,byStatus:{},byType:{}};
    else if(path==='/equipments'&&method==='POST'){const item={...initial,...payload,id:'equipment-new',name:[payload.manufacturer,payload.model].filter(Boolean).join(' ')};rows.push(item);result=item;status=201;}
    else if(path==='/equipments'){const p=Number(url.searchParams.get('page')??1),l=Number(url.searchParams.get('limit')??20);const activity=url.searchParams.get('activity')??'ACTIVE',filtered=rows.filter(item=>activity==='ALL'||(activity==='INACTIVE'?(!item.isActive||item.deletedAt):(item.isActive&&!item.deletedAt)));result=paginated(filtered.slice((p-1)*l,p*l),p,l,filtered.length);}
    else if(path.startsWith('/equipments/')){
      const id=path.split('/')[2],index=rows.findIndex(item=>item.id===id);
      if((method==='GET'&&failGet)||(method==='PATCH'&&failPatch)||(method==='DELETE'&&failDelete)){status=500;result='Falha simulada de '+method;}
      else if(method==='DELETE'){rows[index]={...rows[index],isActive:false,status:'INACTIVE',deletedAt:new Date().toISOString()};result={deleted:true};}
      else if(method==='PATCH'&&path.endsWith('/enable')){rows[index]={...rows[index],isActive:true,status:'ACTIVE',deletedAt:null};result=rows[index];}
      else if(path.endsWith('/lifecycle')){result=paginated([]);}
      else if(method==='PATCH'){rows[index]={...rows[index],...payload,name:[payload.manufacturer,payload.model].filter(Boolean).join(' ')};result=rows[index];}
      else result=rows[index];
    }
    await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:headers,body:Buffer.from(JSON.stringify(status<400?{success:true,data:result}:{success:false,error:{code:'TEST_ERROR',message:result}})).toString('base64')}).catch(error=>{if(!error.message.includes('Invalid InterceptionId'))throw error;});
  });
  await send('Page.enable');await send('Network.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Fetch.enable',{patterns:[{urlPattern:'*api/v1/*',requestStage:'Request'}]});
  const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('erp.platform.accessToken',${JSON.stringify(token)});localStorage.setItem('erp.platform.refreshToken','synthetic');`});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const text=()=>evaluate('document.body.innerText');
  const waitText=label=>until(async()=>(await text()).includes(label),label);
  const navigate=async()=>{const marker=Math.random().toString(36);await evaluate(`window.__marker=${JSON.stringify(marker)}`);await send('Page.navigate',{url:base+'/clientes/'+customer.id});if(role==='VIEWER'){await until(()=>evaluate(`location.pathname.startsWith('/operator')`),'viewer denied platform');return;}await until(()=>evaluate(`window.__marker!==${JSON.stringify(marker)}&&document.readyState==='complete'&&location.pathname==='/clientes/${customer.id}'`),'navigation');await waitText(customer.name);};
  const click=label=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)}||el.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button missing/disabled: '+${JSON.stringify(label)});b.click();})()`);
  const input=(label,value)=>evaluate(`(()=>{const parent=Array.from(document.querySelectorAll('label')).find(el=>el.querySelector('span')?.textContent.trim().replace(/\\s*\\*$/,'')===${JSON.stringify(label)});const el=parent?.querySelector('input,textarea,select');if(!el)throw Error('Input missing: '+${JSON.stringify(label)});const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  return {send,evaluate,text,waitText,navigate,click,input,calls,fail:(get,patch,del)=>{failGet=get;failPatch=patch;failDelete=del;},seed:count=>{rows=Array.from({length:count},(_,i)=>({...initial,id:'equipment-'+i,name:'Equipamento '+i}));},seedInactive:()=>{rows=[{...initial,isActive:false,status:'INACTIVE',deletedAt:'2026-11-01T10:00:00Z'}];}};
}
try{
  await until(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'Chrome');
  const p=await page();current=p;await p.navigate();await p.click('Equipamentos');await p.waitText('Marca Modelo');
  p.fail(true,false,false);await p.click('Editar');await p.waitText('Falha simulada de GET');
  p.fail(false,false,false);await p.click('Editar');await p.waitText('Salvar alterações');await until(()=>p.evaluate(`document.querySelector('button[aria-label="Cliente"]:disabled')?.textContent.includes('Cliente atual')`),'selected customer outside first page');
  assert.equal(await p.evaluate(`location.pathname`),'/clientes/'+customer.id);
  await p.input('Fabricante','Marca editada');await p.input('Modelo','Modelo B');await p.input('Capacidade','18000 BTU');
  p.fail(false,true,false);await p.click('Salvar alterações');await p.waitText('Falha simulada de PATCH');
  p.fail(false,false,false);await p.click('Salvar alterações');await p.waitText('Marca editada Modelo B');await until(()=>p.evaluate(`!document.querySelector('[role="dialog"]')`),'drawer closed');
  const patch=p.calls.filter(c=>c.method==='PATCH').at(-1);assert.equal(patch.path,'/equipments/equipment-1');assert.equal(patch.payload.customerId,customer.id);assert.equal(patch.payload.capacity,'18000 BTU');
  await p.click('Desativar');await p.waitText('Desativar equipamento?');await p.click('Cancelar');assert.equal(p.calls.filter(c=>c.method==='DELETE').length,0);
  await p.click('Desativar');p.fail(false,false,true);await p.click('Desativar equipamento');await p.waitText('Falha simulada de DELETE');assert.equal(await p.evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`),true);
  p.fail(false,false,false);await p.click('Desativar equipamento');await p.waitText('Nenhum equipamento');await p.navigate();await p.click('Equipamentos');await p.waitText('Nenhum equipamento');
  console.log('Edit, archive, error handling and hidden-by-default persistence passed.');
  const filter=async value=>p.evaluate(`(()=>{const el=document.querySelector('select[aria-label="Situação dos equipamentos"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await filter('INACTIVE');await p.waitText('Marca editada Modelo B');await p.waitText('Reativar');
  await p.click('Ver detalhes');await p.waitText('Visão geral');await p.click('QR');await p.waitText('QR do equipamento');
  assert.equal(await p.evaluate(`Boolean(document.querySelector('svg[aria-label="QR do equipamento ${initial.qrCode}"]'))`),true);
  await p.click('Histórico');await p.waitText('Histórico oficial do Asset Lifecycle');await p.click('Fechar');
  assert.ok(p.calls.some(c=>c.path==='/equipments/equipment-1/lifecycle'));
  await p.click('Reativar');p.fail(false,true,false);await p.click('Reativar equipamento');await p.waitText('Falha simulada de PATCH');
  p.fail(false,false,false);await p.click('Reativar equipamento');await p.waitText('Nenhum equipamento');
  await filter('ACTIVE');await p.waitText('Marca editada Modelo B');await p.click('Ver detalhes');await p.waitText('Visão geral');await p.click('QR');await p.waitText('QR do equipamento');
  assert.equal(await p.evaluate(`Boolean(document.querySelector('svg[aria-label="QR do equipamento ${initial.qrCode}"]'))`),true);await p.click('Fechar');
  await p.click('Desativar');await p.click('Desativar equipamento');await p.waitText('Nenhum equipamento');
  console.log('Inactive filter, preserved QR/history, restore failure/retry, reactivation and stable identity passed.');
  await p.click('Novo equipamento');await p.waitText('Criar equipamento');await until(()=>p.evaluate(`document.querySelector('button[aria-label="Cliente"]:disabled')?.textContent.includes('Cliente atual')`),'preset customer');await until(()=>p.evaluate(`!!document.querySelector('option[value="${equipmentType.id}"]')`),'equipment catalog');
  await p.input('Fabricante','Nova marca');await p.input('Modelo','Novo modelo');await p.click('Criar equipamento');await p.waitText('Nova marca Novo modelo');
  assert.equal(p.calls.find(c=>c.method==='POST'&&c.path==='/equipments').payload.customerId,customer.id);
  console.log('Create from the customer tab passed.');
  p.seed(21);await p.navigate();await p.click('Equipamentos');await p.waitText('Equipamento 0');await p.click('Próxima página');await p.waitText('Equipamento 20');await p.click('Desativar');await p.click('Desativar equipamento');await p.waitText('Equipamento 0');assert.ok((await p.text()).includes('página 1 de 1'));
  console.log('Archiving the last equipment on the last page returns to the previous page.');
  for(const role of ['MANAGER','VIEWER']){
    const other=await page(role);current=other;await other.navigate();if(role==='VIEWER'){assert.ok(!(await other.text()).includes('Equipamentos do cliente'));continue;}await other.click('Equipamentos');await other.waitText('Marca Modelo');
    assert.equal(await other.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Desativar')`),false);
    assert.equal(await other.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Editar')`),role==='MANAGER');
    assert.equal(await other.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Novo equipamento')`),role==='MANAGER');
    assert.equal(await other.evaluate(`Boolean(document.querySelector('select[aria-label="Situação dos equipamentos"]'))`),true);
    other.seedInactive();await other.navigate();await other.click('Equipamentos');await other.waitText('Nenhum equipamento');
    await other.evaluate(`(()=>{const el=document.querySelector('select[aria-label="Situação dos equipamentos"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'INACTIVE');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await other.waitText('Reativar');await other.click('Reativar');await other.click('Reativar equipamento');await other.waitText('Nenhum equipamento');
    assert.ok(other.calls.some(c=>c.method==='PATCH'&&c.path==='/equipments/equipment-1/enable'));
  }
  console.log('Manager and viewer UI permissions passed.');
}catch(error){if(current)console.error(await current.text().catch(()=>''));throw error;}
finally{for(const ws of sockets)ws.close();chrome.kill();}
