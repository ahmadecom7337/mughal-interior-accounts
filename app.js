const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const cfg = window.MUGHAL_CONFIG || {};
const isCloud = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
const state = { parties: [], quotes: [], businessId: null, userId: null, token: null, step: 1, activeQuote: null };
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;
const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const prettyDate = (v) => v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) : 'Not set';

const demo = {
  parties: [
    {id:'p1',name:'Ali Residence',phone:'0300 1234567',party_type:'Individual',address:'DHA Phase 6, Lahore',notes:''},
    {id:'p2',name:'Hassan Traders',phone:'0321 8877665',party_type:'Business',address:'Gulberg, Lahore',notes:'Shop renovation'}
  ],
  quotes: [
    {id:'q1',quote_number:'MIQ-2026-0001',party_id:'p1',project_title:'Complete residence woodwork',project_details:'Kitchen cabinets, wardrobes for three bedrooms, TV wall and entrance console.',quote_date:today(),valid_until:plusDays(15),start_date:plusDays(20),end_date:plusDays(65),pricing_mode:'with_material',price_with_material:1250000,price_without_material:null,payment_terms:'40% advance, 40% during work and 20% on completion.',notes:'Hardware by approved brands.',status:'Sent',created_at:new Date().toISOString()},
    {id:'q2',quote_number:'MIQ-2026-0002',party_id:'p2',project_title:'Shop counter and display units',project_details:'Front counter, wall shelving and two lockable display units.',quote_date:today(),valid_until:plusDays(10),start_date:'',end_date:'',pricing_mode:'both',price_with_material:420000,price_without_material:165000,payment_terms:'50% advance; balance before handover.',notes:'Electrical work excluded.',status:'Draft',created_at:new Date(Date.now()-3600000).toISOString()}
  ]
};

