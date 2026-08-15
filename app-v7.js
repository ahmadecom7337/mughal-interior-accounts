// Reports and profitability module
let reportTab='profitability';

const reportNum=value=>Number(value||0);
const reportDateOk=value=>{const from=$('#reportFrom').value,to=$('#reportTo').value,date=String(value||'');return(!from||date>=from)&&(!to||date<=to)};
const reportEmpty=(title,text)=>`<div class="empty report-empty"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
const reportSummaryCard=(label,value,note='',tone='')=>`<article class="report-summary-card ${tone}"><span>${esc(label)}</span><strong>${value}</strong>${note?`<small>${esc(note)}</small>`:''}</article>`;

function reportJobRows(){
  const projectFilter=$('#reportProjectFilter').value,partyFilter=$('#reportPartyFilter').value;
  const projects=state.projects.filter(p=>p.status==='Approved').map(p=>{const m=projectMetrics(p);return{kind:'project',id:p.id,number:p.project_number,name:p.name,partyId:p.party_id,party:partyName(p.party_id),date:p.quote_date,status:p.status,revenue:m.revised,materials:m.materials,labour:m.labour,expenses:m.expenses,costs:m.costs,profit:m.profit,received:m.receipts,balance:m.balance}});
  const orders=state.walkInOrders.filter(o=>o.status!=='Cancelled').map(o=>{const m=walkInMetrics(o);return{kind:'walkin',id:o.id,number:o.order_number,name:o.title,partyId:o.party_id,party:o.customer_name,date:o.order_date,status:o.status,revenue:reportNum(o.amount),materials:m.materials,labour:m.labour,expenses:m.expenses,costs:m.costs,profit:m.profit,received:m.receipts,balance:m.balance}});
  return [...projects,...orders].filter(row=>(projectFilter==='all'||projectFilter===`${row.kind}:${row.id}`)&&(partyFilter==='all'||row.partyId===partyFilter)&&reportDateOk(row.date)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}

function reportPaymentRows(){
  const projectFilter=$('#reportProjectFilter').value,partyFilter=$('#reportPartyFilter').value,supplierFilter=$('#reportSupplierFilter').value,accountFilter=$('#reportAccountFilter').value;
  return state.payments.filter(p=>{
    const targetKey=p.project_id?`project:${p.project_id}`:p.walk_in_order_id?`walkin:${p.walk_in_order_id}`:'';
    const entityOk=(projectFilter==='all'||targetKey===projectFilter)&&(partyFilter==='all'||p.party_id===partyFilter),cashOnlyOk=reportTab!=='cashflow'||((supplierFilter==='all'||p.supplier_id===supplierFilter)&&(accountFilter==='all'||p.from_account_id===accountFilter||p.to_account_id===accountFilter));
    return reportDateOk(p.payment_date)&&entityOk&&cashOnlyOk;
  }).sort((a,b)=>String(b.payment_date).localeCompare(String(a.payment_date)));
}

function reportPayableRows(){
  const supplierFilter=$('#reportSupplierFilter').value;
  return state.purchaseBills.filter(b=>b.status!=='Cancelled'&&purchaseBalance(b)>0&&reportDateOk(b.bill_date)&&(supplierFilter==='all'||b.supplier_id===supplierFilter)).sort((a,b)=>String(a.due_date||a.bill_date).localeCompare(String(b.due_date||b.bill_date)));
}

function fillReportFilters(){
  const preserve=(selector,html,valid)=>{const el=$(selector),value=el.value||'all';el.innerHTML=html;el.value=valid(value)?value:'all'};
  preserve('#reportProjectFilter','<option value="all">All projects and orders</option>'+state.projects.map(p=>`<option value="project:${p.id}">${esc(p.name)} - ${esc(partyName(p.party_id))}</option>`).join('')+state.walkInOrders.map(o=>`<option value="walkin:${o.id}">${esc(o.title)} - ${esc(o.customer_name)}</option>`).join(''),value=>value==='all'||state.projects.some(p=>`project:${p.id}`===value)||state.walkInOrders.some(o=>`walkin:${o.id}`===value));
  preserve('#reportPartyFilter','<option value="all">All parties</option>'+state.parties.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(''),value=>value==='all'||state.parties.some(p=>p.id===value));
  preserve('#reportSupplierFilter','<option value="all">All suppliers</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join(''),value=>value==='all'||state.suppliers.some(s=>s.id===value));
  preserve('#reportAccountFilter','<option value="all">All accounts</option>'+state.paymentAccounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join(''),value=>value==='all'||state.paymentAccounts.some(a=>a.id===value));
}

function setReportFilterVisibility(){
  const shown={profitability:['From','To','Project','Party'],cashflow:['From','To','Project','Party','Supplier','Account'],receivables:['From','To','Project','Party'],payables:['From','To','Supplier']}[reportTab];
  ['From','To','Project','Party','Supplier','Account'].forEach(name=>$(`#report${name}Wrap`).classList.toggle('hidden',!shown.includes(name)));
}

