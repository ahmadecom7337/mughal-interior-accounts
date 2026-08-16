// Payments, cash and bank accounts module
const paymentTypeLabel=type=>({customer_receipt:'Customer receipt',supplier_payment:'Supplier payment',income:'Other income',expense:'Business expense',transfer:'Account transfer',labour_payment:'Labour wage payment',labour_advance:'Labour advance'}[type]||type);
const paymentTypeIcon=type=>({customer_receipt:'↙',supplier_payment:'↗',income:'+',expense:'−',transfer:'⇄',labour_payment:'L',labour_advance:'A'}[type]||'•');
const paymentAccountName=accountId=>state.paymentAccounts.find(a=>a.id===accountId)?.name||'Unknown account';

function paymentAccountBalance(account){
  if(!account)return 0;
  return Number(account.opening_balance||0)+state.payments.reduce((balance,payment)=>balance+(payment.to_account_id===account.id?Number(payment.amount||0):0)-(payment.from_account_id===account.id?Number(payment.amount||0):0),0);
}

function paymentTargetName(payment){
  if(payment.project_id){const project=state.projects.find(p=>p.id===payment.project_id);return project?`${project.name} — ${partyName(project.party_id)}`:'Project receipt'}
  if(payment.walk_in_order_id){const order=state.walkInOrders.find(o=>o.id===payment.walk_in_order_id);return order?`${order.title} — ${order.customer_name}`:'Walk-in receipt'}
  if(payment.purchase_bill_id){const bill=state.purchaseBills.find(b=>b.id===payment.purchase_bill_id);return bill?`${bill.bill_number} — ${supplierName(bill.supplier_id)}`:'Supplier bill'}
  if(payment.labourer_id)return labourerName(payment.labourer_id);
  if(payment.party_id)return partyName(payment.party_id);
  return payment.description;
}

function paymentAccountCard(account){
  const balance=paymentAccountBalance(account),count=state.payments.filter(p=>p.from_account_id===account.id||p.to_account_id===account.id).length;
  return `<article class="payment-account-card ${account.active?'':'inactive'}"><div class="payment-account-top"><span class="payment-account-icon">${account.account_type==='Cash'?'₨':account.account_type==='Bank'?'▰':'▣'}</span><span class="status ${account.active?'approved':'draft'}">${account.active?'Active':'Inactive'}</span></div><div><small>${esc(account.account_type)}${account.bank_name?` · ${esc(account.bank_name)}`:''}</small><h3>${esc(account.name)}</h3>${account.account_number?`<p>${esc(account.account_number)}</p>`:''}</div><div class="payment-account-balance"><span>Available balance</span><b>${money(balance)}</b></div><div class="payment-account-actions"><button class="quick-btn view" data-view-payment-account="${account.id}">View ledger</button>${account.active?`<button class="quick-btn receipt" data-account-money-in="${account.id}">+ Money in</button><button class="quick-btn" data-account-transfer="${account.id}">Transfer</button>`:''}</div><small class="payment-account-count">${count} transaction${count===1?'':'s'}</small></article>`;
}

function paymentCard(payment){
  const incoming=['customer_receipt','income'].includes(payment.payment_type),transfer=payment.payment_type==='transfer',account=transfer?`${paymentAccountName(payment.from_account_id)} → ${paymentAccountName(payment.to_account_id)}`:paymentAccountName(incoming?payment.to_account_id:payment.from_account_id);
  return `<article class="payment-row ${incoming?'incoming':transfer?'transfer':'outgoing'}"><span class="payment-row-icon">${paymentTypeIcon(payment.payment_type)}</span><div class="payment-row-copy"><div><span class="payment-number">${esc(payment.payment_number)}</span><span class="payment-date">${prettyDate(payment.payment_date)}</span></div><h3>${esc(payment.description)}</h3><p>${esc(paymentTargetName(payment))} · ${esc(account)}${payment.reference?` · ${esc(payment.reference)}`:''}</p></div><div class="payment-row-side"><b>${incoming?'+':transfer?'':'−'}${money(payment.amount)}</b><span>${paymentTypeLabel(payment.payment_type)}</span><button class="mini-btn" data-view-payment="${payment.id}">View</button></div></article>`;
}

