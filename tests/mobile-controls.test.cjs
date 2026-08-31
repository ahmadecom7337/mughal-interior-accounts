// Test-only dependency: jsdom@26.1.0 (not loaded by the app).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function setup(t){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>{dom.window.MughalControls?.destroy();dom.window.close();});const w=dom.window,d=w.document,ctx=dom.getInternalVMContext();
  w.scrollTo=()=>{};w.confirm=()=>false;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const run=code=>vm.runInContext(code,ctx);
  run(fs.readFileSync(path.join(root,'app-mobile.js'),'utf8').replace(/boot\(\);\s*$/,''));
  w.fixture=structuredClone(require('./project-statement-fixture.cjs'));w.fixture.projects[0].closed=false;
  run(`Object.assign(state,fixture);state.labourers=[{id:'l1',name:'Sample worker',daily_wage_rate:1500}];state.paymentAccounts=[{id:'b1',name:'Sample bank',account_type:'Bank',opening_balance:100000},{id:'cash',name:'Cash',account_type:'Cash',opening_balance:100000}];state.materials=[{id:'m1',name:'Plywood',unit:'sheet',default_unit_cost:100}];state.orderItems=[{id:'item1',name:'Door',details:'Wooden door'}];state.walkInOrders=[{id:'o1',order_number:'ORD-1',customer_name:'Sample Buyer',customer_phone:'03000000000',amount:20000,status:'Approved'}];`);
  run(fs.readFileSync(path.join(root,'reports-mobile.js'),'utf8'));run('render();');
  run(fs.readFileSync(path.join(root,'mobile-controls.js'),'utf8'));
  const refresh=()=>w.MughalControls.refresh();
  const source=id=>d.getElementById(id),trigger=id=>source(id).parentElement.querySelector('.search-select-trigger');
  const open=id=>{refresh();trigger(id).click();return d.getElementById('selectionDialog');};
  const search=query=>{const input=d.querySelector('#selectionDialog input');input.value=query;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const pick=text=>{const b=Array.from(d.querySelectorAll('.selection-option')).find(button=>button.textContent.includes(text));assert.ok(b,`Missing option ${text}`);b.click();};
  return{w,d,run,refresh,source,trigger,open,search,pick};
}
test('all static selects and datalists are enhanced; labels and original controls retained',t=>{
  const h=setup(t),sources=h.d.querySelectorAll('select,input[list]');assert.ok(sources.length>35);
  for(const s of sources){assert.ok(s.classList.contains('enhanced-select-source'),s.id);const b=s.parentElement.querySelector('button');assert.equal(b.type,'button');assert.equal(b.getAttribute('aria-haspopup'),'dialog');assert.ok(b.getAttribute('aria-label'));}
});
test('open shows complete list without focusing search; search, choose and cancel preserve values',t=>{
  const h=setup(t);h.run('openProject()');const dialog=h.open('projectParty');assert.equal(dialog.open,true);assert.equal(h.d.activeElement.className,'selection-close');
  h.search('sample');h.pick('Sample Customer');assert.equal(h.source('projectParty').value,'customer-1');assert.equal(dialog.open,false);assert.match(h.trigger('projectParty').textContent,/Sample Customer/);
  h.open('projectParty');h.search('missing');assert.match(dialog.textContent,/No matches/);dialog.dispatchEvent(new h.w.Event('cancel',{cancelable:true}));assert.equal(h.source('projectParty').value,'customer-1');assert.equal(h.d.activeElement,h.trigger('projectParty'));
});
test('both labour forms have 19 half-step options from 1 to 10 and recalculate wages',t=>{
  const h=setup(t);for(const [open,days,person,total] of [['openLabourAssignment()','labourDayType','labourAssignmentPerson','labourActualCost'],['openOrderLabour()','orderLabourDay','orderLabourPerson','orderLabourTotal']]){
    h.run(open);assert.deepEqual(Array.from(h.source(days).options,o=>Number(o.value)),Array.from({length:19},(_,i)=>1+i/2));
    assert.deepEqual(Array.from(h.source(days).options,o=>o.textContent),Array.from({length:19},(_,i)=>i%2?`${Math.floor(1+i/2)}½ days`:`${1+i/2} ${i===0?'day':'days'}`));
    h.open(person);h.pick('Sample worker');h.open(days);h.search('3½');h.pick('3½');assert.equal(h.source(days).value,'3.5');assert.equal(h.source(total).value,'5250.00');
    h.open(days);h.search('10');h.pick('10 days');assert.equal(h.source(total).value,'15000.00');
  }
});
test('project and order receipts keep balances without over-receipt explanatory text',t=>{
  const h=setup(t);h.run("openReceipt();document.getElementById('receiptProject').value='project-1';updateReceiptDue();openOrderReceipt();document.getElementById('orderReceiptOrder').value='o1';updateOrderReceiptDue()");
  for(const id of ['receiptDue','orderReceiptDue']){assert.match(h.source(id).textContent,/balance|credit/i);assert.doesNotMatch(h.source(id).textContent,/over.?receipt|overpayment|allowed/i);}
  for(const id of ['receiptAmount','orderReceiptAmount'])assert.equal(h.source(id).hasAttribute('max'),false);
});
test('dynamic invoice selectors still trigger item details and value updates',async t=>{
  const h=setup(t);h.run('openOrderInvoice();addOrderInvoiceLine();');await new Promise(r=>setImmediate(r));
  const select=h.d.querySelector('[data-order-line-item]');assert.ok(select.classList.contains('enhanced-select-source'));select.parentElement.querySelector('button').click();h.search('door');h.pick('Door');
  assert.equal(select.value,'item1');assert.equal(select.closest('.invoice-line').querySelector('[data-order-line-details]').value,'Wooden door');
  select.value='';h.refresh();assert.match(select.parentElement.querySelector('button').textContent,/Select item/);
});
test('quote suggestions are selection-only, respect readonly and retain matching project',t=>{
  const h=setup(t);h.run('openQuote()');h.open('quoteProjectSearch');h.search('woodwork');h.pick('Sample woodwork project');assert.match(h.source('quoteProjectSearch').value,/Sample woodwork project/);
  h.run("openQuote('project-1')");h.refresh();assert.equal(h.trigger('quoteProjectSearch').disabled,true);
});
test('customer lookup selects existing number/name and still accepts new numbers',t=>{
  const h=setup(t);h.run('openOrderInvoice()');h.open('orderInvoiceMobile');h.search('0300');h.pick('03000000000');assert.equal(h.source('orderInvoiceCustomer').value,'Sample Buyer');
  h.open('orderInvoiceMobile');h.search('03111111111');h.pick('Use 03111111111');assert.equal(h.source('orderInvoiceMobile').value,'03111111111');
});
test('disabled selects and empty/required states work, reset restores trigger',async t=>{
  const h=setup(t);h.run('openProject()');h.open('projectParty');h.pick('Sample Customer');h.source('projectForm').reset();await new Promise(r=>setImmediate(r));assert.match(h.trigger('projectParty').textContent,/Select party/);
  h.source('projectParty').disabled=true;h.refresh();assert.equal(h.trigger('projectParty').disabled,true);
  h.source('projectParty').disabled=false;h.refresh();h.source('projectParty').dispatchEvent(new h.w.Event('invalid',{cancelable:true}));assert.equal(h.d.querySelector('#selectionDialog').open,true);assert.match(h.d.querySelector('.selection-error').textContent,/Please choose/);
});
test('reports, All Dates and dynamic filter options retain event behavior',t=>{
  const h=setup(t);assert.equal(h.source('reportClearBtn'),null);assert.equal(h.source('reportCsvBtn'),null);h.d.querySelector('[data-open-report="receivables"]').click();h.d.querySelector('[data-report-scope="projects"]').click();h.open('reportProject');h.search('woodwork');h.pick('Sample woodwork project');assert.match(h.source('reportContent').textContent,/PROJECT RECEIVABLE STATEMENT/);
  h.source('reportFrom').value='2026-02-01';h.source('reportAllDatesBtn').click();assert.equal(h.source('reportFrom').value,'');assert.match(h.trigger('reportProject').textContent,/woodwork/);
});
test('every module card/navigation has a semantic SVG and icon-only buttons stay named',t=>{
  const h=setup(t);for(const button of h.d.querySelectorAll('.action-grid>button,.bottom-nav>button'))assert.ok(button.querySelector('svg'),button.textContent);
  for(const button of h.d.querySelectorAll('button.back,.sheet-head>button[data-close],#logoutBtn')){assert.ok(button.querySelector('svg'));assert.ok(button.getAttribute('aria-label'));}
  assert.doesNotMatch(fs.readFileSync(path.join(root,'mobile.css'),'utf8'),/action-grid>button:nth-child/);
});
test('company header follows every screen and report, including back navigation',t=>{
  const h=setup(t),header=h.d.querySelector('.topbar'),style=h.d.createElement('style');
  style.textContent=fs.readFileSync(path.join(root,'mobile.css'),'utf8');h.d.head.append(style);
  assert.equal(header.querySelector('div>span').textContent,'Mughal Interior and Decor');
  assert.doesNotMatch(header.textContent,/Good day/);
  const colors=new Set();
  function check(screen){
    assert.equal(header.dataset.screen,screen);assert.ok(h.source('screenTitle').textContent);
    const color=h.w.getComputedStyle(header).getPropertyValue('--screen-color').trim();
    assert.match(color,/^#[0-9a-f]{6}$/i);assert.ok(!colors.has(color),`Duplicate screen colour: ${screen}`);colors.add(color);
    const rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    assert.ok(1.05/(luminance+.05)>=4.5,`White text contrast: ${screen}`);
  }
  for(const view of h.d.querySelectorAll('section.view')){const screen=view.id.replace(/View$/,'');h.run(`route(${JSON.stringify(screen)})`);check(screen);}
  for(const button of h.d.querySelectorAll('[data-open-report]')){button.click();check(`report-${button.dataset.openReport}`);assert.equal(h.source('screenTitle').textContent,h.source('reportTitle').textContent);}
  h.source('reportBackBtn').click();assert.equal(header.dataset.screen,'reports');assert.equal(h.source('screenTitle').textContent,'Reports');
  h.d.querySelector('[data-open-report="profit"]').click();h.d.querySelector('[data-tab="orders"]').click();assert.equal(header.dataset.screen,'orders');
  h.d.querySelector('[data-tab="reports"]').click();assert.equal(header.dataset.screen,'reports');
  assert.equal(h.source('logoutBtn').getAttribute('aria-label'),'Sign out');
});
test('keyboard search navigation, Escape cancellation, and disabled options',t=>{
  const h=setup(t);h.run('openProject()');const s=h.source('projectParty');s.add(new h.w.Option('Disabled choice','disabled'));s.options[s.options.length-1].disabled=true;
  const dialog=h.open('projectParty');assert.equal(Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='Disabled choice').disabled,true);
  const search=dialog.querySelector('input');search.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(h.d.activeElement.className,'selection-option');
  dialog.dispatchEvent(new h.w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,false);
});
test('multi-day submissions persist correct project and order wages using existing save handlers',async t=>{
  const h=setup(t);
  for(const [open,form,job,person,days] of [['openLabourAssignment()','labourAssignmentForm','labourAssignmentProject','labourAssignmentPerson','labourDayType'],['openOrderLabour()','orderLabourForm','orderLabourOrder','orderLabourPerson','orderLabourDay']]){
    h.run(open);h.open(job);h.pick(job==='labourAssignmentProject'?'woodwork':'Sample Buyer');h.open(person);h.pick('Sample worker');h.open(days);h.search('3½');h.pick('3½');
    const element=h.source(form),submitter=element.querySelector('[type="submit"]');assert.equal(element.checkValidity(),true);
    element.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter}));await new Promise(r=>setImmediate(r));
    assert.equal(h.run('state.labourAssignments[0].days'),3.5);assert.equal(h.run('state.labourAssignments[0].amount'),5250);
    assert.equal(h.run('state.labourAssignments[0].labourer_id'),'l1');
  }
});
test('supplier payment shows total supplier balance without selecting a bill',async t=>{
  const h=setup(t);h.run("state.suppliers=[{id:'s1',name:'Sample supplier'}];state.purchaseBills=[{id:'b1',supplier_id:'s1',bill_number:'PUR-1',total_amount:1000,amount_paid:100,status:'Posted'}];openPurchasePayment()");
  h.open('purchasePaymentSupplier');h.pick('Sample supplier');assert.match(h.source('purchasePaymentDue').textContent,/Total outstanding balance.*900/);assert.equal(h.source('purchasePaymentBill'),null);
  h.run('openPurchase();addPurchaseLine()');await new Promise(r=>setImmediate(r));const material=h.d.querySelector('[data-purchase-line-material]');material.parentElement.querySelector('button').click();h.pick('Plywood');assert.equal(material.value,'m1');assert.equal(material.closest('.purchase-line').querySelector('[data-purchase-line-rate]').value,'100');
});
test('wage payment accepts a partial amount and leaves the remaining balance due',async t=>{
  const h=setup(t);h.run("state.labourAssignments=[{id:'a1',labourer_id:'l1',project_id:'project-1',assignment_date:'2026-08-01',days:2,daily_rate:1500,amount:3000,created_at:'2026-08-01T00:00:00Z'}];openPayWages('l1');document.getElementById('payWagesAmount').value='1000';document.getElementById('payWagesAmount').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('payWagesAccount').value='b1'");
  const form=h.source('payWagesForm'),submitter=form.querySelector('[type="submit"]');form.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter}));await new Promise(r=>setImmediate(r));
  assert.equal(h.run("state.labourWageSettlements[0].gross_wages"),1000);assert.equal(h.run("state.labourWageSettlementItems[0].amount"),1000);assert.equal(h.run("labourUnpaidTotal('l1')"),2000);
});
test('charged project and order expenses reduce profit and appear in expense reports',t=>{
  const h=setup(t);h.run("state.entries.push({id:'expense-p',project_id:'project-1',entry_type:'expense',entry_date:'2026-02-01',description:'Project transport',amount:321});state.walkInEntries.push({id:'expense-o',walk_in_order_id:'o1',entry_type:'expense',entry_date:'2026-02-01',description:'Order fitting',amount:123});");
  h.d.querySelector('[data-open-report="profit"]').click();h.source('reportAllDatesBtn').click();const rows=h.d.querySelectorAll('#reportContent tbody tr');assert.match(rows[0].children[4].textContent,/654/);assert.match(rows[1].children[4].textContent,/123/);
  h.d.querySelector('[data-open-report="expenses"]').click();h.source('reportAllDatesBtn').click();assert.match(h.source('reportContent').textContent,/Project transport/);assert.match(h.source('reportContent').textContent,/Order fitting/);
});
test('Cash appears in the List of Banks by default',t=>{const h=setup(t);h.run("route('bankAccounts')");assert.match(h.source('bankAccountList').textContent,/Cash/);assert.match(h.source('bankAccountList').textContent,/Default cash ledger/);});
test('consumable purchases use amount-only lines with collapsed details',async t=>{
  const h=setup(t);h.run("state.suppliers=[{id:'cash-supplier',name:'Cash Purchase Supplier'}];state.materials.push({id:'c1',name:'Nails',unit:'piece',tracking_type:'consumable'});openPurchase('cash')");await new Promise(r=>setImmediate(r));
  const line=h.d.querySelector('.purchase-line'),select=line.querySelector('[data-purchase-line-material]');select.value='c1';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.ok(line.classList.contains('consumable-line'));assert.equal(line.querySelector('[data-purchase-line-qty]').value,'1');assert.match(line.querySelector('[data-purchase-line-rate-label]').textContent,/Total amount/);
  const details=line.querySelector('[data-purchase-line-details-wrap]');assert.ok(details.classList.contains('hidden'));line.querySelector('[data-toggle-line-details]').click();assert.equal(details.classList.contains('hidden'),false);
  assert.equal(h.source('cashPurchaseAccount').required,true);assert.equal(h.source('purchaseSupplierLabel').classList.contains('hidden'),true);
});
test('consumable pool and project allocation track rupee balance',async t=>{
  const h=setup(t);h.run("state.materials.push({id:'c1',name:'Glue',unit:'piece',tracking_type:'consumable'});state.materialMovements=[{id:'buy',material_id:'c1',movement_type:'purchase',movement_date:'2026-08-01',quantity:1,unit_cost:5000},{id:'use',material_id:'c1',project_id:'project-1',movement_type:'project_issue',movement_date:'2026-08-02',quantity:1,unit_cost:2000}];render();route('consumablePool')");
  assert.match(h.source('consumablePoolSummary').textContent,/Purchased.*5,000.*Allocated.*2,000.*remaining.*3,000/s);assert.match(h.source('consumablePoolList').textContent,/Glue.*3,000/s);
  h.run("openMaterialAssignment('assign');document.getElementById('materialAssignmentProject').value='project-1';document.getElementById('materialAssignmentMaterial').value='c1';document.getElementById('materialAssignmentQuantity').value='1000';updateMaterialCost()");
  assert.match(h.source('materialStockHelp').textContent,/Rs\. 3,000/);const form=h.source('materialAssignmentForm');form.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('[type="submit"]')}));await new Promise(r=>setImmediate(r));
  assert.equal(h.run('state.materialMovements[0].quantity'),1);assert.equal(h.run('state.materialMovements[0].unit_cost'),1000);assert.equal(h.run("materialMetrics(material('c1')).stock"),2000);
});
test('project and order material assignment support multiple editable rows',async t=>{
  const h=setup(t);h.run("state.materials=[{id:'m1',name:'Plywood',unit:'sheet',tracking_type:'stock'},{id:'m2',name:'Wood',unit:'foot',tracking_type:'stock'}];state.materialMovements=[{id:'p1',material_id:'m1',movement_type:'purchase',movement_date:'2026-08-01',quantity:10,unit_cost:100},{id:'p2',material_id:'m2',movement_type:'purchase',movement_date:'2026-08-01',quantity:20,unit_cost:50}];state.walkInOrders[0].status='Pending'");
  for(const [open,formId,targetId] of [["openMaterialAssignment('assign')",'materialAssignmentForm','materialAssignmentProject'],["openOrderMaterial('assign')",'orderMaterialForm','orderMaterialOrder']]){
    h.run(open);h.source(targetId).value=targetId==='materialAssignmentProject'?'project-1':'o1';const form=h.source(formId),add=form.querySelector('.material-add-row button');add.click();const lines=form.querySelectorAll('[data-material-bulk-line]');assert.equal(lines.length,2);for(const [index,line] of [...lines].entries()){const select=line.querySelector('[data-material-line-material]'),quantity=line.querySelector('[data-material-line-quantity]');select.value=index?'m2':'m1';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));quantity.value=index?'3':'2';quantity.dispatchEvent(new h.w.Event('input',{bubbles:true}));}const submitter=form.querySelector('[type="submit"]');form.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter}));await new Promise(r=>setImmediate(r));
  }
  assert.equal(h.run("state.materialMovements.filter(row=>row.movement_type==='project_issue').length"),2);assert.equal(h.run("state.materialMovements.filter(row=>row.movement_type==='walk_in_issue').length"),2);
});
test('purchase bill import loads every stock and consumable line for projects and orders',async t=>{
  const h=setup(t);h.run("state.suppliers=[{id:'s1',name:'Sample supplier'}];state.materials=[{id:'m1',name:'Plywood',unit:'sheet',tracking_type:'stock'},{id:'c1',name:'Glue',unit:'piece',tracking_type:'consumable'}];state.purchaseBills=[{id:'bill1',supplier_id:'s1',bill_number:'PB-10',bill_date:'2026-08-20',status:'Posted'}];state.purchaseBillItems=[{id:'line1',purchase_bill_id:'bill1',material_id:'m1',quantity:8,unit_cost:100,line_total:800,details:'18 mm'},{id:'line2',purchase_bill_id:'bill1',material_id:'c1',quantity:1,unit_cost:5000,line_total:5000,details:'Adhesive'}];state.materialMovements=[{id:'buy1',material_id:'m1',movement_type:'purchase',movement_date:'2026-08-20',quantity:8,unit_cost:100},{id:'buy2',material_id:'c1',movement_type:'purchase',movement_date:'2026-08-20',quantity:1,unit_cost:5000}];state.walkInOrders[0].status='Pending'");
  for(const [open,billId,importId,formId] of [["openMaterialAssignment('assign')",'materialAssignmentPurchaseBill','materialAssignmentImportBill','materialAssignmentForm'],["openOrderMaterial('assign')",'orderMaterialPurchaseBill','orderMaterialImportBill','orderMaterialForm']]){h.run(open);h.source(billId).value='bill1';h.source(importId).click();const rows=h.source(formId).querySelectorAll('[data-material-bulk-line]');assert.equal(rows.length,2);assert.deepEqual([...rows].map(row=>row.querySelector('[data-material-line-quantity]').value),['8','5000']);assert.match(rows[0].querySelector('[data-material-line-details]').value,/18 mm/);assert.equal(rows[1].querySelector('[data-material-line-rate]').closest('label').classList.contains('hidden'),true);rows[0].querySelector('[data-material-line-quantity]').value='4';assert.equal(rows[0].dataset.reference,'From PB-10');}
});
test('bulk material migration is atomic, permissioned and retains server stock validation',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase-bulk-material-assignment-20260831.sql'),'utf8');assert.match(sql,/create or replace function public\.assign_materials_bulk/);assert.match(sql,/private\.is_business_member/);assert.match(sql,/insert into public\.material_movements/);assert.match(sql,/grant execute[\s\S]*to authenticated/);assert.doesNotMatch(sql,/exception[\s\S]*when others/);
});
test('material import stays stacked and shows live totals for projects and orders',t=>{
  const h=setup(t),css=fs.readFileSync(path.join(root,'mobile.css'),'utf8');
  assert.doesNotMatch(css,/@media\(min-width:540px\)\{\s*\.material-import/);
  h.run("state.suppliers=[{id:'s1',name:'Sample supplier'}];state.materials=[{id:'m1',name:'Plywood',unit:'sheet',tracking_type:'stock'},{id:'c1',name:'Glue',unit:'piece',tracking_type:'consumable'}];state.purchaseBills=[{id:'bill1',supplier_id:'s1',bill_number:'PB-10',bill_date:'2026-08-20',status:'Posted'}];state.purchaseBillItems=[{id:'line1',purchase_bill_id:'bill1',material_id:'m1',quantity:8,unit_cost:100,line_total:800},{id:'line2',purchase_bill_id:'bill1',material_id:'c1',quantity:1,unit_cost:5000,line_total:5000}];state.materialMovements=[{id:'buy1',material_id:'m1',movement_type:'purchase',movement_date:'2026-08-20',quantity:8,unit_cost:100},{id:'buy2',material_id:'c1',movement_type:'purchase',movement_date:'2026-08-20',quantity:1,unit_cost:5000}];state.walkInOrders[0].status='Pending'");
  for(const [open,billId,importId,totalId] of [["openMaterialAssignment('assign')",'materialAssignmentPurchaseBill','materialAssignmentImportBill','materialAssignmentGrandTotal'],["openOrderMaterial('assign')",'orderMaterialPurchaseBill','orderMaterialImportBill','orderMaterialGrandTotal']]){
    h.run(open);h.source(billId).value='bill1';h.source(importId).click();assert.equal(h.source(totalId).textContent,'Rs. 5,800');
    const first=h.source(totalId).closest('form').querySelector('[data-material-line-quantity]');first.value='4';first.dispatchEvent(new h.w.Event('input',{bubbles:true}));assert.equal(h.source(totalId).textContent,'Rs. 5,400');
  }
});
test('editing Cash preserves its account type and requires no bank details',async t=>{
  const h=setup(t);h.run("openBankAccount('cash')");assert.equal(h.source('bankAccountBank').required,false);assert.equal(h.source('bankAccountBank').closest('label').hidden,true);
  const form=h.source('bankAccountForm');assert.equal(form.checkValidity(),true);form.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('[type="submit"]')}));await new Promise(r=>setImmediate(r));
  assert.equal(h.run("account('cash').account_type"),'Cash');h.run("openBankAccount('b1')");assert.equal(h.source('bankAccountBank').required,true);assert.equal(h.source('bankAccountBank').closest('label').hidden,false);
});
test('business overheads reduce displayed net profit even without jobs',t=>{
  const h=setup(t);h.run("state.projects=[];state.walkInOrders=[];state.payments=[{id:'rent',payment_type:'expense',payment_date:'2026-08-01',amount:500}]");h.d.querySelector('[data-open-report="profit"]').click();h.source('reportAllDatesBtn').click();
  const rows=h.d.querySelectorAll('#reportContent tbody tr');assert.equal(rows.length,2);assert.match(rows[0].textContent,/Business overheads/);assert.match(rows[1].textContent,/Net profit \/ loss/);assert.match(rows[1].lastElementChild.textContent,/-500/);
});
test('approving a project uses the simple sequential invoice number',async t=>{
  const h=setup(t);h.run("state.invoices=[];Object.assign(state.projects[0],{status:'Pending',price_with_material:10000});openApproval('project-1')");
  const form=h.source('approvalForm');form.dispatchEvent(new h.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('[type="submit"]')}));await new Promise(r=>setImmediate(r));
  assert.equal(h.run("state.invoices[0].invoice_number"),'INV-0001');
});
test('wage balances use padded readable rows while preserving currency values',t=>{
  const h=setup(t),style=h.d.createElement('style');style.textContent=fs.readFileSync(path.join(root,'mobile.css'),'utf8');h.d.head.append(style);
  h.run("state.labourAssignments=[{id:'a1',labourer_id:'l1',project_id:'project-1',days:2.5,daily_rate:1500,amount:3750,assignment_date:'2026-08-27'}];state.payments.push({id:'advance1',payment_type:'labour_advance',labourer_id:'l1',amount:1000});openPayWages('l1')");
  const summary=h.d.querySelector('.wage-summary');assert.equal(summary.tagName,'DL');assert.equal(summary.classList.contains('totals-card'),false);
  assert.deepEqual(Array.from(summary.querySelectorAll('dt'),node=>node.textContent),['Wages due','Advance balance']);
  assert.equal(h.source('payWagesGross').textContent,'Rs. 3,750');assert.equal(h.source('payWagesAdvance').textContent,'Rs. 1,000');
  for(const id of ['payWagesGross','payWagesAdvance']){const amount=h.source(id),rowStyle=h.w.getComputedStyle(amount.parentElement),amountStyle=h.w.getComputedStyle(amount);assert.equal(amount.tagName,'DD');assert.equal(rowStyle.padding,'14px 16px');assert.equal(rowStyle.flexWrap,'wrap');assert.equal(amountStyle.fontSize,'18px');assert.equal(amountStyle.textAlign,'right');}
  h.run("state.payments=[];state.labourAssignments=[];updatePayWageSummary()");assert.equal(h.source('payWagesGross').textContent,'Rs. 0');assert.equal(h.source('payWagesAdvance').textContent,'Rs. 0');
});