function reportJobCard(row,mode){
  const margin=row.revenue?row.profit/row.revenue*100:0,primary=mode==='receivables'?row.balance:row.profit;
  return `<article class="report-job-card"><div class="report-card-head"><div><span>${esc(row.number)}</span><h3>${esc(row.name)}</h3><p>${esc(row.party)} · ${prettyDate(row.date)}</p></div><b class="${primary<0?'negative':''}">${money(primary)}</b></div><div class="report-metrics"><div><span>Sales</span><b>${money(row.revenue)}</b></div>${mode==='receivables'?`<div><span>Received</span><b>${money(row.received)}</b></div><div><span>Balance due</span><b>${money(row.balance)}</b></div>`:`<div><span>Material</span><b>${money(row.materials)}</b></div><div><span>Labour</span><b>${money(row.labour)}</b></div><div><span>Expenses</span><b>${money(row.expenses)}</b></div>`}</div>${mode==='profitability'?`<div class="report-margin"><span style="width:${Math.max(0,Math.min(100,margin))}%"></span></div><small>${margin.toFixed(1)}% estimated margin</small>`:''}</article>`;
}

function renderProfitability(){
  const rows=reportJobRows(),revenue=rows.reduce((s,r)=>s+r.revenue,0),costs=rows.reduce((s,r)=>s+r.costs,0),gross=revenue-costs;
  const payments=reportPaymentRows(),otherIncome=payments.filter(p=>p.payment_type==='income').reduce((s,p)=>s+reportNum(p.amount),0),businessExpenses=payments.filter(p=>p.payment_type==='expense').reduce((s,p)=>s+reportNum(p.amount),0),net=gross+otherIncome-businessExpenses,margin=revenue?net/revenue*100:0;
  $('#reportSummary').innerHTML=reportSummaryCard('Sales value',money(revenue),`${rows.length} approved job${rows.length===1?'':'s'}`,'primary')+reportSummaryCard('Direct job costs',money(costs),'Materials, labour and project expenses')+reportSummaryCard('Estimated gross profit',money(gross),'Sales less direct job costs',gross<0?'negative':'good')+reportSummaryCard('Estimated net profit',money(net),`${margin.toFixed(1)}% net margin`,net<0?'negative':'good');
  $('#reportContent').innerHTML=rows.length?`<div class="report-section-title"><div><p class="eyebrow">JOB PROFITABILITY</p><h2>Projects and orders</h2></div><span>Purchases become cost when material is assigned to a job.</span></div><div class="report-card-grid">${rows.map(row=>reportJobCard(row,'profitability')).join('')}</div>`:reportEmpty('No profitability data','Approve a project or add a walk-in order in this date range.');
}