function renderPayments(){
  if(!$('#paymentList'))return;
  const month=today().slice(0,7),monthRows=state.payments.filter(p=>String(p.payment_date).startsWith(month));
  $('#paymentTotalBalance').textContent=money(state.paymentAccounts.reduce((sum,a)=>sum+paymentAccountBalance(a),0));
  $('#paymentMonthIn').textContent=money(monthRows.filter(p=>['customer_receipt','income'].includes(p.payment_type)).reduce((sum,p)=>sum+Number(p.amount||0),0));
  $('#paymentMonthOut').textContent=money(monthRows.filter(p=>['supplier_payment','expense','labour_payment','labour_advance'].includes(p.payment_type)).reduce((sum,p)=>sum+Number(p.amount||0),0));
  $('#paymentSupplierDue').textContent=money(state.purchaseBills.filter(b=>b.status!=='Cancelled').reduce((sum,b)=>sum+purchaseBalance(b),0));
  $('#paymentAccountList').innerHTML=state.paymentAccounts.length?state.paymentAccounts.map(paymentAccountCard).join(''):'<div class="empty"><b>No payment accounts</b><span>Add cash, bank or mobile-wallet accounts to begin.</span></div>';
  const accountFilter=$('#paymentAccountFilter'),selected=accountFilter.value||'all';accountFilter.innerHTML='<option value="all">All accounts</option>'+state.paymentAccounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');accountFilter.value=state.paymentAccounts.some(a=>a.id===selected)?selected:'all';
  const search=$('#paymentSearch').value.toLowerCase(),type=$('#paymentTypeFilter').value,accountId=accountFilter.value;
  const rows=state.payments.filter(p=>(type==='all'||p.payment_type===type)&&(accountId==='all'||p.from_account_id===accountId||p.to_account_id===accountId)&&[p.payment_number,p.description,p.reference,paymentTargetName(p),paymentAccountName(p.from_account_id),paymentAccountName(p.to_account_id)].join(' ').toLowerCase().includes(search));
  $('#paymentList').innerHTML=rows.length?rows.map(paymentCard).join(''):'<div class="empty"><b>No matching transactions</b><span>Record a receipt, payment, income, expense or transfer.</span></div>';
}

function paymentAccountOptions(selected=''){
  const options='<option value="">Select an account</option>'+state.paymentAccounts.filter(a=>a.active).map(a=>`<option value="${a.id}">${esc(a.name)} — ${money(paymentAccountBalance(a))}</option>`).join('');
  $('#paymentFromAccount').innerHTML=options;$('#paymentToAccount').innerHTML=options;if(selected){$('#paymentFromAccount').value=selected;$('#paymentToAccount').value=selected}
}

