// Complete V1: dashboard alerts, team permissions, settings and backup.
let settingsTab='business';

const currentMember=()=>state.members.find(member=>member.is_current)||state.members.find(member=>member.user_id===state.userId);
const canWrite=()=>['owner','manager','staff'].includes(state.memberRole);
const canManageSettings=()=>['owner','manager'].includes(state.memberRole);
const isOwner=()=>state.memberRole==='owner';
const titleRole=role=>({owner:'Owner',manager:'Manager',staff:'Staff',viewer:'Viewer'}[role]||role);

function businessPrintCaption(){
  const business=state.business||{},contact=[business.phone,business.email,business.address].filter(Boolean).join(' · ');
  return contact||'Crafted woodwork for homes and businesses';
}

function dashboardFinancialValues(){
  const projects=state.projects.filter(p=>p.status==='Approved'),orders=state.walkInOrders.filter(o=>o.status!=='Cancelled'),receivable=projects.reduce((sum,p)=>sum+Math.max(0,projectMetrics(p).balance),0)+orders.reduce((sum,o)=>sum+Math.max(0,walkInMetrics(o).balance),0),payable=state.purchaseBills.filter(b=>b.status!=='Cancelled').reduce((sum,b)=>sum+purchaseBalance(b),0),cash=state.paymentAccounts.reduce((sum,a)=>sum+paymentAccountBalance(a),0),jobProfit=projects.reduce((sum,p)=>sum+projectMetrics(p).profit,0)+orders.reduce((sum,o)=>sum+walkInMetrics(o).profit,0),otherIncome=state.payments.filter(p=>p.payment_type==='income').reduce((sum,p)=>sum+Number(p.amount||0),0),expenses=state.payments.filter(p=>p.payment_type==='expense').reduce((sum,p)=>sum+Number(p.amount||0),0);
  return {receivable,payable,cash,profit:jobProfit+otherIncome-expenses};
}

function dashboardAlertRows(){
  const rows=[],now=today(),inSeven=datePlus(now,7),push=(tone,icon,title,text,nav,date='')=>rows.push({tone,icon,title,text,nav,date});
  state.projects.filter(p=>p.status==='Pending').forEach(p=>{if(p.valid_until&&p.valid_until<now)push('danger','!','Quotation expired',`${p.name} · ${partyName(p.party_id)}`,'projects',p.valid_until);else if(p.valid_until&&p.valid_until<=inSeven)push('warning','⌛','Quotation expiring',`${p.name} · valid until ${prettyDate(p.valid_until)}`,'projects',p.valid_until)});
  state.projects.filter(p=>p.status==='Approved'&&p.expected_end_date).forEach(p=>{if(p.expected_end_date<now)push('danger','↗','Project completion overdue',`${p.name} · ${partyName(p.party_id)}`,'projects',p.expected_end_date);else if(p.expected_end_date<=inSeven)push('info','◷','Project completing soon',`${p.name} · ${prettyDate(p.expected_end_date)}`,'projects',p.expected_end_date)});
  state.walkInOrders.filter(o=>!['Delivered','Cancelled'].includes(o.status)&&o.promised_date).forEach(o=>{if(o.promised_date<now)push('danger','⌑','Walk-in order overdue',`${o.title} · ${o.customer_name}`,'orders',o.promised_date);else if(o.promised_date<=inSeven)push('info','⌑','Walk-in order due soon',`${o.title} · ${prettyDate(o.promised_date)}`,'orders',o.promised_date)});
  state.invoices.filter(i=>i.status!=='Paid'&&i.due_date&&i.due_date<now).forEach(i=>{const project=state.projects.find(p=>p.id===i.project_id),balance=project?projectMetrics(project).balance:Number(i.amount||0);if(balance>0)push('danger','₨','Invoice payment overdue',`${i.invoice_number} · ${money(balance)} due`,'invoices',i.due_date)});
  state.purchaseBills.filter(b=>b.status!=='Cancelled'&&purchaseBalance(b)>0&&b.due_date&&b.due_date<now).forEach(b=>push('danger','▥','Supplier bill overdue',`${supplierName(b.supplier_id)} · ${money(purchaseBalance(b))} due`,'purchases',b.due_date));
  state.materials.forEach(material=>{const metric=materialMetrics(material);if(metric.low)push('warning','▦','Low stock',`${material.name} · ${qty(metric.stock)} ${material.unit} available`,'inventory')});
  return rows.sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
}