function renderCashflow(){
  const rows=reportPaymentRows(),accountId=$('#reportAccountFilter').value;
  let moneyIn=0,moneyOut=0;
  rows.forEach(p=>{const amount=reportNum(p.amount);if(accountId!=='all'){if(p.to_account_id===accountId)moneyIn+=amount;if(p.from_account_id===accountId)moneyOut+=amount}else{if(['customer_receipt','income'].includes(p.payment_type))moneyIn+=amount;if(['supplier_payment','expense'].includes(p.payment_type))moneyOut+=amount}});
  const accountBalance=accountId==='all'?state.paymentAccounts.reduce((s,a)=>s+paymentAccountBalance(a),0):paymentAccountBalance(state.paymentAccounts.find(a=>a.id===accountId));
  $('#reportSummary').innerHTML=reportSummaryCard('Money in',money(moneyIn),'Receipts and other income','primary')+reportSummaryCard('Money out',money(moneyOut),'Supplier payments and expenses')+reportSummaryCard('Net cash flow',money(moneyIn-moneyOut),'Transfers excluded from total',moneyIn-moneyOut<0?'negative':'good')+reportSummaryCard('Current balance',money(accountBalance),accountId==='all'?'Across all accounts':paymentAccountName(accountId));
  $('#reportContent').innerHTML=rows.length?`<div class="report-section-title"><div><p class="eyebrow">CASH MOVEMENT</p><h2>Transactions</h2></div><span>${rows.length} transaction${rows.length===1?'':'s'}</span></div><div class="report-transaction-list">${rows.map(paymentCard).join('')}</div>`:reportEmpty('No cash movement','No transactions match the selected filters.');
}

function renderReceivables(){
  const rows=reportJobRows(),dueRows=rows.filter(r=>r.balance>0),sales=rows.reduce((s,r)=>s+r.revenue,0),received=rows.reduce((s,r)=>s+r.received,0),due=dueRows.reduce((s,r)=>s+r.balance,0);
  $('#reportSummary').innerHTML=reportSummaryCard('Customer balance',money(due),`${dueRows.length} job${dueRows.length===1?'':'s'} with balance`,'primary')+reportSummaryCard('Total sales',money(sales),'Approved filtered jobs')+reportSummaryCard('Received',money(received),'Customer receipts recorded','good')+reportSummaryCard('Collection rate',`${sales?Math.min(100,received/sales*100).toFixed(1):'0.0'}%`,'Received against sales');
  $('#reportContent').innerHTML=dueRows.length?`<div class="report-section-title"><div><p class="eyebrow">AMOUNTS TO RECEIVE</p><h2>Customer balances</h2></div></div><div class="report-card-grid">${dueRows.map(row=>reportJobCard(row,'receivables')).join('')}</div>`:reportEmpty('No customer balances','All matching projects and orders are fully received.');
}

function renderPayables(){
  const rows=reportPayableRows(),due=rows.reduce((s,b)=>s+purchaseBalance(b),0),paid=rows.reduce((s,b)=>s+reportNum(b.amount_paid),0),overdueRows=rows.filter(b=>b.due_date&&b.due_date<today()),overdue=overdueRows.reduce((s,b)=>s+purchaseBalance(b),0);
  $('#reportSummary').innerHTML=reportSummaryCard('Supplier balance',money(due),`${rows.length} bill${rows.length===1?'':'s'} due`,'primary')+reportSummaryCard('Overdue',money(overdue),`${overdueRows.length} overdue bill${overdueRows.length===1?'':'s'}`,overdue?'negative':'good')+reportSummaryCard('Paid on these bills',money(paid),'Payments already recorded')+reportSummaryCard('Suppliers due',String(new Set(rows.map(b=>b.supplier_id)).size),'Filtered suppliers');
  $('#reportContent').innerHTML=rows.length?`<div class="report-section-title"><div><p class="eyebrow">AMOUNTS TO PAY</p><h2>Supplier bills</h2></div></div><div class="report-card-grid">${rows.map(b=>`<article class="report-job-card"><div class="report-card-head"><div><span>${esc(b.bill_number)}</span><h3>${esc(supplierName(b.supplier_id))}</h3><p>Bill ${prettyDate(b.bill_date)} · Due ${prettyDate(b.due_date)}</p></div><b class="${b.due_date&&b.due_date<today()?'negative':''}">${money(purchaseBalance(b))}</b></div><div class="report-metrics"><div><span>Bill amount</span><b>${money(b.total_amount)}</b></div><div><span>Paid</span><b>${money(b.amount_paid)}</b></div><div><span>Status</span><b>${esc(b.due_date&&b.due_date<today()?'Overdue':b.payment_status)}</b></div></div></article>`).join('')}</div>`:reportEmpty('No supplier balances','There are no unpaid bills matching these filters.');
}