function paymentCustomerOptions(selected=''){
  const projects=state.projects.filter(p=>p.status==='Approved'&&projectMetrics(p).balance>0),orders=state.walkInOrders.filter(o=>!['Pending','Cancelled'].includes(o.status)&&walkInMetrics(o).balance>0);
  $('#paymentCustomer').innerHTML='<option value="">Select a customer source</option>'+(projects.length?`<optgroup label="Approved projects">${projects.map(p=>`<option value="project:${p.id}">${esc(p.name)} — ${esc(partyName(p.party_id))} · ${money(projectMetrics(p).balance)} due</option>`).join('')}</optgroup>`:'')+(orders.length?`<optgroup label="Walk-in orders">${orders.map(o=>`<option value="walkin:${o.id}">${esc(o.title)} — ${esc(o.customer_name)} · ${money(walkInMetrics(o).balance)} due</option>`).join('')}</optgroup>`:'')+(state.parties.length?`<optgroup label="Party receipt (not linked to a job)">${state.parties.map(p=>`<option value="party:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`:'');if(selected)$('#paymentCustomer').value=selected;
}

function paymentBillOptions(selected=''){
  const bills=state.purchaseBills.filter(b=>b.status==='Posted'&&purchaseBalance(b)>0);
  $('#paymentSupplierBill').innerHTML='<option value="">Select an unpaid bill</option>'+bills.map(b=>`<option value="${b.id}">${esc(b.bill_number)} — ${esc(supplierName(b.supplier_id))} · ${money(purchaseBalance(b))} due</option>`).join('');if(selected)$('#paymentSupplierBill').value=selected;
}

function updatePaymentFromBalance(){
  const account=state.paymentAccounts.find(a=>a.id===$('#paymentFromAccount').value);$('#paymentFromBalance').textContent=`Available: ${money(paymentAccountBalance(account))}`;
}

function updatePaymentCustomer(){
  const [kind,targetId]=String($('#paymentCustomer').value||'').split(':');let balance=null,label='';
  if(kind==='project'){const project=state.projects.find(p=>p.id===targetId);balance=projectMetrics(project).balance;label=`Receipt for ${project.name}`}
  if(kind==='walkin'){const order=state.walkInOrders.find(o=>o.id===targetId);balance=walkInMetrics(order).balance;label=`Receipt for ${order.title}`}
  if(kind==='party'){label=`Receipt from ${partyName(targetId)}`}
  $('#paymentCustomerBalance').textContent=balance===null?'General party receipt — not allocated to a project or order.':`Outstanding balance: ${money(balance)}`;if(label)$('#paymentDescription').value=label;
}

function updatePaymentBill(){
  const bill=state.purchaseBills.find(b=>b.id===$('#paymentSupplierBill').value);$('#paymentBillBalance').textContent=bill?`Outstanding balance: ${money(purchaseBalance(bill))}`:'Select an unpaid supplier bill.';if(bill)$('#paymentDescription').value=`Payment to ${supplierName(bill.supplier_id)} for ${bill.bill_number}`;
}

function updatePaymentTypeFields(){
  const type=$('#paymentType').value,customer=type==='customer_receipt',supplier=type==='supplier_payment',incoming=['customer_receipt','income'].includes(type),outgoing=['supplier_payment','expense'].includes(type),transfer=type==='transfer';
  $('#paymentFromAccountWrap').classList.toggle('hidden',incoming);$('#paymentToAccountWrap').classList.toggle('hidden',outgoing);$('#paymentCustomerWrap').classList.toggle('hidden',!customer);$('#paymentSupplierBillWrap').classList.toggle('hidden',!supplier);
  $('#paymentFromAccount').required=outgoing||transfer;$('#paymentToAccount').required=incoming||transfer;$('#paymentCustomer').required=customer;$('#paymentSupplierBill').required=supplier;
  $('#paymentSheetTitle').textContent=paymentTypeLabel(type);$('#paymentDescription').placeholder={customer_receipt:'e.g. Advance received',supplier_payment:'e.g. Material bill payment',income:'e.g. Sale of scrap wood',expense:'e.g. Workshop rent or utilities',transfer:'e.g. Cash deposited into bank'}[type];updatePaymentFromBalance();
}

function openPayment(type='customer_receipt',context={}){
  if(!state.paymentAccounts.some(a=>a.active)){toast('Add an active cash or bank account first.');openPaymentAccount();return}
  $('#paymentForm').reset();$('#paymentType').value=type;$('#paymentDate').value=today();paymentAccountOptions(context.accountId||'');paymentCustomerOptions(context.projectId?`project:${context.projectId}`:context.walkInOrderId?`walkin:${context.walkInOrderId}`:'');paymentBillOptions(context.purchaseBillId||'');
  if(!context.accountId){const first=state.paymentAccounts.find(a=>a.active)?.id||'';$('#paymentFromAccount').value=first;$('#paymentToAccount').value=first}
  updatePaymentTypeFields();if(context.projectId||context.walkInOrderId)updatePaymentCustomer();if(context.purchaseBillId)updatePaymentBill();closeSheets();openSheet('#paymentSheet');
}

function openPaymentAccount(accountId=''){
  const account=state.paymentAccounts.find(a=>a.id===accountId),hasTransactions=account&&state.payments.some(p=>p.from_account_id===account.id||p.to_account_id===account.id);$('#paymentAccountForm').reset();$('#paymentAccountId').value=account?.id||'';$('#paymentAccountName').value=account?.name||'';$('#paymentAccountType').value=account?.account_type||'Cash';$('#paymentAccountBank').value=account?.bank_name||'';$('#paymentAccountNumber').value=account?.account_number||'';$('#paymentAccountOpening').value=account?.opening_balance??0;$('#paymentAccountOpening').readOnly=Boolean(hasTransactions);$('#paymentAccountActive').value=String(account?.active??true);$('#paymentAccountBalanceNote').classList.toggle('hidden',!hasTransactions);$('#paymentAccountSheetTitle').textContent=account?'Edit account':'Add account';closeSheets();openSheet('#paymentAccountSheet');
}

function viewPaymentAccount(accountId){
  const account=state.paymentAccounts.find(a=>a.id===accountId);if(!account)return;state.activePaymentAccount=account;const rows=state.payments.filter(p=>p.from_account_id===account.id||p.to_account_id===account.id);
  $('#paymentAccountDetailTitle').textContent=account.name;$('#paymentAccountDetail').innerHTML=`<div class="account-ledger-head"><div><span>${esc(account.account_type)}${account.bank_name?` · ${esc(account.bank_name)}`:''}</span><h3>${esc(account.name)}</h3>${account.account_number?`<p>${esc(account.account_number)}</p>`:''}</div><div><span>Available balance</span><b>${money(paymentAccountBalance(account))}</b></div></div><div class="account-opening-row"><span>Opening balance</span><b>${money(account.opening_balance)}</b></div><div class="payment-list account-ledger-list">${rows.length?rows.map(paymentCard).join(''):'<div class="empty"><b>No transactions yet</b><span>Record money in, money out or a transfer.</span></div>'}</div>`;$('#accountMoneyInBtn').classList.toggle('hidden',!account.active);$('#accountMoneyOutBtn').classList.toggle('hidden',!account.active);$('#accountTransferBtn').classList.toggle('hidden',!account.active);closeSheets();openSheet('#paymentAccountDetailSheet');
}

function paymentDocumentHtml(payment){
  const incoming=['customer_receipt','income'].includes(payment.payment_type),transfer=payment.payment_type==='transfer',accountText=transfer?`${paymentAccountName(payment.from_account_id)} → ${paymentAccountName(payment.to_account_id)}`:paymentAccountName(incoming?payment.to_account_id:payment.from_account_id);
  return `<div class="doc-head"><div class="doc-brand"><img class="doc-logo" src="assets/mughal-logo.png?v=2" alt="Mughal Interior"><p>${esc(businessPrintCaption())}</p></div><div class="doc-meta"><b>${esc(payment.payment_number)}</b><p>Date: ${prettyDate(payment.payment_date)}</p><p>${esc(paymentTypeLabel(payment.payment_type))}</p></div></div><div class="doc-title"><p class="eyebrow">PAYMENT RECORD</p><h1>${esc(payment.description)}</h1></div><div class="payment-document-amount"><span>AMOUNT</span><b>${money(payment.amount)}</b></div><div class="doc-grid"><div class="doc-box"><small>TRANSACTION TYPE</small><b>${esc(paymentTypeLabel(payment.payment_type))}</b><div>${esc(accountText)}</div></div><div class="doc-box"><small>PAID TO / RECEIVED FROM</small><b>${esc(paymentTargetName(payment))}</b>${payment.reference?`<div>Reference: ${esc(payment.reference)}</div>`:''}</div></div>${payment.notes?`<div class="doc-terms"><h3>Notes</h3><p>${esc(payment.notes)}</p></div>`:''}`;
}

function viewPayment(paymentId){const payment=state.payments.find(p=>p.id===paymentId);if(!payment)return;state.activePayment=payment;$('#paymentDocument').innerHTML=paymentDocumentHtml(payment);closeSheets();openSheet('#paymentDetailSheet')}

function parsePaymentTarget(){const [kind,targetId]=String($('#paymentCustomer').value||'').split(':');return {partyId:kind==='party'?targetId:null,projectId:kind==='project'?targetId:null,walkInOrderId:kind==='walkin'?targetId:null}}

async function recordPaymentLocal(input){
  const year=input.payment_date.slice(0,4),prefix=`MIT-${year}-`,next=Math.max(0,...state.payments.filter(p=>p.payment_number?.startsWith(prefix)).map(p=>Number(p.payment_number.slice(prefix.length))||0))+1,payment={id:id('pay'),payment_number:`${prefix}${String(next).padStart(4,'0')}`,created_at:new Date().toISOString(),...input};
  if(payment.from_account_id&&payment.amount>paymentAccountBalance(state.paymentAccounts.find(a=>a.id===payment.from_account_id)))throw new Error('Insufficient account balance.');
  if(payment.project_id){const project=state.projects.find(p=>p.id===payment.project_id);if(payment.amount>projectMetrics(project).balance)throw new Error('Receipt exceeds the project balance.');payment.party_id=project.party_id;state.projectEntries.unshift({id:id('pe'),project_id:project.id,entry_type:'receipt',entry_date:payment.payment_date,description:payment.description,amount:payment.amount,notes:[payment.reference,payment.notes].filter(Boolean).join(' · '),payment_id:payment.id,created_at:new Date().toISOString()});const invoice=state.invoices.find(i=>i.project_id===project.id);if(invoice&&projectMetrics(project).receipts>=Number(invoice.amount))invoice.status='Paid'}
  if(payment.walk_in_order_id){const order=state.walkInOrders.find(o=>o.id===payment.walk_in_order_id);if(payment.amount>walkInMetrics(order).balance)throw new Error('Receipt exceeds the order balance.');payment.party_id=order.party_id||null;state.walkInOrderEntries.unshift({id:id('we'),walk_in_order_id:order.id,entry_type:'receipt',entry_date:payment.payment_date,description:payment.description,amount:payment.amount,notes:[payment.reference,payment.notes].filter(Boolean).join(' · '),payment_id:payment.id,created_at:new Date().toISOString()})}
  if(payment.purchase_bill_id){const bill=state.purchaseBills.find(b=>b.id===payment.purchase_bill_id);if(payment.amount>purchaseBalance(bill))throw new Error('Payment exceeds the supplier bill balance.');payment.supplier_id=bill.supplier_id;bill.amount_paid=Number(bill.amount_paid||0)+payment.amount;bill.payment_status=bill.amount_paid>=Number(bill.total_amount)?'Paid':'Partly Paid'}
  state.payments.unshift(payment);return payment.id;
}

$('#paymentAccountForm').addEventListener('submit',async event=>{event.preventDefault();const existing=state.paymentAccounts.find(a=>a.id===$('#paymentAccountId').value),row={id:existing?.id||id('pa'),name:$('#paymentAccountName').value.trim(),account_type:$('#paymentAccountType').value,bank_name:$('#paymentAccountBank').value.trim()||null,account_number:$('#paymentAccountNumber').value.trim()||null,opening_balance:Number($('#paymentAccountOpening').value||0),active:$('#paymentAccountActive').value==='true',created_at:existing?.created_at||new Date().toISOString()};try{const saved=await store.save('payment_accounts',row,Boolean(existing)),index=state.paymentAccounts.findIndex(a=>a.id===saved.id);index>=0?state.paymentAccounts[index]=saved:state.paymentAccounts.push(saved);closeSheets();render();navigate('bankAccounts');toast(existing?'Payment account updated.':'Payment account added.')}catch(err){toast(err.message)}});

$('#paymentForm').addEventListener('submit',async event=>{
  event.preventDefault();const type=$('#paymentType').value,target=parsePaymentTarget(),bill=state.purchaseBills.find(b=>b.id===$('#paymentSupplierBill').value),input={payment_type:type,payment_date:$('#paymentDate').value,from_account_id:['supplier_payment','expense','transfer'].includes(type)?$('#paymentFromAccount').value:null,to_account_id:['customer_receipt','income','transfer'].includes(type)?$('#paymentToAccount').value:null,party_id:target.partyId,supplier_id:bill?.supplier_id||null,project_id:target.projectId,walk_in_order_id:target.walkInOrderId,purchase_bill_id:type==='supplier_payment'?$('#paymentSupplierBill').value:null,invoice_id:target.projectId?state.invoices.find(i=>i.project_id===target.projectId)?.id||null:null,description:$('#paymentDescription').value.trim(),amount:Number($('#paymentAmount').value),reference:$('#paymentReference').value.trim()||null,notes:$('#paymentNotes').value.trim()||null};
  if(type==='transfer'&&input.from_account_id===input.to_account_id){toast('Choose two different accounts for a transfer.');return}
  const button=$('#savePaymentBtn');button.disabled=true;button.textContent='Posting…';
  try{let paymentId;if(isCloud){paymentId=await store.request('/rest/v1/rpc/record_payment',{method:'POST',body:JSON.stringify({p_business_id:state.businessId,p_payment_type:input.payment_type,p_payment_date:input.payment_date,p_from_account_id:input.from_account_id,p_to_account_id:input.to_account_id,p_party_id:input.party_id,p_supplier_id:input.supplier_id,p_project_id:input.project_id,p_walk_in_order_id:input.walk_in_order_id,p_purchase_bill_id:input.purchase_bill_id,p_invoice_id:input.invoice_id,p_description:input.description,p_amount:input.amount,p_reference:input.reference,p_notes:input.notes})});await store.load()}else paymentId=await recordPaymentLocal(input);closeSheets();render();navigate('banking');toast('Transaction posted.');viewPayment(paymentId)}catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Post transaction'}
});

document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(action==='new-payment-account')openPaymentAccount();if(action==='new-payment')openPayment();
  const account=event.target.closest('[data-view-payment-account]');if(account)viewPaymentAccount(account.dataset.viewPaymentAccount);
  const moneyIn=event.target.closest('[data-account-money-in]');if(moneyIn)openPayment('income',{accountId:moneyIn.dataset.accountMoneyIn});
  const transfer=event.target.closest('[data-account-transfer]');if(transfer)openPayment('transfer',{accountId:transfer.dataset.accountTransfer});
  const payment=event.target.closest('[data-view-payment]');if(payment)viewPayment(payment.dataset.viewPayment);
});

