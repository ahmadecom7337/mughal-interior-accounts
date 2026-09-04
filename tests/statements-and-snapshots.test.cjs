const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('./project-statement-fixture.cjs');
const root = path.join(__dirname, '..');

function setup(now='2026-09-04T12:00:00') {
  const elements = new Map(), events = {}, exports = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: /From|To/.test(selector) ? '' : selector === '#reportProject' ? 'project-1' : selector === '#reportAsOf' ? '' : 'all',
      innerHTML: '', options: [{value:'all'},{value:'project-1'}], disabled:false,
      classList: {
        classes: new Set(),
        toggle(cls, force){ if(force===undefined) force=!this.classes.has(cls); if(force) this.classes.add(cls); else this.classes.delete(cls); },
        add(cls){ this.classes.add(cls); },
        remove(cls){ this.classes.delete(cls); },
        contains(cls){ return this.classes.has(cls); }
      },
      setAttribute(name,value){this[name]=value;},
      getAttribute(name){return this[name]||null;},
      addEventListener(){}
    });
    return elements.get(selector);
  }
  const context = {
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener(name, fn){ events[name] = fn; },
      createElement(){ return { innerHTML: '', remove(){ this.removed = true; } }; },
      body: { append(){} }
    },
    window: { scrollTo(){} },
    crypto: {},
    console,
    Date: class extends Date {
      constructor(...args){ super(...(args.length ? args : [now])); }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app-mobile.js'), 'utf8').split('class Store')[0], context);
  context.fixture = structuredClone(fixture);
  vm.runInContext('Object.assign(state, fixture);', context);
  vm.runInContext('globalThis.helpers={materialMetrics,supplierBalance};', context);
  context.working = async(label, button, fn) => fn();
  context.toast = () => {};
  context.window.html2pdf = true;
  context.html2pdf = () => ({
    set(options){ this.options = options; return this; },
    from(node){ this.node = node; return this; },
    async save(){ exports.push(this); }
  });
  const source = fs.readFileSync(path.join(root, 'reports-mobile.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'globalThis.api={projectStatementRows,jobRows,receivableRows,renderReceivables,renderCustomerStatement,renderSupplierStatement,renderSupplierPayables,renderMaterialQuantity,materialMetricsAsOf,supplierPayablesAsOf,renderCurrent,reportState,clearReportDates,downloadPdf,reportFileName,openReport,showHub,definitions,singleDateReports,scopedReports};})();');
  vm.runInContext(source, context);
  return {
    api: context.api,
    context,
    element,
    exports,
    events,
    fixture: context.fixture
  };
}

test('Receivable report, Supplier payables and Material quantity are single date reports defaulting to today', () => {
  const h = setup('2026-09-04T10:00:00');
  for (const reportType of ['receivables', 'supplierPayables', 'materialQuantity']) {
    h.api.openReport(reportType);
    assert.equal(h.api.singleDateReports.has(reportType), true);
    assert.equal(h.element('#reportAsOf').value, '2026-09-04');
    assert.equal(h.element('#reportFrom').value, '');
    assert.equal(h.element('#reportAsOfWrap').classList.contains('hidden'), false);
    assert.equal(h.element('#reportFromWrap').classList.contains('hidden'), true);
    assert.equal(h.element('#reportToWrap').classList.contains('hidden'), true);
    assert.equal(h.element('#reportDateTools').classList.contains('hidden'), true);
  }
});

test('Receivable report calculates balances as of the selected date', () => {
  const h = setup('2026-09-04T10:00:00');
  h.api.openReport('receivables');
  h.element('#reportProject').value = 'all';
  h.element('#reportAsOf').value = '2026-01-31';
  const rowsJan = h.api.receivableRows('2026-01-31');
  const projJan = rowsJan.find(r => r.id === 'project-1');
  assert.ok(projJan);
  assert.equal(projJan.revenue, 100000);
  assert.equal(projJan.received, 20000);
  assert.equal(projJan.balance, 80000);

  const rowsFeb = h.api.receivableRows('2026-02-12');
  const projFeb = rowsFeb.find(r => r.id === 'project-1');
  assert.equal(projFeb.revenue, 105000);
  assert.equal(projFeb.received, 60000);
  assert.equal(projFeb.balance, 45000);
});

