const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const scope='https://example.test/mughal-interior-accounts/';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function workerHarness(){
  const events={},stores=new Map(),calls=[];let networkFails=false,networkStatus=200,claimed=0,skipped=0;
  const key=value=>typeof value==='string'?value:value.url;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{
    async addAll(requests){for(const request of requests){calls.push(['precache',request.url,request.cache]);data.set(request.url,new Response(request.url.endsWith('.html')?'offline fallback':'icon'));}},
    async match(request){return data.get(key(request))?.clone();}
  };},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
  const self={registration:{scope},addEventListener(name,fn){events[name]=fn;},clients:{async claim(){claimed++;}},async skipWaiting(){skipped++;}};
  const ctx={self,caches,URL,Request,Response,Set,fetch:async(request,options)=>{calls.push(['fetch',key(request),options]);if(networkFails)throw Error('offline');return new Response('network',{status:networkStatus});}};
  vm.runInNewContext(read('sw.js'),ctx);
  async function dispatch(name,props={}){const pending=[];let response;events[name]({...props,waitUntil(p){pending.push(p);},respondWith(p){response=p;}});await Promise.all(pending);return response?await response:undefined;}
  const request=(url,options={})=>({url:new URL(url,scope).href,method:'GET',mode:'navigate',headers:new Headers(),...options});
  return{dispatch,request,stores,calls,setOffline(value){networkFails=value;},setStatus(value){networkStatus=value;},get claimed(){return claimed;},get skipped(){return skipped;}};
}

