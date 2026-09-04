(() => {
  const reportState={type:null,scope:'overall',csv:[]};
  const singleDateReports=new Set(['receivables','supplierPayables','materialQuantity']);
  const scopedReports=new Set(['profit','customerStatement','supplierStatement','receivables','expenses','labourAssigned','materialCost']);
  const definitions={
    profit:{title:'Profit report',filters:['date']},
    customerStatement:{title:'Customer statement',filters:['date']},
    supplierStatement:{title:'Supplier statement',filters:['date','supplier']},
    receivables:{title:'Receivable report',filters:['asOfDate']},
    expenses:{title:'Expenses report',filters:['date']},
    partnerDrawings:{title:'Banam Ali partner drawings',filters:['date']},
    labourAssigned:{title:'Labour assigned',filters:['date']},
    materialCost:{title:'Material Cost',filters:['date']},
    supplierPayables:{title:'Supplier payables report',filters:['asOfDate','supplier']},
    purchases:{title:'Overall Purchases report',filters:['date','supplier']},
    materialMovement:{title:'Material movement report',filters:['date','material']},
    materialQuantity:{title:'Material quantity',filters:['asOfDate','material']},
    labourStatement:{title:'Labour statement',filters:['date','labour']},
    bankStatement:{title:'Bank Statement',filters:['date','account']}
  };
  const num=value=>Number(value||0);
  const sum=(rows,pick)=>rows.reduce((total,row)=>total+num(pick(row)),0);
  const inRange=value=>{const day=String(value||'').slice(0,10),from=$('#reportFrom').value,to=$('#reportTo').value;return(!from||day>=from)&&(!to||day<=to)};
  const beforeFrom=value=>{const from=$('#reportFrom').value;return Boolean(from&&String(value||'').slice(0,10)<from)};
  const reportEmpty=(title,message)=>`<div class="report-empty"><b>${esc(title)}</b><span>${esc(message)}</span></div>`;
  const table=(headers,rows,classes='')=>`<div class="report-table-wrap"><table class="report-table ${classes}"><thead><tr>${headers.map(label=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const projectName=id=>{const row=project(id);return row?`${row.name} - ${party(row.party_id)?.name||''}`:''};
  const orderName=id=>{const row=walkInOrder(id);return row?`${row.order_number} - ${row.customer_name}`:''};
  const targetName=row=>row.project_id?projectName(row.project_id):row.walk_in_order_id?orderName(row.walk_in_order_id):row.supplier_id?supplier(row.supplier_id)?.name||'Supplier':row.labourer_id?labourer(row.labourer_id)?.name||'Labour':row.party_id?party(row.party_id)?.name||'Party':'Overall business';
  const movementIn=row=>['purchase','adjustment_in','project_return','walk_in_return'].includes(row.movement_type);
  const movementOut=row=>['project_issue','walk_in_issue','adjustment_out'].includes(row.movement_type);
  const movementName=type=>({purchase:'Purchase',adjustment_in:'Stock adjustment in',adjustment_out:'Stock adjustment out',project_issue:'Assigned to project',project_return:'Returned from project',walk_in_issue:'Assigned to order',walk_in_return:'Returned from order'}[type]||type);
  const jobMaterialCost=(kind,id)=>state.materialMovements.filter(row=>(kind==='project'?row.project_id===id:row.walk_in_order_id===id)).reduce((total,row)=>total+(movementOut(row)?1:movementIn(row)?-1:0)*num(row.quantity)*num(row.unit_cost),0);
  const jobLabourCost=(kind,id)=>sum(state.labourAssignments.filter(row=>kind==='project'?row.project_id===id:row.walk_in_order_id===id),assignmentAmount);
  function allExpenseRows(){
    const paymentIds=new Set(state.payments.filter(row=>row.payment_type==='expense').map(row=>row.id));
    return [
      ...state.payments.filter(row=>row.payment_type==='expense').map(row=>({...row,expense_date:row.payment_date,source:'payment'})),
      ...state.entries.filter(row=>row.entry_type==='expense'&&(!row.payment_id||!paymentIds.has(row.payment_id))).map(row=>({...row,expense_date:row.entry_date,source:'project'})),
      ...state.walkInEntries.filter(row=>row.entry_type==='expense'&&(!row.payment_id||!paymentIds.has(row.payment_id))).map(row=>({...row,expense_date:row.entry_date,source:'order'}))
    ];
  }
  const jobExpenseCost=(kind,id)=>sum(allExpenseRows().filter(row=>kind==='project'?row.project_id===id:row.walk_in_order_id===id),row=>row.amount);
  const jobReceipts=(kind,id)=>sum(state.payments.filter(row=>row.payment_type==='customer_receipt'&&(kind==='project'?row.project_id===id:row.walk_in_order_id===id)),row=>row.amount);
  function jobRows(){
    const projects=state.projects.filter(projectFinanciallyActive).map(row=>{const metric=projectMetrics(row),revenue=metric.totalRevenue,materials=metric.openingMaterial+jobMaterialCost('project',row.id),labour=metric.openingLabour+jobLabourCost('project',row.id),expenses=metric.openingExpenses+jobExpenseCost('project',row.id),received=metric.openingReceived+jobReceipts('project',row.id);return{kind:'project',id:row.id,number:row.project_number,name:row.name,customer:party(row.party_id)?.name||'',day:row.quote_date,revenue,materials,labour,expenses,cost:materials+labour+expenses,received,balance:revenue-received,openingProfit:metric.openingProfit,hasOpening:projectHasOpening(row)}});
    const orders=state.walkInOrders.filter(row=>row.status!=='Cancelled').map(row=>{const revenue=num(row.amount),materials=jobMaterialCost('order',row.id),labour=jobLabourCost('order',row.id),expenses=jobExpenseCost('order',row.id),received=jobReceipts('order',row.id);return{kind:'order',id:row.id,number:row.order_number,name:row.title||'Order invoice',customer:row.customer_name||'',day:row.order_date,revenue,materials,labour,expenses,cost:materials+labour+expenses,received,balance:revenue-received}});
    return [...projects,...orders].filter(row=>reportState.scope==='overall'||reportState.scope===`${row.kind}s`).filter(row=>reportState.type==='receivables'&&row.hasOpening||inRange(row.day)).filter(row=>row.kind!=='project'||$('#reportProject').value==='all'||row.id===$('#reportProject').value).filter(row=>row.kind!=='order'||$('#reportOrder').value==='all'||row.id===$('#reportOrder').value);
  }
  function setOutput(content,csv){$('#reportContent').innerHTML=content;reportState.csv=csv;}
  const statementProject=()=>(reportState.type==='receivables'||reportState.type==='customerStatement')&&reportState.scope==='projects'&&$('#reportProject').value!=='all'?project($('#reportProject').value):null;
  const reportPeriod=()=>{
    if(singleDateReports.has(reportState.type))return`As of ${date($('#reportAsOf')?.value||today())}`;
    if(!definitions[reportState.type]?.filters.includes('date')||!$('#reportFrom').value&&!$('#reportTo').value)return'All Dates';
    return`${date($('#reportFrom').value)||'Beginning'} to ${date($('#reportTo').value)||'Latest entry'}`;
  };
  const validReportDates=()=>{
    if(statementProject()||definitions[reportState.type]?.filters.includes('date')){
      return !$('#reportFrom').value||!$('#reportTo').value||$('#reportFrom').value<=$('#reportTo').value;
    }
    if(singleDateReports.has(reportState.type))return Boolean($('#reportAsOf')?.value);
    return true;
  };
  function clearReportDates(){['#reportFrom','#reportTo'].forEach(selector=>$(selector).value='');renderCurrent();}
  function projectStatementRows(job){
    const invoice=state.invoices.find(row=>row.project_id===job.id),metric=projectMetrics(job);
    // Use the invoice date, not the quotation date, when the invoice exists.
    const invoiceDay=invoice?.invoice_date||job.quote_date||String(job.created_at||'').slice(0,10);
    const events=[...(metric.original?[{day:invoiceDay,id:invoice?.id||job.id,rank:0,created:'',description:'Original project amount',reference:invoice?.invoice_number||job.project_number||'',charge:metric.original,receipt:0}]:[]),
      ...metric.entries.filter(row=>['scope_increase','scope_decrease'].includes(row.entry_type)).map(row=>({day:row.entry_date,id:row.id,rank:1,created:row.created_at||'',description:row.entry_type==='scope_decrease'?'Scope deduction':'Scope addition',details:row.description||'',reference:'',charge:(row.entry_type==='scope_decrease'?-1:1)*num(row.amount),receipt:0})),
      // Project-entry receipts mirror payments; read payments only to avoid double counting.
      ...state.payments.filter(row=>row.project_id===job.id&&row.payment_type==='customer_receipt').map(row=>({day:row.payment_date,id:row.id,rank:2,created:row.created_at||'',description:'Payment received',details:row.description||'',reference:row.payment_number||'',charge:0,receipt:num(row.amount)}))
    ].sort((a,b)=>String(a.day||'').localeCompare(String(b.day||''))||a.rank-b.rank||a.created.localeCompare(b.created)||String(a.id||'').localeCompare(String(b.id||'')));
    const cents=value=>Math.round(num(value)*100);
    let balance=cents(metric.openingReceivable)+events.filter(row=>beforeFrom(row.day)).reduce((total,row)=>total+cents(row.charge)-cents(row.receipt),0);
    const opening=balance/100,rows=[];
    if(metric.openingReceivable||$('#reportFrom').value)rows.push({day:$('#reportFrom').value||String(job.created_at||job.quote_date||today()).slice(0,10),description:'Opening balance brought forward',details:metric.openingInvoice?`Invoice ${money(metric.openingInvoice)} · received to date ${money(metric.openingReceived)}`:'',reference:'',charge:opening,receipt:null,balance:opening,opening:true});
    let charges=0,receipts=0;
    events.filter(row=>inRange(row.day)).forEach(row=>{const charge=cents(row.charge),receipt=cents(row.receipt);balance+=charge-receipt;charges+=charge;receipts+=receipt;rows.push({...row,balance:balance/100})});
    return{rows,opening,charges:charges/100,receipts:receipts/100,closing:balance/100};
  }
  function renderProjectStatement(job){
    if(!projectFinanciallyActive(job)){setOutput(reportEmpty('No project receivable','This project has no approved invoice or opening receivable.'),[]);return;}
    const customer=party(job.party_id),ledger=projectStatementRows(job);
    const body=ledger.rows.map(row=>`<tr class="${row.opening?'statement-opening':''}"><td>${date(row.day)}</td><td><b>${esc(row.description)}</b>${row.reference?`<small>${esc(row.reference)}</small>`:''}${row.details?`<small>${esc(row.details)}</small>`:''}</td><td class="number ${row.charge<0?'report-negative':''}">${row.charge||row.opening?money(row.charge):''}</td><td class="number report-positive">${row.receipt?money(row.receipt):''}</td><td class="number report-balance ${row.balance<0?'report-positive':''}">${money(row.balance)}</td></tr>`);
    body.push(`<tr class="statement-total"><td></td><td><b>Period totals / closing balance</b></td><td class="number">${money(ledger.charges)}</td><td class="number report-positive">${money(ledger.receipts)}</td><td class="number ${ledger.closing<0?'report-positive':''}">${money(ledger.closing)}</td></tr>`);
    const isCust=reportState.type==='customerStatement';
    const amountLabel=isCust?'Invoiced':'Project amount / opening';
    const html=`<article class="project-statement"><header class="statement-heading"><div><p>${isCust?'CUSTOMER STATEMENT':'PROJECT RECEIVABLE STATEMENT'}</p><h2>${esc(state.business?.name||'Mughal Interior')}</h2><span>${esc(reportPeriod())}</span></div><img src="assets/mughal-logo.png" alt="Company logo"></header><div class="statement-parties"><div><small>CUSTOMER</small><b>${esc(customer?.name||'')}</b><span>${esc(customer?.phone||'')}</span><span>${esc(customer?.address||'')}</span></div><div><small>PROJECT</small><b>${esc(job.name)}</b><span>${esc(job.project_number||'')}</span><span>${esc(job.location||'')}</span></div></div>${table(['Date','Description / reference',amountLabel,'Receipts','Balance'],body,'statement-table')}<p class="statement-note">${ledger.closing<0?'Negative balance represents customer credit.':'Balance represents the amount receivable from the customer.'} Period totals exclude the opening balance. Generated ${esc(date(today()))}.</p></article>`;
    setOutput(html,[[isCust?'Customer statement':'Project receivable statement'],['Business',state.business?.name||'Mughal Interior'],['Customer',customer?.name||''],['Project',job.name],['Project ID',job.project_number||''],['Period',reportPeriod()],[],['Date','Description','Reference','Details',amountLabel,'Receipts','Balance'],...ledger.rows.map(row=>[row.day,row.description,row.reference,row.details||'',row.charge,row.receipt??'',row.balance]),['','Period totals / closing balance','','',ledger.charges,ledger.receipts,ledger.closing]]);
  }
  function renderProfit(){
    const rows=jobRows(),revenue=sum(rows,row=>row.revenue),direct=sum(rows,row=>row.cost),overheads=reportState.scope==='overall'?sum(state.payments.filter(row=>row.payment_type==='expense'&&!row.project_id&&!row.walk_in_order_id&&inRange(row.payment_date)),row=>row.amount):0,profit=revenue-direct-overheads,margin=revenue?profit/revenue*100:0;
    const body=rows.map(row=>`<tr><td><b>${esc(row.name)}</b><small>${esc(row.number)} · ${esc(row.customer)}</small></td><td class="number">${money(row.revenue)}</td><td class="number">${money(row.materials)}</td><td class="number">${money(row.labour)}</td><td class="number">${money(row.expenses)}</td><td class="number">${money(row.revenue-row.cost)}</td></tr>`);
    const csv=[['Number','Type','Project / order','Customer','Date','Sales','Material','Labour','Expenses','Profit'],...rows.map(row=>[row.number,row.kind,row.name,row.customer,row.day,row.revenue,row.materials,row.labour,row.expenses,row.revenue-row.cost])];
    if(overheads){body.push(`<tr><td><b>Business overheads</b></td><td class="number">${money(0)}</td><td class="number">${money(0)}</td><td class="number">${money(0)}</td><td class="number">${money(overheads)}</td><td class="number report-negative">${money(-overheads)}</td></tr>`);csv.push(['','business','Business overheads','','',0,0,0,overheads,-overheads]);}
    if(rows.length||overheads){body.push(`<tr class="statement-total"><td><b>Net profit / loss</b></td><td class="number">${money(revenue)}</td><td class="number">${money(sum(rows,row=>row.materials))}</td><td class="number">${money(sum(rows,row=>row.labour))}</td><td class="number">${money(sum(rows,row=>row.expenses)+overheads)}</td><td class="number ${profit<0?'report-negative':'report-positive'}">${money(profit)}</td></tr>`);csv.push(['','','Net profit / loss','','',revenue,sum(rows,row=>row.materials),sum(rows,row=>row.labour),sum(rows,row=>row.expenses)+overheads,profit]);}
    setOutput(body.length?table(['Project / order','Sales','Material','Labour','Expenses','Profit'],body):reportEmpty('No profit data','No matching approved projects or orders.'),csv);
  }
  function receivableRows(asOfDate){
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)?asOfDate:/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today();
    const projects=state.projects.filter(projectFinanciallyActive).map(row=>{
      const invoice=state.invoices.find(r=>r.project_id===row.id);
      const invoiceDay=invoice?.invoice_date||row.quote_date||String(row.created_at||'').slice(0,10);
      const metric=projectMetrics(row);
      const hasInvoice=Boolean(invoiceDay&&invoiceDay<=asOf);
      const original=hasInvoice?metric.original:0;
      const scopeChanges=metric.entries
        .filter(e=>['scope_increase','scope_decrease'].includes(e.entry_type)&&(!e.entry_date||String(e.entry_date).slice(0,10)<=asOf))
        .reduce((s,e)=>s+(e.entry_type==='scope_decrease'?-num(e.amount):num(e.amount)),0);
      const invoiced=metric.openingInvoice+original+scopeChanges;
      const received=metric.openingReceived+sum(state.payments.filter(p=>p.project_id===row.id&&p.payment_type==='customer_receipt'&&(!p.payment_date||String(p.payment_date).slice(0,10)<=asOf)),p=>p.amount);
      const balance=invoiced-received;
      const isRelevant=hasInvoice||projectHasOpening(row)||invoiced>0||received>0;
      return{kind:'project',id:row.id,number:row.project_number,name:row.name,customer:party(row.party_id)?.name||'',day:invoiceDay,revenue:invoiced,received,balance,isRelevant};
    }).filter(row=>row.isRelevant);

    const orders=state.walkInOrders.filter(row=>row.status!=='Cancelled').map(row=>{
      const orderDay=String(row.order_date||'').slice(0,10);
      const orderExists=!orderDay||orderDay<=asOf;
      const revenue=orderExists?num(row.amount):0;
      const received=sum(state.payments.filter(p=>p.walk_in_order_id===row.id&&p.payment_type==='customer_receipt'&&(!p.payment_date||String(p.payment_date).slice(0,10)<=asOf)),p=>p.amount);
      const balance=revenue-received;
      const isRelevant=orderExists||received>0;
      return{kind:'order',id:row.id,number:row.order_number,name:row.title||'Order invoice',customer:row.customer_name||'',day:orderDay,revenue,received,balance,isRelevant};
    }).filter(row=>row.isRelevant);

    return [...projects,...orders]
      .filter(row=>reportState.scope==='overall'||reportState.scope===`${row.kind}s`)
      .filter(row=>row.kind!=='project'||$('#reportProject').value==='all'||row.id===$('#reportProject').value)
      .filter(row=>row.kind!=='order'||$('#reportOrder').value==='all'||row.id===$('#reportOrder').value);
  }
  function renderReceivables(){
    const selectedProject=statementProject();if(selectedProject){renderProjectStatement(selectedProject);return;}
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today();
    const rows=receivableRows(asOf),sales=sum(rows,row=>row.revenue),received=sum(rows,row=>row.received),balance=sales-received;
    const body=rows.map(row=>`<tr><td><b>${esc(row.name)}</b><small>${esc(row.number)} · ${esc(row.customer)}</small></td><td class="number">${money(row.revenue)}</td><td class="number report-positive">${money(row.received)}</td><td class="number ${row.balance<0?'report-positive':row.balance>0?'report-negative':''}">${money(row.balance)}</td></tr>`);
    if(rows.length){body.push(`<tr class="statement-total"><td><b>Total receivables</b><small>As of ${esc(date(asOf))}</small></td><td class="number">${money(sales)}</td><td class="number report-positive">${money(received)}</td><td class="number ${balance<0?'report-positive':balance>0?'report-negative':''}">${money(balance)}</td></tr>`);}
    setOutput(rows.length?table(['Project / order','Invoice','Received','Balance'],body,'compact'):reportEmpty('No receivables','No matching projects or orders as of this date.'),[['Number','Type','Project / order','Customer','Invoice','Received','Balance'],...rows.map(row=>[row.number,row.kind,row.name,row.customer,row.revenue,row.received,row.balance]),['','','Total','',sales,received,balance]]);
  }
  function renderOrderStatement(order){
    const events=[
      {day:order.order_date,id:order.id,rank:0,created:'',description:'Order invoice',reference:order.order_number,details:order.title||'',charge:num(order.amount),receipt:0},
      ...state.payments.filter(p=>p.walk_in_order_id===order.id&&p.payment_type==='customer_receipt').map(p=>({day:p.payment_date,id:p.id,rank:1,created:p.created_at||'',description:'Payment received',reference:p.payment_number||'',details:p.description||'',charge:0,receipt:num(p.amount)}))
    ].sort((a,b)=>String(a.day||'').localeCompare(String(b.day||''))||a.rank-b.rank||String(a.id||'').localeCompare(String(b.id||'')));
    const cents=v=>Math.round(num(v)*100);
    let balance=events.filter(e=>beforeFrom(e.day)).reduce((t,e)=>t+cents(e.charge)-cents(e.receipt),0);
    const opening=balance/100,rows=[];
    if($('#reportFrom').value&&opening!==0)rows.push({day:$('#reportFrom').value,description:'Opening balance brought forward',details:'',reference:'',charge:opening,receipt:null,balance:opening,opening:true});
    let charges=0,receipts=0;
    events.filter(e=>inRange(e.day)).forEach(e=>{const c=cents(e.charge),r=cents(e.receipt);balance+=c-r;charges+=c;receipts+=r;rows.push({...e,balance:balance/100})});
    const closing=balance/100;
    const body=rows.map(row=>`<tr class="${row.opening?'statement-opening':''}"><td>${date(row.day)}</td><td><b>${esc(row.description)}</b>${row.reference?`<small>${esc(row.reference)}</small>`:''}${row.details?`<small>${esc(row.details)}</small>`:''}</td><td class="number ${row.charge<0?'report-negative':''}">${row.charge||row.opening?money(row.charge):''}</td><td class="number report-positive">${row.receipt?money(row.receipt):''}</td><td class="number report-balance ${row.balance<0?'report-positive':''}">${money(row.balance)}</td></tr>`);
    body.push(`<tr class="statement-total"><td></td><td><b>Period totals / closing balance</b></td><td class="number">${money(charges/100)}</td><td class="number report-positive">${money(receipts/100)}</td><td class="number ${closing<0?'report-positive':''}">${money(closing)}</td></tr>`);
    const html=`<article class="project-statement"><header class="statement-heading"><div><p>CUSTOMER ORDER STATEMENT</p><h2>${esc(state.business?.name||'Mughal Interior')}</h2><span>${esc(reportPeriod())}</span></div><img src="assets/mughal-logo.png" alt="Company logo"></header><div class="statement-parties"><div><small>CUSTOMER</small><b>${esc(order.customer_name||'Walk-in customer')}</b><span>${esc(order.customer_phone||'')}</span></div><div><small>ORDER</small><b>${esc(order.title||'Order invoice')}</b><span>${esc(order.order_number||'')}</span></div></div>${table(['Date','Description / reference','Invoiced','Receipts','Balance'],body,'statement-table')}<p class="statement-note">Period totals exclude the opening balance. Generated ${esc(date(today()))}.</p></article>`;
    setOutput(html,[['Customer order statement'],['Business',state.business?.name||'Mughal Interior'],['Customer',order.customer_name||''],['Order',order.order_number||''],['Period',reportPeriod()],[],['Date','Description','Reference','Details','Invoiced','Receipts','Balance'],...rows.map(r=>[r.day,r.description,r.reference,r.details||'',r.charge,r.receipt??'',r.balance]),['','Period totals / closing balance','','',charges/100,receipts/100,closing]]);
  }
  function customerStatementRows(){
    const projects=state.projects.filter(projectFinanciallyActive).map(job=>{
      const invoice=state.invoices.find(r=>r.project_id===job.id);
      const invoiceDay=invoice?.invoice_date||job.quote_date||String(job.created_at||'').slice(0,10);
      const metric=projectMetrics(job);
      const invoiceIn=inRange(invoiceDay)?metric.original:0;
      const scopeIn=metric.entries
        .filter(e=>['scope_increase','scope_decrease'].includes(e.entry_type)&&inRange(e.entry_date))
        .reduce((s,e)=>s+(e.entry_type==='scope_decrease'?-num(e.amount):num(e.amount)),0);
      const receiptsIn=sum(state.payments.filter(p=>p.project_id===job.id&&p.payment_type==='customer_receipt'&&inRange(p.payment_date)),p=>p.amount);
      const cents=v=>Math.round(num(v)*100);
      const beforeInvoiced=(beforeFrom(invoiceDay)?cents(metric.original):0)+cents(metric.entries.filter(e=>['scope_increase','scope_decrease'].includes(e.entry_type)&&beforeFrom(e.entry_date)).reduce((s,e)=>s+(e.entry_type==='scope_decrease'?-num(e.amount):num(e.amount)),0));
      const beforeReceipts=cents(sum(state.payments.filter(p=>p.project_id===job.id&&p.payment_type==='customer_receipt'&&beforeFrom(p.payment_date)),p=>p.amount));
      const opening=(cents(metric.openingReceivable)+beforeInvoiced-beforeReceipts)/100;
      const invoiced=!$('#reportFrom').value&&!$('#reportTo').value?metric.totalRevenue:(invoiceIn+scopeIn);
      const received=!$('#reportFrom').value&&!$('#reportTo').value?(metric.openingReceived+jobReceipts('project',job.id)):receiptsIn;
      const balance=!$('#reportFrom').value&&!$('#reportTo').value?(invoiced-received):(opening+invoiced-received);
      const hasActivity=Boolean(opening!==0||invoiced!==0||received!==0||inRange(invoiceDay));
      return{kind:'project',id:job.id,number:job.project_number,name:job.name,customer:party(job.party_id)?.name||'Customer',day:invoiceDay,opening,invoiced,received,balance,hasActivity};
    }).filter(r=>r.hasActivity);

    const orders=state.walkInOrders.filter(row=>row.status!=='Cancelled').map(order=>{
      const day=String(order.order_date||'').slice(0,10);
      const cents=v=>Math.round(num(v)*100);
      const beforeBilled=beforeFrom(day)?cents(order.amount):0;
      const beforePaid=cents(sum(state.payments.filter(p=>p.walk_in_order_id===order.id&&p.payment_type==='customer_receipt'&&beforeFrom(p.payment_date)),p=>p.amount));
      const opening=(beforeBilled-beforePaid)/100;
      const billedIn=inRange(day)?num(order.amount):0;
      const receiptsIn=sum(state.payments.filter(p=>p.walk_in_order_id===order.id&&p.payment_type==='customer_receipt'&&inRange(p.payment_date)),p=>p.amount);
      const invoiced=!$('#reportFrom').value&&!$('#reportTo').value?num(order.amount):billedIn;
      const received=!$('#reportFrom').value&&!$('#reportTo').value?jobReceipts('order',order.id):receiptsIn;
      const balance=!$('#reportFrom').value&&!$('#reportTo').value?(invoiced-received):(opening+invoiced-received);
      const hasActivity=Boolean(opening!==0||invoiced!==0||received!==0||inRange(day));
      return{kind:'order',id:order.id,number:order.order_number,name:order.title||'Order invoice',customer:order.customer_name||'Walk-in customer',day,opening,invoiced,received,balance,hasActivity};
    }).filter(r=>r.hasActivity);

    return [...projects,...orders]
      .filter(row=>reportState.scope==='overall'||reportState.scope===`${row.kind}s`)
      .filter(row=>row.kind!=='project'||$('#reportProject').value==='all'||row.id===$('#reportProject').value)
      .filter(row=>row.kind!=='order'||$('#reportOrder').value==='all'||row.id===$('#reportOrder').value);
  }
  function renderCustomerStatement(){
    const selectedProject=statementProject();if(selectedProject){renderProjectStatement(selectedProject);return;}
    const orderId=$('#reportOrder').value;
    if(reportState.scope==='orders'&&orderId!=='all'){
      const order=walkInOrder(orderId);
      if(!order){setOutput(reportEmpty('Order not found','Select a valid order.'),[]);return;}
      renderOrderStatement(order);
      return;
    }
    const rows=customerStatementRows(),invoiced=sum(rows,r=>r.invoiced),received=sum(rows,r=>r.received),balance=sum(rows,r=>r.balance);
    const body=rows.map(row=>`<tr><td><b>${esc(row.customer||'Customer')}</b><small>${esc(row.name)} · ${esc(row.number)}</small></td><td>${date(row.day)}</td><td class="number">${money(row.invoiced)}</td><td class="number report-positive">${money(row.received)}</td><td class="number ${row.balance<0?'report-positive':row.balance>0?'report-negative':''}">${money(row.balance)}</td></tr>`);
    if(rows.length){body.push(`<tr class="statement-total"><td colspan="2"><b>Total customer statement</b><small>${esc(reportPeriod())}</small></td><td class="number">${money(invoiced)}</td><td class="number report-positive">${money(received)}</td><td class="number ${balance<0?'report-positive':balance>0?'report-negative':''}">${money(balance)}</td></tr>`);}
    setOutput(rows.length?table(['Customer / Job','Date','Invoiced','Receipts','Balance'],body,'report-ledger'):reportEmpty('No customer data','No matching projects or orders found for this period.'),[['Customer','Project / order','Number','Date','Invoiced','Receipts','Balance'],...rows.map(row=>[row.customer,row.name,row.number,row.day,row.invoiced,row.received,row.balance]),['','Total','','',invoiced,received,balance]]);
  }
  function expenseRows(){return allExpenseRows().filter(row=>inRange(row.expense_date)).filter(row=>reportState.scope==='overall'||reportState.scope==='projects'&&row.project_id||reportState.scope==='orders'&&row.walk_in_order_id).filter(row=>reportState.scope!=='projects'||$('#reportProject').value==='all'||row.project_id===$('#reportProject').value).filter(row=>reportState.scope!=='orders'||$('#reportOrder').value==='all'||row.walk_in_order_id===$('#reportOrder').value)}
  function renderExpenses(){
    const rows=expenseRows(),general=sum(rows.filter(row=>!row.project_id&&!row.walk_in_order_id),row=>row.amount),projects=sum(rows.filter(row=>row.project_id),row=>row.amount),orders=sum(rows.filter(row=>row.walk_in_order_id),row=>row.amount);
    const body=rows.map(row=>`<tr><td>${date(row.expense_date)}</td><td><b>${esc(expenseCategory(row.expense_category_id)?.name||row.description||'Expense')}</b><small>${esc(row.notes||'')}</small></td><td>${esc(targetName(row))}</td><td>${esc(account(row.from_account_id)?.name||'Charged')}</td><td class="number">${money(row.amount)}</td></tr>`);
    setOutput(rows.length?table(['Date','Expense','Charged to','Account','Amount'],body):reportEmpty('No expenses','No matching expense entries.'),[['Date','Expense','Details','Charged to','Account','Amount'],...rows.map(row=>[row.expense_date,expenseCategory(row.expense_category_id)?.name||row.description,row.notes,targetName(row),account(row.from_account_id)?.name||'Charged',row.amount])]);
  }
  function assignedRows(){return state.labourAssignments.filter(row=>inRange(row.assignment_date)).filter(row=>reportState.scope==='overall'||reportState.scope==='projects'&&row.project_id||reportState.scope==='orders'&&row.walk_in_order_id).filter(row=>reportState.scope!=='projects'||$('#reportProject').value==='all'||row.project_id===$('#reportProject').value).filter(row=>reportState.scope!=='orders'||$('#reportOrder').value==='all'||row.walk_in_order_id===$('#reportOrder').value)}
  function renderLabourAssigned(){
    const rows=assignedRows(),days=sum(rows,row=>row.days),wages=sum(rows,assignmentAmount);
    const body=rows.map(row=>`<tr><td>${date(row.assignment_date)}</td><td><b>${esc(labourer(row.labourer_id)?.name||'Labour')}</b><small>${esc(row.notes||'')}</small></td><td>${esc(targetName(row))}</td><td class="number">${qty(row.days)}</td><td class="number">${money(row.daily_rate)}</td><td class="number">${money(assignmentAmount(row))}</td></tr>`);
    setOutput(rows.length?table(['Date','Labour','Project / order','Days','Rate','Cost'],body):reportEmpty('No labour assigned','No matching labour assignments.'),[['Date','Labour','Project / order','Days','Daily rate','Cost','Details'],...rows.map(row=>[row.assignment_date,labourer(row.labourer_id)?.name,targetName(row),row.days,row.daily_rate,assignmentAmount(row),row.notes])]);
  }
  function materialCostRows(){return state.materialMovements.filter(row=>inRange(row.movement_date)&&(movementOut(row)||['project_return','walk_in_return'].includes(row.movement_type))).filter(row=>reportState.scope==='overall'||reportState.scope==='projects'&&row.project_id||reportState.scope==='orders'&&row.walk_in_order_id).filter(row=>reportState.scope!=='projects'||$('#reportProject').value==='all'||row.project_id===$('#reportProject').value).filter(row=>reportState.scope!=='orders'||$('#reportOrder').value==='all'||row.walk_in_order_id===$('#reportOrder').value)}
  function renderMaterialCost(){
    const rows=materialCostRows(),net=sum(rows,row=>(movementOut(row)?1:-1)*num(row.quantity)*num(row.unit_cost));
    const body=rows.map(row=>{const returned=['project_return','walk_in_return'].includes(row.movement_type),value=num(row.quantity)*num(row.unit_cost),item=material(row.material_id),pool=isConsumable(item);return`<tr><td>${date(row.movement_date)}</td><td><b>${esc(item?.name||'Material')}</b><small>${returned?'Returned':'Assigned'}${row.notes?` · ${esc(row.notes)}`:''}</small></td><td>${esc(targetName(row))}</td><td class="number">${pool?'Amount based':`${returned?'−':''}${qty(row.quantity)} ${esc(item?.unit||'')}`}</td><td class="number ${returned?'report-positive':''}">${returned?'−':''}${money(value)}</td></tr>`});
    setOutput(rows.length?table(['Date','Material','Project / order','Quantity','Cost'],body):reportEmpty('No material cost','No matching assignments or returns.'),[['Date','Material','Movement','Project / order','Quantity','Unit','Unit cost','Net cost'],...rows.map(row=>[row.movement_date,material(row.material_id)?.name,movementName(row.movement_type),targetName(row),row.quantity,material(row.material_id)?.unit,row.unit_cost,(movementOut(row)?1:-1)*num(row.quantity)*num(row.unit_cost)])]);
  }
  function supplierPayablesAsOf(asOfDate){
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)?asOfDate:/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today();
    const supplierId=$('#reportSupplier').value,suppliers=state.suppliers.filter(row=>supplierId==='all'||row.id===supplierId);
    const results=[];
    suppliers.forEach(sup=>{
      const openingAmount=num(sup.opening_amount);
      const bills=state.purchaseBills
        .filter(b=>b.supplier_id===sup.id&&b.status!=='Cancelled'&&(!b.bill_date||String(b.bill_date).slice(0,10)<=asOf))
        .sort((a,b)=>`${a.bill_date}${a.created_at||''}`.localeCompare(`${b.bill_date}${b.created_at||''}`));
      const payments=state.payments
        .filter(p=>p.supplier_id===sup.id&&p.payment_type==='supplier_payment'&&(!p.payment_date||String(p.payment_date).slice(0,10)<=asOf))
        .sort((a,b)=>`${a.payment_date}${a.created_at||''}`.localeCompare(`${b.payment_date}${b.created_at||''}`));
      let totalPaid=sum(payments,p=>p.amount);
      let openingPaid=Math.min(totalPaid,openingAmount);
      let remainingForBills=totalPaid-openingPaid;
      let openingDue=openingAmount-openingPaid;

      const billEntries=bills.map(bill=>{
        const total=num(bill.total_amount);
        const paid=Math.min(remainingForBills,total);
        remainingForBills-=paid;
        return{
          bill,
          supplierName:sup.name,
          billNumber:bill.bill_number,
          billDate:bill.bill_date,
          totalAmount:total,
          amountPaid:paid,
          balance:total-paid
        };
      });
      if(remainingForBills>0&&billEntries.length){
        billEntries[billEntries.length-1].amountPaid+=remainingForBills;
        billEntries[billEntries.length-1].balance-=remainingForBills;
      }
      results.push({
        supplier:sup,
        openingAmount,
        openingPaid,
        openingDue,
        bills:billEntries,
        hasActivity:openingAmount>0||bills.length>0||payments.length>0
      });
    });
    return results;
  }
  function renderSupplierPayables(){
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today();
    const data=supplierPayablesAsOf(asOf);
    const body=[],csv=[['Bill number','Date','Supplier','Bill amount','Paid','Balance']];
    data.forEach(item=>{
      if(item.openingAmount>0){
        body.push(`<tr class="statement-opening"><td><b>Opening balance</b></td><td>${esc(item.supplier.name)}</td><td class="number">${money(item.openingAmount)}</td><td class="number report-positive">${money(item.openingPaid)}</td><td class="number ${item.openingDue>0?'report-negative':''}">${money(item.openingDue)}</td></tr>`);
        csv.push(['Opening balance','',item.supplier.name,item.openingAmount,item.openingPaid,item.openingDue]);
      }
      item.bills.forEach(b=>{
        body.push(`<tr><td><b>${esc(b.billNumber)}</b><small>${date(b.billDate)}</small></td><td>${esc(item.supplier.name)}</td><td class="number">${money(b.totalAmount)}</td><td class="number report-positive">${money(b.amountPaid)}</td><td class="number ${b.balance>0?'report-negative':b.balance<0?'report-positive':''}">${money(b.balance)}</td></tr>`);
        csv.push([b.billNumber,b.billDate,item.supplier.name,b.totalAmount,b.amountPaid,b.balance]);
      });
    });
    const totalBills=sum(data,d=>d.openingAmount+sum(d.bills,b=>b.totalAmount));
    const totalPaid=sum(data,d=>d.openingPaid+sum(d.bills,b=>b.amountPaid));
    const totalDue=sum(data,d=>d.openingDue+sum(d.bills,b=>b.balance));
    if(body.length){
      body.push(`<tr class="statement-total"><td><b>Total payables</b><small>As of ${esc(date(asOf))}</small></td><td></td><td class="number">${money(totalBills)}</td><td class="number report-positive">${money(totalPaid)}</td><td class="number ${totalDue>0?'report-negative':totalDue<0?'report-positive':''}">${money(totalDue)}</td></tr>`);
      csv.push(['','','Total',totalBills,totalPaid,totalDue]);
    }
    setOutput(body.length?table(['Purchase','Supplier','Bill amount','Paid','Balance'],body,'compact'):reportEmpty('No supplier payables','No opening amount or bills match as of this date.'),csv);
  }
  function renderSingleSupplierStatement(sup){
    const cents=v=>Math.round(num(v)*100);
    const bills=state.purchaseBills.filter(b=>b.supplier_id===sup.id&&b.status!=='Cancelled').map(b=>({
      day:b.bill_date,id:b.id,rank:1,created:b.created_at||'',description:`Bill ${b.bill_number}`,reference:b.bill_number,
      details:purchaseLines(b.id).length?`${purchaseLines(b.id).length} item(s)`:b.notes||'',billed:num(b.total_amount),paid:0
    }));
    const payments=state.payments.filter(p=>p.supplier_id===sup.id&&p.payment_type==='supplier_payment').map(p=>({
      day:p.payment_date,id:p.id,rank:2,created:p.created_at||'',description:'Supplier payment',reference:p.payment_number||'',
      details:p.description||account(p.from_account_id)?.name||'',billed:0,paid:num(p.amount)
    }));
    const events=[...bills,...payments].sort((a,b)=>String(a.day||'').localeCompare(String(b.day||''))||a.rank-b.rank||a.created.localeCompare(b.created)||String(a.id||'').localeCompare(String(b.id||'')));
    let balance=cents(sup.opening_amount)+events.filter(e=>beforeFrom(e.day)).reduce((t,e)=>t+cents(e.billed)-cents(e.paid),0);
    const opening=balance/100,rows=[];
    if(num(sup.opening_amount)||($('#reportFrom').value&&opening!==0)){
      rows.push({day:$('#reportFrom').value||String(sup.created_at||today()).slice(0,10),description:'Opening balance brought forward',reference:'',details:num(sup.opening_amount)?`Initial opening: ${money(sup.opening_amount)}`:'',billed:opening,paid:null,balance:opening,opening:true});
    }
    let totalBilled=0,totalPaid=0;
    events.filter(e=>inRange(e.day)).forEach(e=>{
      const b=cents(e.billed),p=cents(e.paid);
      balance+=b-p;totalBilled+=b;totalPaid+=p;
      rows.push({...e,balance:balance/100});
    });
    const closing=balance/100;
    const body=rows.map(row=>`<tr class="${row.opening?'statement-opening':''}"><td>${date(row.day)}</td><td><b>${esc(row.description)}</b>${row.reference?`<small>${esc(row.reference)}</small>`:''}${row.details?`<small>${esc(row.details)}</small>`:''}</td><td class="number">${row.billed||row.opening?money(row.billed):''}</td><td class="number report-positive">${row.paid?money(row.paid):''}</td><td class="number report-balance ${row.balance>0?'report-negative':row.balance<0?'report-positive':''}">${money(row.balance)}</td></tr>`);
    body.push(`<tr class="statement-total"><td></td><td><b>Period totals / closing balance</b></td><td class="number">${money(totalBilled/100)}</td><td class="number report-positive">${money(totalPaid/100)}</td><td class="number ${closing>0?'report-negative':closing<0?'report-positive':''}">${money(closing)}</td></tr>`);
    const html=`<article class="project-statement"><header class="statement-heading"><div><p>SUPPLIER STATEMENT</p><h2>${esc(state.business?.name||'Mughal Interior')}</h2><span>${esc(reportPeriod())}</span></div><img src="assets/mughal-logo.png" alt="Company logo"></header><div class="statement-parties"><div><small>SUPPLIER</small><b>${esc(sup.name)}</b><span>${esc(sup.phone||'')}</span><span>${esc(sup.company_name||sup.address||'')}</span></div><div><small>TYPE</small><b>Supplier Ledger</b><span>Generated ${esc(date(today()))}</span></div></div>${table(['Date','Description / reference','Bills (Invoiced)','Paid','Balance'],body,'statement-table')}<p class="statement-note">${closing>0?'Amount payable to supplier.':'Supplier account in credit.'} Period totals exclude the opening balance.</p></article>`;
    setOutput(html,[['Supplier statement'],['Business',state.business?.name||'Mughal Interior'],['Supplier',sup.name],['Period',reportPeriod()],[],['Date','Description','Reference','Details','Bills','Paid','Balance'],...rows.map(r=>[r.day,r.description,r.reference,r.details||'',r.billed,r.paid??'',r.balance]),['','Period totals / closing balance','','',totalBilled/100,totalPaid/100,closing]]);
  }
  function renderSupplierStatement(){
    const supplierId=$('#reportSupplier').value;
    if(supplierId!=='all'){
      const sup=supplier(supplierId);
      if(!sup){setOutput(reportEmpty('Supplier not found','Select a valid supplier.'),[]);return;}
      renderSingleSupplierStatement(sup);
      return;
    }
    const suppliers=state.suppliers;
    const rows=suppliers.map(sup=>{
      const bills=state.purchaseBills.filter(b=>b.supplier_id===sup.id&&b.status!=='Cancelled'&&inRange(b.bill_date));
      const payments=state.payments.filter(p=>p.supplier_id===sup.id&&p.payment_type==='supplier_payment'&&inRange(p.payment_date));
      const billed=sum(bills,b=>b.total_amount);
      const paid=sum(payments,p=>p.amount);
      const bal=supplierBalance(sup.id);
      return{sup,billed,paid,balance:bal,hasActivity:num(sup.opening_amount)>0||billed>0||paid>0};
    }).filter(r=>r.hasActivity);
    const totalBilled=sum(rows,r=>r.billed),totalPaid=sum(rows,r=>r.paid),totalBalance=sum(rows,r=>r.balance);
    const body=rows.map(r=>`<tr><td><b>${esc(r.sup.name)}</b><small>${esc(r.sup.phone||r.sup.company_name||'')}</small></td><td class="number">${money(r.billed)}</td><td class="number report-positive">${money(r.paid)}</td><td class="number ${r.balance>0?'report-negative':r.balance<0?'report-positive':''}">${money(r.balance)}</td></tr>`);
    if(rows.length){
      body.push(`<tr class="statement-total"><td><b>Total supplier statement</b><small>${esc(reportPeriod())}</small></td><td class="number">${money(totalBilled)}</td><td class="number report-positive">${money(totalPaid)}</td><td class="number ${totalBalance>0?'report-negative':totalBalance<0?'report-positive':''}">${money(totalBalance)}</td></tr>`);
    }
    setOutput(rows.length?table(['Supplier','Bills (Invoiced)','Paid','Balance'],body,'compact'):reportEmpty('No supplier data','No supplier activity matches these filters.'),[['Supplier','Bills','Paid','Balance'],...rows.map(r=>[r.sup.name,r.billed,r.paid,r.balance]),['Total',totalBilled,totalPaid,totalBalance]]);
  }
  function renderPurchases(){
    const supplierId=$('#reportSupplier').value,rows=state.purchaseBills.filter(row=>row.status!=='Cancelled'&&inRange(row.bill_date)&&(supplierId==='all'||row.supplier_id===supplierId)),subtotal=sum(rows,row=>row.subtotal??row.total_amount),discount=sum(rows,row=>row.discount),total=sum(rows,row=>row.total_amount);
    const body=rows.map(row=>`<tr><td><b>${esc(row.bill_number)}</b><small>${date(row.bill_date)}</small></td><td>${esc(supplier(row.supplier_id)?.name||'Supplier')}</td><td class="number">${purchaseLines(row.id).length}</td><td class="number">${money(row.subtotal??row.total_amount)}</td><td class="number">${money(row.discount)}</td><td class="number">${money(row.total_amount)}</td></tr>`);
    setOutput(rows.length?table(['Purchase','Supplier','Items','Subtotal','Discount','Total'],body):reportEmpty('No purchases','No purchases match these filters.'),[['Bill number','Date','Supplier','Items','Subtotal','Discount','Grand total'],...rows.map(row=>[row.bill_number,row.bill_date,supplier(row.supplier_id)?.name,purchaseLines(row.id).length,row.subtotal??row.total_amount,row.discount,row.total_amount])]);
  }
  function renderMaterialMovement(){
    const materialId=$('#reportMaterial').value,materials=state.materials.filter(row=>materialId==='all'||row.id===materialId),all=[];
    materials.forEach(item=>{const measure=row=>isConsumable(item)?movementValue(row):num(row.quantity);let balance=materialMetrics(item).opening+state.materialMovements.filter(row=>row.material_id===item.id&&beforeFrom(row.movement_date)).reduce((total,row)=>total+(movementIn(row)?measure(row):movementOut(row)?-measure(row):0),0);state.materialMovements.filter(row=>row.material_id===item.id&&inRange(row.movement_date)).sort((a,b)=>`${a.movement_date}${a.created_at}`.localeCompare(`${b.movement_date}${b.created_at}`)).forEach(row=>{const incoming=movementIn(row),outgoing=movementOut(row);if(incoming)balance+=measure(row);if(outgoing)balance-=measure(row);all.push({row,item,incoming:incoming?measure(row):0,outgoing:outgoing?measure(row):0,balance})})});
    const totalIn=sum(all,row=>row.incoming),totalOut=sum(all,row=>row.outgoing),closing=sum(materials,row=>materialMetrics(row).stock);
    const body=all.map(({row,item,incoming,outgoing,balance})=>{const format=value=>isConsumable(item)?money(value):`${qty(value)} ${esc(item.unit)}`;return`<tr><td>${date(row.movement_date)}</td><td><b>${esc(item.name)}</b><small>${esc(movementName(row.movement_type))}</small></td><td>${esc(targetName(row))}</td><td class="number report-positive">${incoming?format(incoming):''}</td><td class="number report-negative">${outgoing?format(outgoing):''}</td><td class="number report-balance">${format(balance)}</td></tr>`});
    setOutput(all.length?table(['Date','Material / movement','Project / order','In','Out','Balance'],body,'report-ledger'):reportEmpty('No material movements','No movement matches these filters.'),[['Date','Material','Movement','Project / order','In','Out','Balance','Unit','Unit cost'],...all.map(({row,item,incoming,outgoing,balance})=>[row.movement_date,item.name,movementName(row.movement_type),targetName(row),incoming,outgoing,balance,item.unit,row.unit_cost])]);
  }
  function materialMetricsAsOf(row,asOfDate){
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)?asOfDate:/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today();
    const movements=state.materialMovements.filter(item=>item.material_id===row.id&&(!item.movement_date||String(item.movement_date).slice(0,10)<=asOf));
    const value=isConsumable(row);
    const measure=item=>value?movementValue(item):Number(item.quantity||0);
    const opening=value?Number(row.opening_amount||0):Number(row.opening_quantity||0);
    const purchased=movements.filter(item=>['purchase','adjustment_in'].includes(item.movement_type)).reduce((sum,item)=>sum+measure(item),0);
    const returned=movements.filter(item=>['walk_in_return','project_return'].includes(item.movement_type)).reduce((sum,item)=>sum+measure(item),0);
    const used=movements.filter(item=>['project_issue','walk_in_issue','adjustment_out'].includes(item.movement_type)).reduce((sum,item)=>sum+measure(item),0);
    const latest=[...movements].filter(item=>item.movement_type==='purchase').sort((a,b)=>`${b.movement_date}${b.created_at||''}`.localeCompare(`${a.movement_date}${a.created_at||''}`))[0];
    return{stock:opening+purchased+returned-used,opening,purchased,returned,used,unitCost:value?1:Number(latest?.unit_cost??row.opening_rate??row.default_unit_cost??0)};
  }
  function renderMaterialQuantity(){
    const asOf=/^\d{4}-\d{2}-\d{2}$/.test($('#reportAsOf')?.value)?$('#reportAsOf').value:today(),materialId=$('#reportMaterial').value;
    const rows=state.materials.filter(row=>!isConsumable(row)&&(materialId==='all'||row.id===materialId)).map(row=>({row,...materialMetricsAsOf(row,asOf)})),totalStock=sum(rows,item=>item.stock),stockValue=sum(rows,item=>item.stock*item.unitCost);
    const body=rows.map(item=>`<tr><td><b>${esc(item.row.name)}</b><small>${esc(item.row.sku||'')}</small></td><td>${esc(item.row.unit)}</td><td class="number ${item.stock<0?'report-negative':''}">${qty(item.stock)}</td><td class="number">${money(item.unitCost)}</td><td class="number">${money(item.stock*item.unitCost)}</td></tr>`);
    if(rows.length){
      body.push(`<tr class="statement-total"><td><b>Total stock value</b><small>As of ${esc(date(asOf))}</small></td><td></td><td class="number">${qty(totalStock)}</td><td></td><td class="number">${money(stockValue)}</td></tr>`);
    }
    setOutput(rows.length?table(['Material','Unit','Closing stock','Latest cost','Stock value'],body,'compact'):reportEmpty('No materials','Add materials in Purchasing.'),[['Material ID','Material','Unit','Closing stock','Latest cost','Stock value'],...rows.map(item=>[item.row.sku,item.row.name,item.row.unit,item.stock,item.unitCost,item.stock*item.unitCost]),['','Total stock value','','',stockValue]]);
  }
  function labourLedgerRows(){
    const labourId=$('#reportLabour').value,workers=state.labourers.filter(row=>labourId==='all'||row.id===labourId),rows=[];
    workers.forEach(worker=>{let balance=0;const events=[...state.labourAssignments.filter(row=>row.labourer_id===worker.id).map(row=>({day:row.assignment_date,created:row.created_at,type:'Assigned wages',details:targetName(row),assigned:assignmentAmount(row),paid:0,advance:0})),...state.labourWageSettlements.filter(row=>row.labourer_id===worker.id&&num(row.cash_paid)>0).map(row=>({day:row.settlement_date,created:row.created_at,type:'Wages paid',details:row.notes||'',assigned:0,paid:num(row.cash_paid),advance:0})),...state.payments.filter(row=>row.labourer_id===worker.id&&row.payment_type==='labour_advance').map(row=>({day:row.payment_date,created:row.created_at,type:'Advance',details:row.description||'',assigned:0,paid:0,advance:num(row.amount)}))].sort((a,b)=>`${a.day}${a.created}`.localeCompare(`${b.day}${b.created}`));events.forEach(event=>{balance+=event.assigned-event.paid-event.advance;if(inRange(event.day))rows.push({...event,worker,balance})})});return rows;
  }
  function renderLabourStatement(){
    const rows=labourLedgerRows(),assigned=sum(rows,row=>row.assigned),paid=sum(rows,row=>row.paid),advance=sum(rows,row=>row.advance),labourId=$('#reportLabour').value,to=$('#reportTo').value,workerIds=new Set(state.labourers.filter(row=>labourId==='all'||row.id===labourId).map(row=>row.id)),closing=sum(state.labourAssignments.filter(row=>workerIds.has(row.labourer_id)&&(!to||row.assignment_date<=to)),assignmentAmount)-sum(state.labourWageSettlements.filter(row=>workerIds.has(row.labourer_id)&&(!to||row.settlement_date<=to)),row=>row.cash_paid)-sum(state.payments.filter(row=>workerIds.has(row.labourer_id)&&row.payment_type==='labour_advance'&&(!to||row.payment_date<=to)),row=>row.amount);
    const body=rows.map(row=>`<tr><td>${date(row.day)}</td><td><b>${esc(row.worker.name)}</b><small>${esc(row.type)} · ${esc(row.details)}</small></td><td class="number">${row.assigned?money(row.assigned):''}</td><td class="number report-positive">${row.paid?money(row.paid):''}</td><td class="number report-positive">${row.advance?money(row.advance):''}</td><td class="number report-balance ${row.balance<0?'report-positive':''}">${money(row.balance)}</td></tr>`);
    setOutput(rows.length?table(['Date','Labour / entry','Assigned','Paid','Advance','Balance'],body,'report-ledger'):reportEmpty('No labour statement','No matching labour activity.'),[['Date','Labour','Entry','Details','Wages assigned','Wages paid','Advance','Balance'],...rows.map(row=>[row.day,row.worker.name,row.type,row.details,row.assigned,row.paid,row.advance,row.balance])]);
  }
  function renderBankStatement(){
    const accountId=$('#reportAccount').value;if(!accountId){setOutput(reportEmpty('Select an account','Choose a bank or cash account to view its statement.'),[]);return}const selected=account(accountId),opening=num(selected.opening_balance)+state.payments.filter(row=>beforeFrom(row.payment_date)).reduce((total,row)=>total+(row.to_account_id===accountId?num(row.amount):0)-(row.from_account_id===accountId?num(row.amount):0),0);let balance=opening;const rows=state.payments.filter(row=>(row.from_account_id===accountId||row.to_account_id===accountId)&&inRange(row.payment_date)).sort((a,b)=>`${a.payment_date}${a.created_at}`.localeCompare(`${b.payment_date}${b.created_at}`)).map(row=>{const incoming=row.to_account_id===accountId?num(row.amount):0,outgoing=row.from_account_id===accountId?num(row.amount):0;balance+=incoming-outgoing;return{row,incoming,outgoing,balance}}),moneyIn=sum(rows,row=>row.incoming),moneyOut=sum(rows,row=>row.outgoing);
    const body=rows.map(({row,incoming,outgoing,balance:running})=>`<tr><td>${date(row.payment_date)}</td><td><b>${esc(row.description||row.payment_type)}</b><small>${esc(row.payment_number||'')} · ${esc(targetName(row))}</small></td><td class="number report-positive">${incoming?money(incoming):''}</td><td class="number report-negative">${outgoing?money(outgoing):''}</td><td class="number report-balance">${money(running)}</td></tr>`);
    setOutput(rows.length?table(['Date','Transaction','Money in','Money out','Balance'],body,'report-ledger'):reportEmpty('No bank transactions','No transactions match this date range.'),[['Date','Number','Description','Target','Money in','Money out','Balance'],...rows.map(({row,incoming,outgoing,balance:running})=>[row.payment_date,row.payment_number,row.description,targetName(row),incoming,outgoing,running])]);
  }
  function renderPartnerDrawings(){
    const rows=state.payments.filter(row=>row.payment_type==='partner_drawing'&&inRange(row.payment_date)),total=sum(rows,row=>row.amount);
    const body=rows.map(row=>`<tr><td>${date(row.payment_date)}</td><td><b>Banam Ali</b><small>${esc(row.payment_number||'Partner drawing')}${row.notes?` · ${esc(row.notes)}`:''}</small></td><td>${esc(account(row.from_account_id)?.name||'Account')}</td><td class="number">${money(row.amount)}</td></tr>`);
    if(rows.length)body.push(`<tr class="statement-total"><td colspan="3"><b>Total partner drawings</b><small>Excluded from profitability</small></td><td class="number">${money(total)}</td></tr>`);
    setOutput(rows.length?table(['Date','Partner / details','Paid from','Amount'],body,'compact'):reportEmpty('No partner drawings','No Banam Ali drawings match this date range.'),[['Date','Partner','Payment number','Paid from','Details','Amount'],...rows.map(row=>[row.payment_date,'Banam Ali',row.payment_number,account(row.from_account_id)?.name,row.notes,row.amount]),['','','','Total','',total]]);
  }
  function fillSelect(selector,rows,label,allLabel='All') {const el=$(selector),old=el.value||'all';el.innerHTML=`<option value="all">${esc(allLabel)}</option>${rows.map(row=>`<option value="${row.id}">${esc(label(row))}</option>`).join('')}`;el.value=[...el.options].some(option=>option.value===old)?old:'all'}
  function configureFilters(){
    fillSelect('#reportProject',state.projects,row=>projectLabel(row),'All projects');fillSelect('#reportOrder',state.walkInOrders,row=>orderLabel(row),'All orders');fillSelect('#reportSupplier',state.suppliers,row=>row.name,'All suppliers');fillSelect('#reportMaterial',state.materials.filter(row=>reportState.type!=='materialQuantity'||!isConsumable(row)),row=>row.name,'All materials');fillSelect('#reportLabour',state.labourers,row=>row.name,'All labour persons');
    const account=$('#reportAccount'),old=account.value;account.innerHTML='<option value="">Select account</option>'+state.paymentAccounts.map(row=>`<option value="${row.id}">${esc(row.name)}${row.bank_name?` - ${esc(row.bank_name)}`:''}</option>`).join('');account.value=[...account.options].some(option=>option.value===old)?old:'';
    const filters=definitions[reportState.type]?.filters||[],scope=scopedReports.has(reportState.type),isSingle=singleDateReports.has(reportState.type);
    $('#reportDateTools').classList.toggle('hidden',isSingle||!filters.includes('date'));
    $('#reportAllDatesBtn').setAttribute('aria-pressed',String(!$('#reportFrom').value&&!$('#reportTo').value));
    $('#reportTitle').textContent=statementProject()?(reportState.type==='customerStatement'?'Customer statement':'Project receivable statement'):definitions[reportState.type].title;
    $('#reportScope').classList.toggle('hidden',!scope);
    $$('[data-report-scope]').forEach(button=>button.classList.toggle('active',button.dataset.reportScope===reportState.scope));
    const visible={From:!isSingle&&filters.includes('date'),To:!isSingle&&filters.includes('date'),AsOf:isSingle,Project:scope&&reportState.scope==='projects',Order:scope&&reportState.scope==='orders',Supplier:filters.includes('supplier'),Material:filters.includes('material'),Labour:filters.includes('labour'),Account:filters.includes('account')};
    Object.entries(visible).forEach(([name,show])=>$(`#report${name}Wrap`)?.classList.toggle('hidden',!show));
  }
  function renderCurrent(){
    if(!reportState.type)return;
    configureFilters();
    const valid=validReportDates();
    $('#reportPdfBtn').disabled=!valid;
    $('#reportWhatsappBtn').disabled=!valid;
    if(!valid){setOutput(reportEmpty('Check the date range','From date must be on or before To date.'),[]);return;}
    ({
      profit:renderProfit,
      customerStatement:renderCustomerStatement,
      supplierStatement:renderSupplierStatement,
      receivables:renderReceivables,
      expenses:renderExpenses,
      labourAssigned:renderLabourAssigned,
      materialCost:renderMaterialCost,
      supplierPayables:renderSupplierPayables,
      purchases:renderPurchases,
      materialMovement:renderMaterialMovement,
      materialQuantity:renderMaterialQuantity,
      labourStatement:renderLabourStatement,
      bankStatement:renderBankStatement,
      partnerDrawings:renderPartnerDrawings
    }[reportState.type])();
  }
  function setDefaultReportDates(now=new Date()){
    // Use the device's calendar date, including around local midnight/month rollover.
    const month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const todayStr=`${month}-${String(now.getDate()).padStart(2,'0')}`;
    $('#reportFrom').value=`${month}-01`;
    $('#reportTo').value=todayStr;
    $('#reportAsOf').value=todayStr;
  }
  function openReport(type){
    setDefaultReportDates();
    if(singleDateReports.has(type)){
      const todayStr=today();
      $('#reportAsOf').value=todayStr;
      $('#reportFrom').value='';
      $('#reportTo').value=todayStr;
    }
    reportState.type=type;
    reportState.scope='overall';
    $('#reportsHubPanel').classList.add('hidden');
    $('#reportViewerPanel').classList.remove('hidden');
    $('#reportTitle').textContent=definitions[type].title;
    setScreenHeader(`report-${type}`,definitions[type].title);
    renderCurrent();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function showHub(){$('#reportViewerPanel').classList.add('hidden');$('#reportsHubPanel').classList.remove('hidden');reportState.type=null;setScreenHeader('reports','Reports');window.scrollTo({top:0,behavior:'instant'})}
  function reportFileName(){const job=statementProject();return job?`project-statement-${safeName(job.project_number||job.name)}-${$('#reportFrom').value||'all'}-${$('#reportTo').value||'dates'}`:singleDateReports.has(reportState.type)?`mughal-${reportState.type}-as-of-${$('#reportAsOf')?.value||today()}`:`mughal-${reportState.type}-${today()}`;}
  function reportPdfDocument(){const statement=Boolean(statementProject()),node=document.createElement('div');node.className='report-print-document'+(statement?' statement-print':'');const header=statement?'':`<div class="report-print-head"><div><h1>${esc(definitions[reportState.type].title)}</h1><p>${esc(state.business?.name||'Mughal Interior')}</p><p>Period: ${esc(reportPeriod())} · Generated ${date(today())}</p></div><img src="assets/mughal-logo.png" alt="Mughal Interior"></div>`;node.innerHTML=header+$('#reportContent').innerHTML+businessContact();document.body.append(node);return node;}
  function reportPdfOptions(){const statement=Boolean(statementProject());return{margin:8,filename:`${reportFileName()}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:statement?'portrait':'landscape'},pagebreak:{mode:['css','legacy'],avoid:statement?['tr','.statement-heading','.statement-parties']:[]}};}
  function canExportReport(){if(!validReportDates())return false;if(!window.html2pdf){toast('PDF generator is still loading. Try again.');return false;}if(statementProject()&&!reportState.csv.length){toast('This project has no approved invoice to download.');return false;}return true;}
  async function downloadPdf(button){if(!canExportReport())return;const node=reportPdfDocument();try{await working('Preparing report PDF…',button,()=>html2pdf().set(reportPdfOptions()).from(node).save());}finally{node.remove();}}
  async function shareReportPdf(button){if(!canExportReport())return;const node=reportPdfDocument(),options=reportPdfOptions();try{await working('Preparing report for WhatsApp…',button,async()=>{const worker=html2pdf().set(options).from(node);if(typeof worker.outputPdf!=='function')throw new Error('PDF sharing is not supported by this browser.');const blob=await worker.outputPdf('blob'),file=new File([blob],options.filename,{type:'application/pdf'}),shareData={files:[file],title:definitions[reportState.type].title,text:'Mughal Interior and Decor report'};if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){try{await navigator.share(shareData);toast('Report shared.');}catch(error){if(error.name!=='AbortError')throw error;}}else{downloadPdfBlob(blob,options.filename);window.open(`https://wa.me/?text=${encodeURIComponent('Please attach the downloaded '+options.filename)}`,'_blank','noopener');toast('Report downloaded. Attach it to your WhatsApp chat.');}});}finally{node.remove();}}
  document.addEventListener('click',event=>{const open=event.target.closest('[data-open-report]');if(open)openReport(open.dataset.openReport);const scope=event.target.closest('[data-report-scope]');if(scope){reportState.scope=scope.dataset.reportScope;renderCurrent()}if(event.target.id==='reportAllDatesBtn')clearReportDates();if(event.target.id==='reportBackBtn')showHub();if(event.target.id==='reportPdfBtn')downloadPdf(event.target);if(event.target.id==='reportWhatsappBtn')shareReportPdf(event.target);if(event.target.closest('[data-tab="reports"]'))showHub()});
  ['reportFrom','reportTo','reportAsOf','reportProject','reportOrder','reportSupplier','reportMaterial','reportLabour','reportAccount'].forEach(id=>$('#'+id).addEventListener('change',renderCurrent));
  window.renderMobileReports=()=>{if(reportState.type)renderCurrent()};
})();