function dashboardActivityRows(){
  const rows=[];
  state.projects.forEach(p=>rows.push({date:p.created_at,icon:'⌑',title:'Project quotation',text:`${p.name} · ${partyName(p.party_id)}`,amount:projectPriceText(p),nav:'projects'}));
  state.walkInOrders.forEach(o=>rows.push({date:o.created_at,icon:'▤',title:'Walk-in order',text:`${o.title} · ${o.customer_name}`,amount:money(o.amount),nav:'orders'}));
  state.purchaseBills.forEach(b=>rows.push({date:b.created_at,icon:'▥',title:'Purchase bill',text:`${b.bill_number} · ${supplierName(b.supplier_id)}`,amount:money(b.total_amount),nav:'purchases'}));
  state.invoices.forEach(i=>rows.push({date:i.created_at,icon:'₨',title:'Invoice',text:i.invoice_number,amount:money(i.amount),nav:'invoices'}));
  state.payments.forEach(p=>rows.push({date:p.created_at,icon:paymentTypeIcon(p.payment_type),title:paymentTypeLabel(p.payment_type),text:p.description,amount:money(p.amount),nav:'payments'}));
  return rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6);
}

function renderDashboard(){
  if(!$('#dashboardFinancials'))return;
  const finance=dashboardFinancialValues();
  $('#dashboardFinancials').innerHTML=`<article class="dashboard-money-card receivable"><span>Customer receivables</span><strong>${money(finance.receivable)}</strong><small>Projects and walk-in orders</small></article><article class="dashboard-money-card payable"><span>Supplier payables</span><strong>${money(finance.payable)}</strong><small>Unpaid purchase bills</small></article><article class="dashboard-money-card cash"><span>Cash and bank</span><strong>${money(finance.cash)}</strong><small>Current account balances</small></article><article class="dashboard-money-card profit"><span>Estimated net profit</span><strong class="${finance.profit<0?'negative':''}">${money(finance.profit)}</strong><small>Jobs plus other income and expenses</small></article>`;
  const alerts=dashboardAlertRows();$('#dashboardAlertCount').textContent=alerts.length;$('#dashboardAlertCount').classList.toggle('clear',!alerts.length);$('#dashboardAlerts').innerHTML=alerts.length?alerts.slice(0,10).map(a=>`<button class="dashboard-alert ${a.tone}" data-dashboard-nav="${a.nav}"><span class="dashboard-alert-icon">${a.icon}</span><span><b>${esc(a.title)}</b><small>${esc(a.text)}</small></span><i>→</i></button>`).join(''):'<div class="empty dashboard-clear"><b>Everything looks on track</b><span>No overdue work, bills, quotations or low-stock items.</span></div>';
  const activity=dashboardActivityRows();$('#dashboardActivity').innerHTML=activity.length?activity.map(a=>`<button data-dashboard-nav="${a.nav}"><span class="activity-icon">${a.icon}</span><span><b>${esc(a.title)}</b><small>${esc(a.text)} · ${new Date(a.date).toLocaleDateString('en-PK',{day:'numeric',month:'short'})}</small></span><strong>${a.amount}</strong></button>`).join(''):reportEmpty('No activity yet','New projects, orders, bills and payments will appear here.');
}

function roleSelect(member){
  if(member.role==='owner')return '<span class="status approved">Owner</span>';
  if(!isOwner())return `<span class="status draft">${esc(titleRole(member.role))}</span>`;
  return `<select class="member-role-select" data-member-role="${member.user_id}" aria-label="Change role"><option value="manager" ${member.role==='manager'?'selected':''}>Manager</option><option value="staff" ${member.role==='staff'?'selected':''}>Staff</option><option value="viewer" ${member.role==='viewer'?'selected':''}>Viewer</option></select>`;
}

