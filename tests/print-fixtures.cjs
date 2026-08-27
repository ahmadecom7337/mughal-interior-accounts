const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function printFixtures(){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://test.invalid',runScripts:'outside-only'});
  const w=dom.window,ctx=dom.getInternalVMContext(),run=code=>vm.runInContext(code,ctx);w.scrollTo=()=>{};
  run(fs.readFileSync(path.join(root,'app-mobile.js'),'utf8').replace(/boot\(\);\s*$/,''));
  w.fixture=structuredClone(require('./project-statement-fixture.cjs'));
  run(`Object.assign(state,fixture);Object.assign(state.projects[0],{description:'Woodwork and fitted cabinets for the sample project.',price_with_material:100000,pricing_mode:'with_material',payment_terms:'Payment due as agreed.'});state.walkInOrders=[{id:'order-1',order_number:'ORD-0001',customer_name:'Sample Customer',customer_phone:'03000000000',order_date:'2026-08-27',subtotal:15000,discount:500,amount:14500}];state.invoices.push({id:'order-invoice',walk_in_order_id:'order-1',invoice_number:'INV-0002',invoice_date:'2026-08-27'});state.orderInvoiceItems=[{walk_in_order_id:'order-1',item_name:'Wooden door',details:'Polished finish with fitted handles.',quantity:1,rate:10000,amount:10000,sort_order:1},{walk_in_order_id:'order-1',item_name:'Wall shelving',details:'Custom shelves',quantity:2.5,rate:2000,amount:5000,sort_order:2}];state.suppliers=[{id:'s1',name:'Sample Supplier'}];state.purchaseBills=[{id:'bill-1',supplier_id:'s1',bill_number:'PUR-0001',bill_date:'2026-08-27',subtotal:1000,discount:0,total_amount:1000,amount_paid:200}];state.paymentAccounts=[{id:'bank-1',name:'Sample Bank',opening_balance:1000}];state.payments.push({id:'order-receipt',walk_in_order_id:'order-1',payment_type:'customer_receipt',payment_number:'RCP-0004',payment_date:'2026-08-27',amount:1000},{id:'supplier-payment',supplier_id:'s1',purchase_bill_id:'bill-1',payment_type:'supplier_payment',payment_number:'PAY-0001',payment_date:'2026-08-27',amount:200});`);
  run(fs.readFileSync(path.join(root,'reports-mobile.js'),'utf8'));
  return {dom,w,run,close:()=>w.close(),order:()=>run("orderInvoiceDocument(state.walkInOrders[0])"),project:()=>run("invoiceDocument(state.invoices[0])"),quote:()=>run("quoteDocument(state.projects[0])")};
}
module.exports={printFixtures};