test('manifest and Apple metadata use repository-relative URLs and correctly sized icons',()=>{
  const manifest=JSON.parse(read('manifest.webmanifest')),dom=new JSDOM(read('index.html')),d=dom.window.document;
  assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
  assert.equal(d.querySelector('link[rel="manifest"]').getAttribute('href'),'manifest.webmanifest');
  assert.equal(d.querySelector('meta[name="apple-mobile-web-app-capable"]').content,'yes');
  for(const icon of [...manifest.icons,{src:d.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'),sizes:'180x180'}]){
    const bytes=fs.readFileSync(path.join(root,icon.src));assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes);
    assert.ok(new URL(icon.src,scope).href.startsWith(scope));
  }
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
  dom.window.close();
});

test('worker caches only the reconnect page/icon and never forces activation during installation',async()=>{
  const h=workerHarness();await h.dispatch('install');assert.equal(h.skipped,0);
  assert.deepEqual(h.calls.map(call=>call.slice(0,2)),[['precache',scope+'offline.html'],['precache',scope+'assets/pwa/icon-192.png']]);
  assert.ok(h.calls.every(call=>call[2]==='reload'));
  const current=[...h.stores.keys()][0];h.stores.set(current.replace('v1','old'),new Map());h.stores.set('other-app-cache',new Map());
  await h.dispatch('activate');assert.equal(h.claimed,1);assert.equal(h.stores.has('other-app-cache'),true);assert.equal(h.stores.size,2);
  await h.dispatch('message',{data:{type:'UNKNOWN'}});assert.equal(h.skipped,0);
  await h.dispatch('message',{data:{type:'SKIP_WAITING'}});assert.equal(h.skipped,1);
});

test('navigation is online-first without writing app HTML into cache, with a branded offline fallback',async()=>{
  const h=workerHarness();await h.dispatch('install');
  for(const url of ['./','index.html?source=homescreen']){
    const response=await h.dispatch('fetch',{request:h.request(url)});assert.equal(await response.text(),'network');
  }
  assert.equal(h.calls.at(-1)[2].cache,'no-store');
  assert.equal([...h.stores.values()][0].size,2);
  h.setOffline(true);
  const fallback=await h.dispatch('fetch',{request:h.request('./')});assert.equal(await fallback.text(),'offline fallback');
  const icon=await h.dispatch('fetch',{request:h.request('assets/pwa/icon-192.png',{mode:'no-cors'})});assert.equal(await icon.text(),'icon');
  h.stores.clear();const emergency=await h.dispatch('fetch',{request:h.request('./')});assert.equal(emergency.status,503);
  assert.match(read('offline.html'),/Transactions are not queued offline/);
});

test('worker ignores auth, accounting data, writes, scripts and other sites/apps',async()=>{
  const h=workerHarness();await h.dispatch('install');h.calls.length=0;
  for(const request of [
    h.request('./',{method:'POST'}),h.request('./',{headers:new Headers({Authorization:'Bearer test'})}),
    h.request('https://project.supabase.co/rest/v1/payments',{mode:'cors'}),
    h.request('https://project.supabase.co/auth/v1/token',{method:'POST',mode:'cors'}),
    h.request('config.js',{mode:'no-cors'}),h.request('app-mobile.js?v=13',{mode:'no-cors'}),
    h.request('rest/v1/payments'),h.request('../another-app/'),h.request('https://example.test/'),
    h.request('https://cdn.example.test/library.js',{mode:'no-cors'})
  ])assert.equal(await h.dispatch('fetch',{request}),undefined,request.url);
  assert.equal(h.calls.length,0);
  h.setStatus(401);const response=await h.dispatch('fetch',{request:h.request('./')});assert.equal(response.status,401);
});

async function pageHarness(t,{ios=false,installed=false,supported=true,waiting=false,failRegistration=false,installing=false}={}){
  const dom=new JSDOM(read('index.html'),{url:scope,runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
  const events={},regEvents={},workerEvents={},messages=[],registerCalls=[];let updateCalls=0;
  w.matchMedia=()=>({matches:installed,addEventListener(){}});
  Object.defineProperty(w,'isSecureContext',{value:true});
  Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
  if(ios)Object.defineProperty(w.navigator,'userAgent',{value:'iPhone'});
  const worker={state:'installing',addEventListener(name,fn){workerEvents[name]=fn;}};
  const waitingWorker={postMessage(message){messages.push(message);}};
  const registration={waiting:waiting?waitingWorker:null,installing:installing?worker:null,addEventListener(name,fn){regEvents[name]=fn;},async update(){updateCalls++;}};
  if(supported)Object.defineProperty(w.navigator,'serviceWorker',{value:{controller:{},async register(url,options){registerCalls.push([String(url),options]);if(failRegistration)throw Error('blocked');return registration;},addEventListener(name,fn){events[name]=fn;}}});
  w.confirm=()=>false;w.testReloads=0;w.toast=message=>{w.lastToast=message;};
  const style=d.createElement('style');style.textContent=read('mobile.css')+read('pwa.css');d.head.append(style);
  w.eval(read('pwa.js').replace('window.location.reload()','window.testReloads++'));
  await flush();
  return{w,d,events,regEvents,workerEvents,worker,waitingWorker,registration,messages,registerCalls,get updateCalls(){return updateCalls;}};
}

test('registration uses the Pages subdirectory and installation requires an explicit user click',async t=>{
  const h=await pageHarness(t),buttons=[...h.d.querySelectorAll('[data-pwa-install]')];
  assert.equal(h.registerCalls.length,1);assert.equal(h.registerCalls[0][0],scope+'sw.js');assert.equal(h.registerCalls[0][1].scope,scope);assert.equal(h.registerCalls[0][1].updateViaCache,'none');
  assert.ok(buttons.every(button=>button.hidden));let prompted=0;
  const event=new h.w.Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{prompted++;};event.userChoice=Promise.resolve({outcome:'accepted'});
  h.w.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.ok(buttons.every(button=>!button.hidden));assert.equal(prompted,0);
  buttons[0].click();buttons[0].click();await flush();assert.equal(prompted,1);assert.ok(buttons.every(button=>button.hidden));
  h.w.dispatchEvent(new h.w.Event('appinstalled'));assert.equal(h.d.querySelector('#pwaToolbar').hidden,true);
});

test('iOS install instructions are available while standalone apps hide the install action',async t=>{
  const ios=await pageHarness(t,{ios:true}),button=ios.d.querySelector('[data-pwa-install]');assert.equal(button.hidden,false);
  button.click();assert.equal(ios.d.querySelector('#pwaInstallHelp').hasAttribute('open'),true);
  assert.match(ios.d.querySelector('#pwaInstallHelp').textContent,/Safari.*Share.*Add to Home Screen/s);
  ios.d.querySelector('[data-pwa-close]').click();assert.equal(ios.d.querySelector('#pwaInstallHelp').hasAttribute('open'),false);
  const installed=await pageHarness(t,{ios:true,installed:true});assert.ok([...installed.d.querySelectorAll('[data-pwa-install]')].every(button=>button.hidden));
});

test('updates cannot interrupt saving and reload only after confirmation in this window',async t=>{
  const h=await pageHarness(t,{waiting:true}),button=h.d.querySelector('#pwaUpdateBtn');assert.equal(button.hidden,false);
  h.events.controllerchange();assert.equal(h.w.testReloads,0);
  button.click();assert.equal(h.messages.length,0);
  h.w.confirm=()=>true;h.d.querySelector('#processing').classList.remove('hidden');button.click();assert.equal(h.messages.length,0);assert.match(h.w.lastToast,/current action/);
  h.d.querySelector('#processing').classList.add('hidden');button.click();assert.equal(h.messages.length,1);assert.equal(h.messages[0].type,'SKIP_WAITING');assert.equal(button.disabled,true);
  h.events.controllerchange();h.events.controllerchange();assert.equal(h.w.testReloads,1);
});

test('existing installing workers reveal updates, connectivity notice updates, and theme follows the header',async t=>{
  const h=await pageHarness(t,{installing:true});assert.equal(h.d.querySelector('#pwaUpdateBtn').hidden,true);
  h.registration.waiting=h.waitingWorker;h.worker.state='installed';h.workerEvents.statechange();assert.equal(h.d.querySelector('#pwaUpdateBtn').hidden,false);
  Object.defineProperty(h.w.navigator,'onLine',{value:false,configurable:true});h.w.dispatchEvent(new h.w.Event('offline'));assert.equal(h.d.querySelector('#pwaOfflineNotice').hidden,false);
  Object.defineProperty(h.w.navigator,'onLine',{value:true,configurable:true});h.w.dispatchEvent(new h.w.Event('online'));assert.equal(h.d.querySelector('#pwaOfflineNotice').hidden,true);
  h.d.querySelector('.topbar').setAttribute('data-screen','orders');await flush();assert.equal(h.d.querySelector('meta[name="theme-color"]').content,'#285a86');
});

test('unsupported or blocked service workers do not break the existing online page',async t=>{
  const unsupported=await pageHarness(t,{supported:false});assert.equal(unsupported.registerCalls.length,0);assert.ok(unsupported.d.querySelector('#loginForm'));
  const blocked=await pageHarness(t,{failRegistration:true});assert.equal(blocked.registerCalls.length,1);assert.equal(blocked.d.querySelector('#pwaUpdateBtn').hidden,true);
});
