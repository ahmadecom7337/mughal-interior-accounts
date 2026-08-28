const test=require('node:test'),assert=require('node:assert/strict');
const {printFixtures}=require('./print-fixtures.cjs');
function setup(t){const h=printFixtures();t.after(h.close);return h;}
function documentFor(h,html){const node=h.w.document.createElement('div');node.innerHTML=html;return node;}
function contact(node){assert.equal(node.querySelectorAll('.business-contact').length,1);assert.match(node.textContent,/Akbar Road Basti Iqbal Nagar,/);assert.match(node.textContent,/Near Potato Society, Okara/);assert.match(node.textContent,/03024441235/);assert.equal(node.querySelector('.business-whatsapp').getAttribute('href'),'https://wa.me/923024441235');assert.equal(node.querySelector('.business-whatsapp img').getAttribute('alt'),'WhatsApp');}
function brandedHeader(node){const header=node.querySelector('.document-header');assert.match(header.textContent,/Mughal Interior and Decor/);assert.match(header.textContent,/Proprietor Ali Raza Mughal/);assert.ok(header.querySelector('.business-contact'));assert.doesNotMatch(header.textContent,/INV-|MII-|MIO-|QTN-/);}
test('order invoice matches project document header and has correctly ordered table/totals',t=>{
  const h=setup(t),node=documentFor(h,h.order());contact(node);
  assert.ok(node.querySelector('.invoice-document .document-header'));assert.ok(node.querySelector('.document-header img[src="assets/mughal-logo.png"]'));brandedHeader(node);
  assert.match(node.querySelector('.document-meta').textContent,/Sample Customer.*ORD-0001/s);
  assert.match(node.querySelector('.document-meta').textContent,/DATE.*INVOICE NO\..*INV-0002/s);
  assert.deepEqual(Array.from(node.querySelectorAll('thead th'),x=>x.textContent),['Item / details','Qty','Rate','Amount']);
  assert.equal(node.querySelectorAll('tbody tr').length,2);assert.match(node.querySelector('tbody tr').textContent,/Wooden door/);
  assert.match(node.querySelector('.invoice-grand-total').textContent,/14,500/);assert.match(node.querySelector('dd.negative').textContent,/500/);
  assert.equal(node.querySelector('.detail-hero'),null);assert.doesNotMatch(node.textContent,/Order details/);
});
test('project quote and invoice keep contact exactly once and keep negative scope deductions',t=>{
  const h=setup(t),quote=documentFor(h,h.quote());contact(quote);brandedHeader(quote);assert.match(quote.querySelector('.document-disclaimer').textContent,/Prices are subject to change until approval and advance payment/);const node=documentFor(h,h.project());contact(node);brandedHeader(node);assert.match(node.querySelector('.document-meta').textContent,/DATE.*INVOICE NO\..*INV-0001/s);assert.match(node.querySelector('.document-table .negative').textContent,/5,000/);assert.ok(node.querySelector('.document-disclaimer .disclaimer-edit'));
});
test('all receipt and purchase print-preview types contain one contact block',t=>{
  const h=setup(t);for(const call of ["viewReceipt('receipt-1')","viewOrderReceipt('order-receipt')","viewPurchasePayment('supplier-payment')","viewPurchase('bill-1')"]){h.run(call);contact(h.w.document.querySelector('#detailBody .pdf-document'));}
});
test('quotes and both invoice types show separate date and number fields',t=>{
  const h=setup(t);
  for(const [html,numberLabel,number] of [[h.quote(),'QUOTE NO.',h.run('state.projects[0].project_number')],[h.project(),'INVOICE NO.','INV-0001'],[h.order(),'INVOICE NO.','INV-0002']]){
    const node=documentFor(h,html),fields=Array.from(node.querySelector('.document-meta').children);
    assert.equal(fields.length,4);
    const dateField=fields.find(field=>field.querySelector('small').textContent==='DATE'),numberField=fields.find(field=>field.querySelector('small').textContent===numberLabel);
    assert.ok(dateField);assert.ok(numberField);assert.notEqual(dateField,numberField);
    assert.ok(dateField.querySelector('b').textContent);assert.equal(numberField.querySelector('b').textContent,number);
    assert.equal(node.querySelector('.document-brand>span'),null);assert.doesNotMatch(node.textContent,/DATE \/ (INVOICE|QUOTE) NO/);
  }
});
test('all report screens omit business contact while PDFs retain it once outside financial tables',async t=>{
  const h=setup(t),d=h.w.document;let exported;
  h.w.html2pdf=()=>({set(){return this;},from(node){this.node=node;return this;},async save(){exported=this.node;}});
  async function checkScreenAndPdf(){
    const screen=d.querySelector('#reportContent');
    assert.equal(screen.querySelector('.business-contact'),null);
    assert.doesNotMatch(screen.textContent,/Proprietor Ali Raza Mughal|Akbar Road Basti Iqbal Nagar|Near Potato Society, Okara|03024441235|WhatsApp/);
    exported=null;d.querySelector('#reportPdfBtn').click();await new Promise(resolve=>setImmediate(resolve));
    assert.ok(exported);contact(exported);assert.match(exported.textContent,/Proprietor Ali Raza Mughal/);
    assert.equal(exported.querySelectorAll('table .business-contact').length,0);
    assert.equal(exported.isConnected,false);assert.equal(screen.querySelector('.business-contact'),null);
  }
  for(const button of d.querySelectorAll('[data-open-report]')){button.click();await checkScreenAndPdf();}
  d.querySelector('[data-open-report="receivables"]').click();d.querySelector('[data-report-scope="projects"]').click();d.querySelector('#reportProject').value='project-1';d.querySelector('#reportProject').dispatchEvent(new h.w.Event('change'));assert.ok(d.querySelector('.project-statement'));await checkScreenAndPdf();
});
test('order invoice handles blank fields, fractional quantity and escaped details',t=>{
  const h=setup(t);h.run("state.walkInOrders[0].customer_phone='';state.orderInvoiceItems[0].details='<script>unsafe</script>';state.orderInvoiceItems[0].item_name='A & B';");
  const node=documentFor(h,h.order());assert.equal(node.querySelector('script'),null);assert.match(node.textContent,/A & B/);assert.match(node.textContent,/2.5/);assert.doesNotMatch(node.textContent,/undefined|null|Not entered/);
});
test('the downloadable order invoice contains the same complete branded preview',async t=>{
  const h=setup(t);let exported;
  h.w.html2pdf=()=>({set(options){this.options=options;return this;},from(node){this.node=node;return this;},async save(){this.hadExporting=this.node.classList.contains('pdf-exporting');exported=this;}});
  h.run("viewOrderInvoice('order-1')");await h.run("downloadCurrent(document.querySelector('[data-detail-download]'))");
  contact(exported.node);assert.equal(exported.hadExporting,true);assert.equal(exported.options.jsPDF.orientation,'portrait');assert.equal(exported.node,h.w.document.querySelector('#detailBody .pdf-document'));assert.match(exported.options.filename,/INV-0002|inv-0002/);
});