test('Material quantity computes stock as of the selected date', () => {
  const h = setup('2026-09-04T10:00:00');
  h.fixture.materials.push({ id: 'mat-test', name: 'Wood Planks', unit: 'sqft', tracking_type: 'stock', opening_quantity: 10, default_unit_cost: 50 });
  h.fixture.materialMovements.push({ material_id: 'mat-test', movement_type: 'purchase', movement_date: '2026-01-15', quantity: 5, unit_cost: 60 });
  h.fixture.materialMovements.push({ material_id: 'mat-test', movement_type: 'project_issue', movement_date: '2026-02-10', quantity: 3, unit_cost: 60 });

  const metricsJan = h.api.materialMetricsAsOf(h.fixture.materials.find(m => m.id === 'mat-test'), '2026-01-20');
  assert.equal(metricsJan.stock, 15);
  assert.equal(metricsJan.unitCost, 60);

  const metricsFeb = h.api.materialMetricsAsOf(h.fixture.materials.find(m => m.id === 'mat-test'), '2026-02-15');
  assert.equal(metricsFeb.stock, 12);
});

test('Customer statement and Supplier statement have same filters and scope as Profit report', () => {
  const h = setup('2026-09-04T10:00:00');
  assert.ok(h.api.scopedReports.has('profit'));
  assert.ok(h.api.scopedReports.has('customerStatement'));
  assert.ok(h.api.scopedReports.has('supplierStatement'));

  h.api.openReport('customerStatement');
  assert.equal(h.element('#reportFromWrap').classList.contains('hidden'), false);
  assert.equal(h.element('#reportToWrap').classList.contains('hidden'), false);
  assert.equal(h.element('#reportScope').classList.contains('hidden'), false);
  assert.equal(h.element('#reportDateTools').classList.contains('hidden'), false);

  h.api.openReport('supplierStatement');
  assert.equal(h.element('#reportFromWrap').classList.contains('hidden'), false);
  assert.equal(h.element('#reportToWrap').classList.contains('hidden'), false);
  assert.equal(h.element('#reportScope').classList.contains('hidden'), false);
  assert.equal(h.element('#reportSupplierWrap').classList.contains('hidden'), false);
});

test('Customer statement displays 2-column format (Invoiced vs Receipts, Balance)', () => {
  const h = setup('2026-09-04T10:00:00');
  h.api.openReport('customerStatement');
  h.element('#reportProject').value = 'all';
  h.api.renderCustomerStatement();
  const html = h.element('#reportContent').innerHTML;
  assert.match(html, /Invoiced/);
  assert.match(html, /Receipts/);
  assert.match(html, /Balance/);

  h.api.reportState.scope = 'projects';
  h.element('#reportProject').value = 'project-1';
  h.api.renderCustomerStatement();
  const projHtml = h.element('#reportContent').innerHTML;
  assert.match(projHtml, /CUSTOMER STATEMENT/);
  assert.match(projHtml, /Invoiced/);
  assert.match(projHtml, /Receipts/);
  assert.match(projHtml, /Balance/);
});

test('Supplier statement displays 2-column format (Bills vs Paid, Balance)', () => {
  const h = setup('2026-09-04T10:00:00');
  h.fixture.suppliers.push({ id: 'sup-1', name: 'Timber Co', opening_amount: 5000, phone: '12345' });
  h.fixture.purchaseBills.push({ id: 'bill-1', supplier_id: 'sup-1', bill_number: 'BIL-001', bill_date: '2026-02-01', total_amount: 15000, amount_paid: 10000, status: 'Posted' });
  h.fixture.payments.push({ id: 'pay-1', supplier_id: 'sup-1', payment_type: 'supplier_payment', payment_date: '2026-02-05', amount: 10000, payment_number: 'PAY-001' });

  h.api.openReport('supplierStatement');
  h.element('#reportSupplier').value = 'all';
  h.api.renderSupplierStatement();
  const summaryHtml = h.element('#reportContent').innerHTML;
  assert.match(summaryHtml, /Bills/);
  assert.match(summaryHtml, /Paid/);
  assert.match(summaryHtml, /Balance/);

  h.element('#reportSupplier').value = 'sup-1';
  h.api.renderSupplierStatement();
  const singleHtml = h.element('#reportContent').innerHTML;
  assert.match(singleHtml, /SUPPLIER STATEMENT/);
  assert.match(singleHtml, /Timber Co/);
  assert.match(singleHtml, /Bills/);
  assert.match(singleHtml, /Paid/);
  assert.match(singleHtml, /Balance/);
});