function renderSettings(){
  if(!$('#settingsView'))return;const business=state.business||demo.business,member=currentMember();
  $('#brandBusinessName').textContent=business.name||'Mughal Interior';$('#currentRoleBadge').textContent=titleRole(state.memberRole);$('#currentRoleBadge').className=`role-badge ${state.memberRole}`;$('#profileBtn').textContent=(member?.email||business.name||'MI').split(/[@\s._-]+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  $('#businessName').value=business.name||'';$('#businessPhone').value=business.phone||'';$('#businessEmail').value=business.email||'';$('#businessAddress').value=business.address||'';$('#businessQuoteDays').value=business.default_quote_valid_days??15;$('#businessInvoiceDays').value=business.default_invoice_due_days??7;$('#businessPaymentTerms').value=business.default_payment_terms||'';
  const editable=canManageSettings();$$('#businessSettingsForm input, #businessSettingsForm textarea').forEach(field=>field.disabled=!editable);$('#saveBusinessSettingsBtn').classList.toggle('hidden',!editable);$('#businessSettingsAccess').textContent=editable?'You can edit these settings.':'Owner or manager access is required to edit.';
  $('#teamMemberList').innerHTML=state.members.length?state.members.map(member=>`<article class="team-member-card"><span class="team-avatar">${esc((member.email||'?').slice(0,1).toUpperCase())}</span><div><b>${esc(member.email||'Unknown user')}</b><small>${member.is_current?'This account · ':''}Added ${new Date(member.created_at).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'})}</small></div><div class="team-role-control">${roleSelect(member)}${isOwner()&&member.role!=='owner'&&!member.is_current?`<button class="icon-btn member-remove" data-remove-member="${member.user_id}" aria-label="Remove member">×</button>`:''}</div></article>`).join(''):reportEmpty('No team members','Add a registered user to share this business workspace.');
  const modules=['Parties and customers','Project quotations','Invoices and receipts','Inventory and material allocation','Suppliers and purchase bills','Walk-in orders','Cash and bank payments','Profitability and reports','Dashboard alerts','Staff roles and settings'];$('#appModuleStatus').innerHTML=modules.map(name=>`<div><span>✓</span><b>${esc(name)}</b></div>`).join('');
  $$('[data-settings-tab]').forEach(button=>button.classList.toggle('active',button.dataset.settingsTab===settingsTab));$$('.settings-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`settings${settingsTab[0].toUpperCase()+settingsTab.slice(1)}Panel`));
}

function applyRolePermissions(){
  const writable=canWrite(),owner=isOwner();document.body.classList.toggle('read-only-role',!writable);$$('.owner-only').forEach(el=>el.classList.toggle('hidden',!owner));
  const selectors=['[data-action="new-party"]','[data-action="new-project"]','[data-action="new-invoice"]','[data-action="new-material"]','[data-action="new-purchase"]','[data-action="new-supplier"]','[data-action="new-purchase-bill"]','[data-action="new-walk-in-order"]','[data-action="new-payment-account"]','[data-action="new-payment"]','[data-edit-party]','[data-party-project]','[data-card-entry]','[data-card-material]','[data-purchase-material]','[data-issue-material]','[data-pay-purchase-bill]','#editProjectBtn','#approveProjectBtn','#cancelProjectBtn','#scopeIncreaseBtn','#scopeDecreaseBtn','#generateProjectInvoiceBtn','#editMaterialBtn','#purchaseMaterialBtn','#issueMaterialBtn','#payPurchaseBillBtn','#editWalkInOrderBtn','#advanceWalkInOrderBtn','#cancelWalkInOrderBtn','#walkInOrderMaterialBtn','#walkInOrderReceiptBtn','#walkInOrderLabourBtn','#walkInOrderExpenseBtn','#editPaymentAccountBtn','#accountMoneyInBtn','#accountMoneyOutBtn','#accountTransferBtn','#editInvoiceBtn','#receiveInvoicePaymentBtn'];selectors.forEach(selector=>$$(selector).forEach(el=>el.classList.toggle('role-hidden',!writable)));
}

async function reloadCompleteApp(message='Data refreshed.'){try{await store.load();render();toast(message)}catch(error){toast(error.message)}}

async function saveBusinessSettings(event){
  event.preventDefault();if(!canManageSettings()){toast('Owner or manager access is required.');return}const row={name:$('#businessName').value.trim(),phone:$('#businessPhone').value.trim()||null,email:$('#businessEmail').value.trim()||null,address:$('#businessAddress').value.trim()||null,default_quote_valid_days:Number($('#businessQuoteDays').value),default_invoice_due_days:Number($('#businessInvoiceDays').value),default_payment_terms:$('#businessPaymentTerms').value.trim()||null};
  const button=$('#saveBusinessSettingsBtn');button.disabled=true;button.textContent='Saving…';try{if(isCloud){const saved=await store.request(`/rest/v1/businesses?id=eq.${state.businessId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});state.business=saved[0]}else state.business={...state.business,...row};render();toast('Business settings saved.')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Save settings'}
}

async function addTeamMember(event){
  event.preventDefault();if(!isOwner()){toast('Only the owner can add team members.');return}const button=$('#saveTeamMemberBtn');button.disabled=true;button.textContent='Adding…';try{if(isCloud){await store.request('/rest/v1/rpc/add_business_member_by_email',{method:'POST',body:JSON.stringify({p_business_id:state.businessId,p_email:$('#teamMemberEmail').value.trim(),p_role:$('#teamMemberRole').value})});await store.load()}else state.members.push({user_id:id('member'),email:$('#teamMemberEmail').value.trim(),role:$('#teamMemberRole').value,created_at:new Date().toISOString(),is_current:false});closeSheets();render();settingsTab='team';renderSettings();toast('Team member added.')}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Add member'}
}

async function changeMemberRole(userId,role){try{await store.request('/rest/v1/rpc/update_business_member_role',{method:'POST',body:JSON.stringify({p_business_id:state.businessId,p_user_id:userId,p_role:role})});await store.load();render();toast('Team role updated.')}catch(error){toast(error.message);renderSettings()}}
async function removeMember(userId){if(!confirm('Remove this member from Mughal Interior? They will lose access to this business.'))return;try{await store.request('/rest/v1/rpc/remove_business_member',{method:'POST',body:JSON.stringify({p_business_id:state.businessId,p_user_id:userId})});await store.load();render();toast('Team member removed.')}catch(error){toast(error.message)}}

function downloadBusinessBackup(){
  const backup={app:'Mughal Interior Accounts',version:'1.0',exported_at:new Date().toISOString(),business:state.business,members:state.members.map(({user_id,email,role,created_at})=>({user_id,email,role,created_at})),parties:state.parties,projects:state.projects,project_entries:state.projectEntries,invoices:state.invoices,materials:state.materials,material_movements:state.materialMovements,suppliers:state.suppliers,purchase_bills:state.purchaseBills,purchase_bill_items:state.purchaseBillItems,walk_in_orders:state.walkInOrders,walk_in_order_entries:state.walkInOrderEntries,payment_accounts:state.paymentAccounts,payments:state.payments},blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`mughal-interior-backup-${today()}.json`;link.click();URL.revokeObjectURL(url);toast('Backup downloaded.');
}

$$('[data-settings-tab]').forEach(button=>button.addEventListener('click',()=>{settingsTab=button.dataset.settingsTab;renderSettings()}));
document.addEventListener('click',event=>{const alert=event.target.closest('[data-dashboard-nav]');if(alert)navigate(alert.dataset.dashboardNav);const action=event.target.closest('[data-action]')?.dataset.action;if(action==='add-team-member'){if(!isOwner())return;$('#teamMemberForm').reset();closeSheets();openSheet('#teamMemberSheet')}const remove=event.target.closest('[data-remove-member]');if(remove)removeMember(remove.dataset.removeMember)});
document.addEventListener('change',event=>{const select=event.target.closest('[data-member-role]');if(select)changeMemberRole(select.dataset.memberRole,select.value)});
$('#businessSettingsForm').addEventListener('submit',saveBusinessSettings);$('#teamMemberForm').addEventListener('submit',addTeamMember);$('#downloadBackupBtn').addEventListener('click',downloadBusinessBackup);$('#refreshAppDataBtn').addEventListener('click',()=>reloadCompleteApp());$('#signOutBtn').addEventListener('click',()=>{if(confirm('Sign out of Mughal Interior Accounts?'))logout()});

boot();