class Store {
  constructor(){ this.base = (cfg.supabaseUrl || '').replace(/\/$/,''); this.key = cfg.supabasePublishableKey || ''; }
  headers(extra={}) { return {'apikey':this.key,'Authorization':`Bearer ${state.token}`,'Content-Type':'application/json',...extra}; }
  async request(path, options={}) { const r=await fetch(`${this.base}${path}`,{...options,headers:this.headers(options.headers)}); if(r.status===401){ logout(false); throw new Error('Your session expired. Please sign in again.'); } if(!r.ok){ const e=await r.text(); throw new Error(e || 'Could not save the record.'); } return r.status===204 ? null : r.json(); }
  async signIn(email,password){ const r=await fetch(`${this.base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:this.key,'Content-Type':'application/json'},body:JSON.stringify({email,password})}); const data=await r.json(); if(!r.ok) throw new Error(data.error_description || data.msg || 'Email or password is incorrect.'); state.token=data.access_token; state.userId=data.user.id; localStorage.setItem('mi_session',JSON.stringify({token:state.token,userId:state.userId})); }
  async load(){
    if(!isCloud){ state.parties=JSON.parse(localStorage.getItem('mi_parties')||'null')||demo.parties; state.quotes=JSON.parse(localStorage.getItem('mi_quotes')||'null')||demo.quotes; return; }
    const membership=await this.request(`/rest/v1/business_members?select=business_id&user_id=eq.${state.userId}&limit=1`);
    if(!membership.length) throw new Error('This account has not been added to a business yet.');
    state.businessId=membership[0].business_id;
    [state.parties,state.quotes]=await Promise.all([
      this.request(`/rest/v1/parties?select=*&business_id=eq.${state.businessId}&order=name.asc`),
      this.request(`/rest/v1/quotations?select=*&business_id=eq.${state.businessId}&order=created_at.desc`)
    ]);
  }
  async saveParty(row){
    if(!isCloud){ const i=state.parties.findIndex(x=>x.id===row.id); i>=0?state.parties[i]=row:state.parties.push(row); localStorage.setItem('mi_parties',JSON.stringify(state.parties)); return row; }
    row.business_id=state.businessId; const updating=state.parties.some(x=>x.id===row.id); const path=updating?`/rest/v1/parties?id=eq.${row.id}`:'/rest/v1/parties'; const data=await this.request(path,{method:updating?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)}); return data[0];
  }
  async saveQuote(row){
    if(!isCloud){ const i=state.quotes.findIndex(x=>x.id===row.id); i>=0?state.quotes[i]=row:state.quotes.unshift(row); localStorage.setItem('mi_quotes',JSON.stringify(state.quotes)); return row; }
    row.business_id=state.businessId; const updating=state.quotes.some(x=>x.id===row.id); const path=updating?`/rest/v1/quotations?id=eq.${row.id}`:'/rest/v1/quotations'; const data=await this.request(path,{method:updating?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)}); return data[0];
  }
}
const store = new Store();

function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add('hidden'),2500); }
function openSheet(id){ $('#sheetBackdrop').classList.remove('hidden'); $(id).classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeSheets(){ $('#sheetBackdrop').classList.add('hidden'); $$('.sheet').forEach(x=>x.classList.add('hidden')); document.body.style.overflow=''; }
function partyName(id){ return state.parties.find(p=>p.id===id)?.name || 'Unknown party'; }
function quoteAmount(q){ return q.pricing_mode==='without_material'?q.price_without_material:q.price_with_material; }
function statusClass(s){ return String(s||'draft').toLowerCase(); }

function quoteCard(q){ return `<article class="item-card"><div><h3>${esc(q.project_title)}</h3><div class="meta"><span>${esc(q.quote_number)}</span><span>${esc(partyName(q.party_id))}</span><span>${prettyDate(q.quote_date)}</span></div></div><div class="item-actions"><div><div class="amount">${money(quoteAmount(q))}</div><span class="status ${statusClass(q.status)}">${esc(q.status)}</span></div><button class="mini-btn" data-view-quote="${q.id}">View</button></div></article>`; }
function render(){
  $('#partyCount').textContent=state.parties.length;
  $('#openCount').textContent=state.quotes.filter(q=>['Draft','Sent'].includes(q.status)).length;
  $('#approvedValue').textContent=money(state.quotes.filter(q=>q.status==='Approved').reduce((a,q)=>a+Number(quoteAmount(q)||0),0));
  const recent=[...state.quotes].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,3);
  $('#recentQuotes').innerHTML=recent.length?recent.map(quoteCard).join(''):`<div class="empty"><b>No quotations yet</b><span>Create the first contract quotation.</span></div>`;
  renderParties(); renderQuotes(); fillPartySelect();
}
function renderParties(){
  const q=$('#partySearch').value.toLowerCase(); const rows=state.parties.filter(p=>[p.name,p.phone,p.address].join(' ').toLowerCase().includes(q));
  $('#partyList').innerHTML=rows.length?rows.map(p=>`<article class="item-card"><div><h3>${esc(p.name)}</h3><div class="meta"><span>${esc(p.party_type)}</span>${p.phone?`<span>${esc(p.phone)}</span>`:''}${p.address?`<span>${esc(p.address)}</span>`:''}</div></div><div class="item-actions"><button class="mini-btn" data-edit-party="${p.id}">Edit</button><button class="btn soft" data-party-quote="${p.id}">New quote</button></div></article>`).join(''):`<div class="empty"><b>No parties found</b><span>Add a customer to begin.</span></div>`;
}
function renderQuotes(){
  const text=$('#quoteSearch').value.toLowerCase(), status=$('#statusFilter').value; const rows=state.quotes.filter(q=>(status==='all'||q.status===status)&&[q.quote_number,q.project_title,partyName(q.party_id)].join(' ').toLowerCase().includes(text));
  $('#quoteList').innerHTML=rows.length?rows.map(quoteCard).join(''):`<div class="empty"><b>No matching quotations</b><span>Change the filter or create a quotation.</span></div>`;
}
function fillPartySelect(selected=''){ const el=$('#quoteParty'); el.innerHTML=`<option value="">Select a party</option>`+state.parties.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join(''); }
function navigate(name){ $$('.view').forEach(v=>v.classList.remove('active')); $(`#${name}View`).classList.add('active'); $$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name)); scrollTo(0,0); }

function openParty(id=''){
  const p=state.parties.find(x=>x.id===id); $('#partyForm').reset(); $('#partyId').value=p?.id||''; $('#partyName').value=p?.name||''; $('#partyPhone').value=p?.phone||''; $('#partyType').value=p?.party_type||'Individual'; $('#partyAddress').value=p?.address||''; $('#partyNotes').value=p?.notes||''; $('#partySheetTitle').textContent=p?'Edit party':'Add party'; openSheet('#partySheet'); setTimeout(()=>$('#partyName').focus(),100);
}
function setStep(n){ state.step=n; $$('.step-panel').forEach(x=>x.classList.toggle('active',Number(x.dataset.step)===n)); $$('#quoteSteps button').forEach((b,i)=>b.classList.toggle('active',i+1<=n)); $('#quoteBack').classList.toggle('hidden',n===1); $('#quoteNext').classList.toggle('hidden',n===3); $('#quoteSave').classList.toggle('hidden',n!==3); if(n===3) renderReview(); }
function updatePriceVisibility(){ const mode=$('input[name="pricingMode"]:checked').value; $('#withMaterialWrap').classList.toggle('hidden',mode==='without_material'); $('#withoutMaterialWrap').classList.toggle('hidden',mode==='with_material'); $$('.choice').forEach(c=>c.classList.toggle('selected',$('input',c).checked)); }
function openQuote(id='',partyId=''){
  if(!state.parties.length){ toast('Add a party before creating a quotation.'); openParty(); return; }
  const q=state.quotes.find(x=>x.id===id); $('#quoteForm').reset(); $('#quoteId').value=q?.id||''; fillPartySelect(q?.party_id||partyId); $('#projectTitle').value=q?.project_title||''; $('#projectDetails').value=q?.project_details||''; $('#quoteDate').value=q?.quote_date||today(); $('#validUntil').value=q?.valid_until||plusDays(15); $('#startDate').value=q?.start_date||''; $('#endDate').value=q?.end_date||''; const mode=q?.pricing_mode||'with_material'; $(`input[name="pricingMode"][value="${mode}"]`).checked=true; $('#priceWithMaterial').value=q?.price_with_material||''; $('#priceWithoutMaterial').value=q?.price_without_material||''; $('#paymentTerms').value=q?.payment_terms||''; $('#quoteNotes').value=q?.notes||''; $('#quoteSheetTitle').textContent=q?'Edit quotation':'New quotation'; updatePriceVisibility(); setStep(1); closeSheets(); openSheet('#quoteSheet');
}
function quoteFromForm(){
  const existing=state.quotes.find(x=>x.id===$('#quoteId').value), mode=$('input[name="pricingMode"]:checked').value;
  return {id:existing?.id||(crypto.randomUUID?.()||`q${Date.now()}`),quote_number:existing?.quote_number||`MIQ-${new Date().getFullYear()}-${String(state.quotes.length+1).padStart(4,'0')}`,party_id:$('#quoteParty').value,project_title:$('#projectTitle').value.trim(),project_details:$('#projectDetails').value.trim(),quote_date:$('#quoteDate').value,valid_until:$('#validUntil').value||null,start_date:$('#startDate').value||null,end_date:$('#endDate').value||null,pricing_mode:mode,price_with_material:mode==='without_material'?null:Number($('#priceWithMaterial').value||0),price_without_material:mode==='with_material'?null:Number($('#priceWithoutMaterial').value||0),payment_terms:$('#paymentTerms').value.trim(),notes:$('#quoteNotes').value.trim(),status:existing?.status||'Draft',created_at:existing?.created_at||new Date().toISOString()};
}
function validStep(){ if(state.step===1){ for(const id of ['quoteParty','projectTitle','projectDetails','quoteDate']){ if(!$(`#${id}`).value){ $(`#${id}`).reportValidity(); return false; } } } if(state.step===2){ const mode=$('input[name="pricingMode"]:checked').value; if((mode==='with_material'||mode==='both')&&!Number($('#priceWithMaterial').value)){ toast('Enter the price with material.'); return false; } if((mode==='without_material'||mode==='both')&&!Number($('#priceWithoutMaterial').value)){ toast('Enter the price without material.'); return false; } } return true; }
function renderReview(){ const q=quoteFromForm(); const prices=q.pricing_mode==='both'?`${money(q.price_with_material)} with material<br>${money(q.price_without_material)} labour only`:money(quoteAmount(q)); $('#quoteReview').innerHTML=`<div class="review-row"><span>Party</span><b>${esc(partyName(q.party_id))}</b></div><div class="review-row"><span>Project</span><b>${esc(q.project_title)}</b></div><div class="review-row"><span>Quotation date</span><b>${prettyDate(q.quote_date)}</b></div><div class="review-row"><span>Expected timeline</span><b>${prettyDate(q.start_date)} — ${prettyDate(q.end_date)}</b></div><div class="review-row"><span>Quoted price</span><b>${prices}</b></div><div class="review-row"><span>Payment terms</span><b>${esc(q.payment_terms||'Not specified')}</b></div>`; }
function documentHtml(q){
  const p=state.parties.find(x=>x.id===q.party_id)||{}; const price=q.pricing_mode==='both'?`<div><small>WITH MATERIAL</small><b>${money(q.price_with_material)}</b></div><div><small>LABOUR ONLY</small><b>${money(q.price_without_material)}</b></div>`:`<div><small>${q.pricing_mode==='with_material'?'WITH MATERIAL':'LABOUR ONLY'}</small><b>${money(quoteAmount(q))}</b></div>`;
  return `<div class="doc-head"><div class="doc-brand"><h2>Mughal Interior</h2><p>Crafted woodwork for homes and businesses</p></div><div class="doc-meta"><b>${esc(q.quote_number)}</b><p>Date: ${prettyDate(q.quote_date)}</p><p>Valid until: ${prettyDate(q.valid_until)}</p></div></div><div class="doc-title"><p class="eyebrow">CONTRACT QUOTATION</p><h1>${esc(q.project_title)}</h1></div><div class="doc-grid"><div class="doc-box"><small>PREPARED FOR</small><b>${esc(p.name||'')}</b><div>${esc(p.phone||'')}</div><div>${esc(p.address||'')}</div></div><div class="doc-box"><small>EXPECTED SCHEDULE</small><b>${prettyDate(q.start_date)}</b><div>to ${prettyDate(q.end_date)}</div></div></div><h3>Project scope</h3><div class="doc-details">${esc(q.project_details)}</div><div class="price-box">${price}</div><div class="doc-terms"><h3>Payment terms</h3><p>${esc(q.payment_terms||'Not specified')}</p>${q.notes?`<h3>Terms and notes</h3><p>${esc(q.notes)}</p>`:''}</div>`;
}
function viewQuote(id){ const q=state.quotes.find(x=>x.id===id); if(!q)return; state.activeQuote=q; $('#quoteDocument').innerHTML=documentHtml(q); $('#statusQuoteBtn').textContent=q.status==='Draft'?'Mark as sent':q.status==='Sent'?'Approve quotation':q.status==='Approved'?'Approved':'Return to draft'; $('#statusQuoteBtn').disabled=false; openSheet('#detailSheet'); }

async function boot(){
  if(isCloud){ const session=JSON.parse(localStorage.getItem('mi_session')||'null'); if(!session){ $('#loginScreen').classList.remove('hidden'); return; } state.token=session.token; state.userId=session.userId; }
  try{ await store.load(); $('#loginScreen').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); if(!isCloud) toast('Demo mode — connect Supabase to save online.'); }catch(e){ $('#loginScreen').classList.remove('hidden'); $('#loginError').textContent=e.message; $('#loginError').classList.remove('hidden'); }
}
function logout(show=true){ localStorage.removeItem('mi_session'); state.token=null; state.userId=null; $('#app').classList.add('hidden'); $('#loginScreen').classList.remove('hidden'); if(show) toast('Signed out.'); }

document.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-nav]'); if(nav) navigate(nav.dataset.nav);
  const action=e.target.closest('[data-action]')?.dataset.action; if(action==='new-party')openParty(); if(action==='new-quote')openQuote(); if(action==='more')toast('Inventory, labour and expenses will be added after this module is approved.');
  if(e.target.closest('[data-close]')||e.target.id==='sheetBackdrop')closeSheets();
  const ep=e.target.closest('[data-edit-party]'); if(ep)openParty(ep.dataset.editParty); const pq=e.target.closest('[data-party-quote]'); if(pq)openQuote('',pq.dataset.partyQuote); const vq=e.target.closest('[data-view-quote]'); if(vq)viewQuote(vq.dataset.viewQuote);
});
$('#partySearch').addEventListener('input',renderParties); $('#quoteSearch').addEventListener('input',renderQuotes); $('#statusFilter').addEventListener('change',renderQuotes); $$('input[name="pricingMode"]').forEach(x=>x.addEventListener('change',updatePriceVisibility));
$('#partyForm').addEventListener('submit',async e=>{ e.preventDefault(); const existing=state.parties.find(x=>x.id===$('#partyId').value); const row={id:existing?.id||(crypto.randomUUID?.()||`p${Date.now()}`),name:$('#partyName').value.trim(),phone:$('#partyPhone').value.trim(),party_type:$('#partyType').value,address:$('#partyAddress').value.trim(),notes:$('#partyNotes').value.trim()}; try{const saved=await store.saveParty(row); const i=state.parties.findIndex(x=>x.id===saved.id); i>=0?state.parties[i]=saved:state.parties.push(saved); closeSheets();render();toast(existing?'Party updated.':'Party added.');}catch(err){toast(err.message)} });
$('#quoteNext').addEventListener('click',()=>{if(validStep())setStep(state.step+1)}); $('#quoteBack').addEventListener('click',()=>setStep(state.step-1));
$('#quoteForm').addEventListener('submit',async e=>{ e.preventDefault(); const row=quoteFromForm(), existing=state.quotes.some(x=>x.id===row.id); try{const saved=await store.saveQuote(row); const i=state.quotes.findIndex(x=>x.id===saved.id); i>=0?state.quotes[i]=saved:state.quotes.unshift(saved); closeSheets();render();toast(existing?'Quotation updated.':'Quotation saved as draft.');viewQuote(saved.id);}catch(err){toast(err.message)} });
$('#editQuoteBtn').addEventListener('click',()=>openQuote(state.activeQuote?.id));
$('#statusQuoteBtn').addEventListener('click',async()=>{ if(!state.activeQuote)return; const next=state.activeQuote.status==='Draft'?'Sent':state.activeQuote.status==='Sent'?'Approved':state.activeQuote.status==='Approved'?'Approved':'Draft'; if(next===state.activeQuote.status){toast('This quotation is already approved.');return;} const row={...state.activeQuote,status:next}; try{const saved=await store.saveQuote(row); const i=state.quotes.findIndex(x=>x.id===saved.id);state.quotes[i]=saved;state.activeQuote=saved;render();viewQuote(saved.id);toast(`Quotation marked ${next.toLowerCase()}.`);}catch(err){toast(err.message)} });
$('#printQuoteBtn').addEventListener('click',()=>{ $('#detailSheet').classList.add('printing'); window.print(); setTimeout(()=>$('#detailSheet').classList.remove('printing'),400); });
$('#profileBtn').addEventListener('click',()=>{ if(isCloud&&confirm('Sign out of Mughal Interior Accounts?'))logout(); else toast('Demo user · Supabase not connected'); });
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').classList.add('hidden');try{await store.signIn($('#loginEmail').value,$('#loginPassword').value);await boot();}catch(err){$('#loginError').textContent=err.message;$('#loginError').classList.remove('hidden')}});
boot();
