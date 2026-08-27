const test=require('node:test'),assert=require('node:assert/strict');
const {printFixtures}=require('./print-fixtures.cjs');
function setup(t){const h=printFixtures();t.after(h.close);return h;}
function documentFor(h,html){const node=h.w.document.createElement('div');node.innerHTML=html;return node;}
function contact(node){assert.equal(node.querySelectorAll('.business-contact').length,1);assert.match(node.textContent,/Akbar Road Basti Iqbal Nagar,/);assert.match(node.textContent,/Near Potato Society, Okara/);assert.match(node.textContent,/03024441235/);assert.equal(node.querySelector('.business-whatsapp').getAttribute('href'),'https://wa.me/923024441235');assert.equal(node.querySelector('.business-whatsapp img').getAttribute('alt'),'WhatsApp');}
test('order invoice matches project document header and has correctly ordered table/totals',t=>{
  const h=setup(t),node=documentFor(h,h.order());contact(node);
  assert.ok(node.querySelector('.invoice-document .document-header'));assert.ok(node.querySelector('.document-header img[src="assets/mughal-logo.png"]'));
  assert.match(node.querySelector('.document-meta').textContent,/Sample Customer.*ORD-0001/s);
  assert.deepEqual(Array.from(node.querySelectorAll('thead th'),x=>x.textContent),['Item / details','Qty','Rate','Amount']);
  assert.equal(node.querySelectorAll('tbody tr').length,2);assert.match(node.querySelector('tbody tr').textContent,/Wooden door/);
  assert.match(node.querySelector('.invoice-grand-total').textContent,/14,500/);assert.match(node.querySelector('dd.negative').textContent,/500/);
  assert.equal(node.querySelector('.detail-hero'),null);assert.doesNotMatch(node.textContent,/Order details/);
});
test('project quote and invoice keep contact exactly once and keep negative scope deductions',t=>{
  const h=setup(t);contact(documentFor(h,h.quote()));const node=documentFor(h,h.project());contact(node);assert.match(node.querySelector('.document-table .negative').textContent,/5,000/);
});
test('all receipt and purchase print-preview types contain one contact block',t=>{
  const h=setup(t);for(const call of ["viewReceipt('receipt-1')","viewOrderReceipt('order-receipt')","viewPurchasePayment('supplier-payment')","viewPurchase('bill-1')"]){h.run(call);contact(h.w.document.querySelector('#detailBody .pdf-document'));}
});
test('all 11 reports and individual project statement have contact once, outside financial tables',t=>{
  const h=setup(t),d=h.w.document;
  for(const button of d.querySelectorAll('[data-open-report]')){button.click();contact(d.querySelector('#reportContent'));assert.equal(d.querySelectorAll('#reportContent table .business-contact').length,0);}
  d.querySelector('[data-open-report="receivables"]').click();d.querySelector('[data-report-scope="projects"]').click();d.querySelector('#reportProject').value='project-1';d.querySelector('#reportProject').dispatchEvent(new h.w.Event('change'));contact(d.querySelector('#reportContent'));assert.ok(d.querySelector('.project-statement'));
});
test('order invoice handles blank fields, fractional quantity and escaped details',t=>{
  const h=setup(t);h.run("state.walkInOrders[0].customer_phone='';state.orderInvoiceItems[0].details='<script>unsafe</script>';state.orderInvoiceItems[0].item_name='A & B';");
  const node=documentFor(h,h.order());assert.equal(node.querySelector('script'),null);assert.match(node.textContent,/A & B/);assert.match(node.textContent,/2.5/);assert.doesNotMatch(node.textContent,/undefined|null|Not entered/);
});
test('the downloadable order invoice contains the same complete branded preview',async t=>{
  const h=setup(t);let exported;
  h.w.html2pdf=()=>({set(options){this.options=options;return this;},from(node){this.node=node;return this;},async save(){exported=this;}});
  h.run("viewOrderInvoice('order-1')");await h.run("downloadCurrent(document.querySelector('[data-detail-download]'))");
  contact(exported.node);assert.equal(exported.options.jsPDF.orientation,'portrait');assert.equal(exported.node,h.w.document.querySelector('#detailBody .pdf-document'));assert.match(exported.options.filename,/INV-0002|inv-0002/);
});