function renderReports(){
  if(!$('#reportsView'))return;fillReportFilters();setReportFilterVisibility();$$('[data-report-tab]').forEach(button=>button.classList.toggle('active',button.dataset.reportTab===reportTab));
  if(reportTab==='profitability')renderProfitability();if(reportTab==='cashflow')renderCashflow();if(reportTab==='receivables')renderReceivables();if(reportTab==='payables')renderPayables();
}

function reportCsvRows(){
  if(reportTab==='profitability'||reportTab==='receivables')return [['Number','Type','Project / order','Party','Date','Sales','Material','Labour','Expenses','Total cost','Estimated profit','Received','Balance'],...reportJobRows().map(r=>[r.number,r.kind==='project'?'Project':'Walk-in order',r.name,r.party,r.date,r.revenue,r.materials,r.labour,r.expenses,r.costs,r.profit,r.received,r.balance])];
  if(reportTab==='cashflow')return [['Number','Date','Type','Description','Target','From account','To account','Amount'],...reportPaymentRows().map(p=>[p.payment_number,p.payment_date,paymentTypeLabel(p.payment_type),p.description,paymentTargetName(p),paymentAccountName(p.from_account_id),paymentAccountName(p.to_account_id),p.amount])];
  return [['Bill number','Supplier','Bill date','Due date','Bill amount','Paid','Balance'],...reportPayableRows().map(b=>[b.bill_number,supplierName(b.supplier_id),b.bill_date,b.due_date,b.total_amount,b.amount_paid,purchaseBalance(b)])];
}

function exportReportCsv(){
  const csv=reportCsvRows().map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n'),blob=new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`mughal-${reportTab}-report-${today()}.csv`;link.click();URL.revokeObjectURL(url);
}

function reportPrintTable(){const rows=reportCsvRows(),head=rows.shift()||[];return `<table class="report-print-table"><thead><tr>${head.map(cell=>`<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,index)=>`<td class="${index>=5?'number':''}">${typeof cell==='number'?money(cell):esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
function printCurrentReport(){
  renderReports();const title={profitability:'Profitability report',cashflow:'Cash flow report',receivables:'Customer receivables report',payables:'Supplier payables report'}[reportTab],from=$('#reportFrom').value,to=$('#reportTo').value,range=from||to?`${from?prettyDate(from):'Beginning'} to ${to?prettyDate(to):'Today'}`:'All time';
  $('#reportPrintDocument').innerHTML=`<div class="doc-head"><div class="doc-brand"><img class="doc-logo" src="assets/mughal-logo.png?v=2" alt="Mughal Interior"><p>${esc(businessPrintCaption())}</p></div><div class="doc-meta"><b>${esc(title)}</b><p>Period: ${esc(range)}</p><p>Generated: ${prettyDate(today())}</p></div></div><div class="doc-title"><p class="eyebrow">BUSINESS REPORT</p><h1>${esc(title)}</h1></div><div class="report-print-summary">${$('#reportSummary').innerHTML}</div>${reportPrintTable()}`;printSheet('#reportPrintSheet');
}

$$('[data-report-tab]').forEach(button=>button.addEventListener('click',()=>{reportTab=button.dataset.reportTab;renderReports()}));
['#reportFrom','#reportTo','#reportProjectFilter','#reportPartyFilter','#reportSupplierFilter','#reportAccountFilter'].forEach(selector=>$(selector).addEventListener('change',renderReports));
$('#clearReportFiltersBtn').addEventListener('click',()=>{['#reportFrom','#reportTo'].forEach(selector=>$(selector).value='');['#reportProjectFilter','#reportPartyFilter','#reportSupplierFilter','#reportAccountFilter'].forEach(selector=>$(selector).value='all');renderReports()});
$('#exportReportCsvBtn').addEventListener('click',exportReportCsv);$('#printReportBtn').addEventListener('click',printCurrentReport);
