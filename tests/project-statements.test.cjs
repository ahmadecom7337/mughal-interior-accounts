const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('./project-statement-fixture.cjs');
const root = path.join(__dirname, '..');
function setup() {
  const elements = new Map(), events = {}, exports = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: /From|To/.test(selector) ? '' : selector === '#reportProject' ? 'project-1' : 'all',
      innerHTML: '', options: [{value:'all'},{value:'project-1'}], disabled:false,
      classList: {toggle(){},add(){},remove(){}}, setAttribute(name,value){this[name]=value;}, addEventListener(){}
    });
    return elements.get(selector);
  }
  const context = {document:{querySelector:element,querySelectorAll:()=>[],addEventListener(name,fn){events[name]=fn;},createElement(){return {innerHTML:'',remove(){this.removed=true;}};},body:{append(){}}},window:{},crypto:{},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'app-mobile.js'),'utf8').split('class Store')[0],context);
  context.fixture=structuredClone(fixture);
  vm.runInContext('Object.assign(state, fixture);',context);
  context.working=async(label,button,fn)=>fn();context.toast=()=>{};
  context.window.html2pdf=true;
  context.html2pdf=()=>({set(options){this.options=options;return this;},from(node){this.node=node;return this;},async save(){exports.push(this);}});
  const source=fs.readFileSync(path.join(root,'reports-mobile.js'),'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.api={projectStatementRows,renderReceivables,renderCurrent,reportState,clearReportDates,downloadPdf,reportFileName};})();');
  vm.runInContext(source,context);
  context.api.reportState.type='receivables';context.api.reportState.scope='projects';
  return {api:context.api,context,element,exports,events,job:context.fixture.projects[0],ledger:()=>context.api.projectStatementRows(context.fixture.projects[0])};
}
test('all dates: invoice date, scope changes, ordered receipts, no mirror double count or internal costs',()=>{
  const h=setup(),ledger=h.ledger();
  assert.equal(ledger.rows.length,6);assert.equal(ledger.rows[0].day,'2026-01-05');
  assert.deepEqual(Array.from(ledger.rows,row=>row.balance),[100000,80000,90000,85000,45000,-5000]);
  assert.equal(ledger.charges,105000);assert.equal(ledger.receipts,110000);assert.equal(ledger.closing,-5000);
});
test('February includes opening, period receipts and charges; no future payment',()=>{
  const h=setup();h.element('#reportFrom').value='2026-02-01';h.element('#reportTo').value='2026-02-28';
  const ledger=h.ledger();assert.equal(ledger.opening,80000);assert.equal(ledger.rows[0].charge,80000);
  assert.equal(ledger.charges,5000);assert.equal(ledger.receipts,40000);assert.equal(ledger.closing,45000);
  h.api.renderReceivables();assert.match(h.element('#reportContent').innerHTML,/Opening balance brought forward/);
  assert.doesNotMatch(h.element('#reportContent').innerHTML,/Private internal|999999|report-summary/);
});
test('inclusive boundaries, no-activity period, before invoice and customer credit opening',()=>{
  const h=setup();h.element('#reportFrom').value='2026-02-10';h.element('#reportTo').value='2026-02-10';
  assert.equal(h.ledger().opening,85000);assert.equal(h.ledger().closing,45000);assert.equal(h.ledger().receipts,40000);
  h.element('#reportFrom').value='2026-02-11';h.element('#reportTo').value='2026-02-12';assert.equal(h.ledger().rows.length,1);assert.equal(h.ledger().closing,45000);
  h.element('#reportFrom').value='2026-01-01';h.element('#reportTo').value='2026-01-04';assert.equal(h.ledger().closing,0);
  h.element('#reportFrom').value='2026-04-01';h.element('#reportTo').value='2026-04-30';assert.equal(h.ledger().opening,-5000);assert.equal(h.ledger().closing,-5000);
});
test('All Dates clears only dates, keeps project and restores complete history',()=>{
  const h=setup();h.element('#reportFrom').value='2026-02-01';h.element('#reportTo').value='2026-02-28';
  h.events.click({target:{id:'reportAllDatesBtn',closest:()=>null}});
  assert.equal(h.element('#reportFrom').value,'');assert.equal(h.element('#reportTo').value,'');assert.equal(h.element('#reportProject').value,'project-1');
  assert.equal(h.api.reportState.scope,'projects');assert.equal(h.element('#reportAllDatesBtn')['aria-pressed'],'true');assert.match(h.element('#reportContent').innerHTML,/RCP-0003/);
});
test('invalid ranges disable exports and clear stale output',async()=>{
  const h=setup();h.api.renderCurrent();h.element('#reportFrom').value='2026-03-01';h.element('#reportTo').value='2026-02-01';h.api.renderCurrent();
  assert.equal(h.element('#reportPdfBtn').disabled,true);assert.equal(h.api.reportState.csv.length,0);assert.match(h.element('#reportContent').innerHTML,/Check the date range/);
  await h.api.downloadPdf({});assert.equal(h.exports.length,0);
});
test('PDF and CSV include identity, date range, references and same closing balance',async()=>{
  const h=setup();h.element('#reportFrom').value='2026-02-01';h.element('#reportTo').value='2026-02-28';h.api.renderCurrent();
  assert.equal(h.api.reportState.csv.at(-1).at(-1),45000);await h.api.downloadPdf({});
  const output=h.exports[0];assert.equal(output.options.jsPDF.orientation,'portrait');assert.equal(output.options.filename,'project-statement-prj-0001-2026-02-01-2026-02-28.pdf');
  assert.equal(output.node.innerHTML,h.element('#reportContent').innerHTML);assert.equal(output.node.removed,true);
  for(const text of ['Sample Customer','Mughal Interior','PRJ-0001','RCP-0002','mughal-logo.png','Scope deduction'])assert.ok(output.node.innerHTML.includes(text));
});
test('pending quotations do not generate client statements; closed approved projects do',async()=>{
  const h=setup();h.api.renderReceivables();assert.ok(h.api.reportState.csv.length>0);
  h.job.status='Pending';h.api.renderReceivables();assert.equal(h.api.reportState.csv.length,0);await h.api.downloadPdf({});assert.equal(h.exports.length,0);
});
test('currency rounding and stable same-day ordering',()=>{
  const h=setup();h.job.original_contract_amount=.3;h.context.fixture.entries.length=0;
  h.context.fixture.payments.splice(0,99,{id:'b',project_id:'project-1',payment_type:'customer_receipt',payment_date:'2026-01-05',amount:.1},{id:'a',project_id:'project-1',payment_type:'customer_receipt',payment_date:'2026-01-05',amount:.2});
  const ledger=h.ledger();assert.equal(ledger.closing,0);assert.deepEqual(Array.from(ledger.rows,row=>row.id),['invoice-1','a','b']);
});
test('client-provided text is escaped',()=>{
  const h=setup();h.job.name='<script>unsafe</script>';h.api.renderReceivables();assert.doesNotMatch(h.element('#reportContent').innerHTML,/<script>/);assert.match(h.element('#reportContent').innerHTML,/&lt;script&gt;/);
});
test('all report types still render without info cards; non-date reports ignore stale dates',()=>{
  for(const type of ['profit','receivables','expenses','labourAssigned','materialCost','supplierPayables','purchases','materialMovement','materialQuantity','labourStatement','bankStatement']){
    const h=setup();h.api.reportState.type=type;h.api.reportState.scope='overall';h.element('#reportProject').value='all';h.element('#reportAccount').value='';
    assert.doesNotThrow(()=>h.api.renderCurrent(),type);assert.doesNotMatch(h.element('#reportContent').innerHTML,/report-summary/);
  }
  const h=setup();h.api.reportState.type='materialQuantity';h.element('#reportFrom').value='2026-03-01';h.element('#reportTo').value='2026-02-01';h.api.renderCurrent();assert.equal(h.element('#reportPdfBtn').disabled,false);
});