$('#paymentType').addEventListener('change',updatePaymentTypeFields);$('#paymentFromAccount').addEventListener('change',updatePaymentFromBalance);$('#paymentCustomer').addEventListener('change',updatePaymentCustomer);$('#paymentSupplierBill').addEventListener('change',updatePaymentBill);$('#paymentSearch').addEventListener('input',renderPayments);$('#paymentTypeFilter').addEventListener('change',renderPayments);$('#paymentAccountFilter').addEventListener('change',renderPayments);
$('#editPaymentAccountBtn').addEventListener('click',()=>openPaymentAccount(state.activePaymentAccount?.id));$('#accountMoneyInBtn').addEventListener('click',()=>openPayment('income',{accountId:state.activePaymentAccount?.id}));$('#accountMoneyOutBtn').addEventListener('click',()=>openPayment('expense',{accountId:state.activePaymentAccount?.id}));$('#accountTransferBtn').addEventListener('click',()=>openPayment('transfer',{accountId:state.activePaymentAccount?.id}));$('#receiveInvoicePaymentBtn').addEventListener('click',()=>openPayment('customer_receipt',{projectId:state.activeInvoice?.project_id,walkInOrderId:state.activeInvoice?.walk_in_order_id}));$('#printPaymentBtn').addEventListener('click',()=>printSheet('#paymentDetailSheet'));
