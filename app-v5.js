// Walk-in orders module
function walkInMetrics(order){
  const rows=state.walkInOrderEntries.filter(e=>e.walk_in_order_id===order.id),sum=type=>rows.filter(e=>e.entry_type===type).reduce((total,e)=>total+Number(e.amount||0),0);
  const receipts=sum('receipt'),labour=sum('labour'),materials=sum('material'),expenses=sum('expense'),costs=labour+materials+expenses,amount=Number(order.amount||0);
  return {rows,receipts,labour,materials,expenses,costs,balance:amount-receipts,profit:amount-costs};
}

function walkInOrderCard(order){
  const m=walkInMetrics(order),open=!['Delivered','Cancelled'].includes(order.status);
  return `<article class="item-card project-card walk-in-card"><div class="project-card-head"><div><div class="project-card-number">${esc(order.order_number)}</div><h3>${esc(order.title)}</h3><div class="walk-in-customer"><span>${esc(order.customer_name)}</span>${order.customer_phone?`<span>${esc(order.customer_phone)}</span>`:''}<span>Promised ${prettyDate(order.promised_date)}</span></div></div><span class="status ${statusClass(order.status)}">${esc(order.status)}</span></div><div class="project-card-info"><div><span>Order amount</span><b>${money(order.amount)}</b></div><div><span>Received</span><b>${money(m.receipts)}</b></div><div><span>Balance</span><b class="${m.balance>0?'order-balance':''}">${money(m.balance)}</b></div><div><span>Estimated profit</span><b>${money(m.profit)}</b></div></div><div class="project-card-actions"><button class="quick-btn view" data-view-walk-in="${order.id}">View</button>${open?`<button class="quick-btn receipt" data-walk-in-entry="receipt" data-walk-in-id="${order.id}">Add receipt</button><button class="quick-btn" data-walk-in-material="${order.id}">Assign material</button><button class="quick-btn" data-walk-in-entry="labour" data-walk-in-id="${order.id}">Add labour</button><button class="quick-btn" data-walk-in-entry="expense" data-walk-in-id="${order.id}">Add expense</button>`:''}</div></article>`;
}

function renderWalkInOrders(){
  const search=$('#walkInOrderSearch'),filter=$('#walkInOrderStatusFilter');
  if(!search||!filter)return;
  const query=search.value.toLowerCase(),status=filter.value,rows=state.walkInOrders.filter(order=>(status==='all'||order.status===status)&&[order.order_number,order.title,order.customer_name,order.customer_phone,order.description].join(' ').toLowerCase().includes(query));
  const active=state.walkInOrders.filter(o=>o.status!=='Cancelled'),totals=active.map(o=>({o,m:walkInMetrics(o)}));
  $('#walkInOrderValue').textContent=money(totals.reduce((n,x)=>n+Number(x.o.amount||0),0));
  $('#walkInOrderDue').textContent=money(totals.reduce((n,x)=>n+Math.max(0,x.m.balance),0));
  $('#walkInOrderOpen').textContent=active.filter(o=>o.status!=='Delivered').length;
  $('#walkInOrderReady').textContent=active.filter(o=>o.status==='Ready').length;
  $('#walkInOrderList').innerHTML=rows.length?rows.map(walkInOrderCard).join(''):`<div class="empty"><b>No matching walk-in orders</b><span>Add a direct customer job or change the filter.</span></div>`;
}

function fillWalkInPartySelect(selected=''){
  $('#walkInOrderParty').innerHTML=`<option value="">No saved party — walk-in customer</option>`+state.parties.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(selected)$('#walkInOrderParty').value=selected;
}

function syncWalkInParty(){
  const party=state.parties.find(p=>p.id===$('#walkInOrderParty').value);if(!party)return;
  $('#walkInOrderCustomer').value=party.name||'';$('#walkInOrderPhone').value=party.phone||'';
}

function openWalkInOrder(orderId=''){
  const order=state.walkInOrders.find(o=>o.id===orderId);
  $('#walkInOrderForm').reset();fillWalkInPartySelect(order?.party_id||'');
  $('#walkInOrderId').value=order?.id||'';$('#walkInOrderCustomer').value=order?.customer_name||'';$('#walkInOrderPhone').value=order?.customer_phone||'';$('#walkInOrderTitle').value=order?.title||'';$('#walkInOrderDescription').value=order?.description||'';$('#walkInOrderDate').value=order?.order_date||today();$('#walkInOrderPromised').value=order?.promised_date||'';$('#walkInOrderAmount').value=order?.amount||'';$('#walkInOrderStatus').value=order?.status||'Pending';$('#walkInOrderNotes').value=order?.notes||'';$('#walkInOrderSheetTitle').textContent=order?'Edit order':'New order';
  closeSheets();openSheet('#walkInOrderSheet');
}

function walkInActivityHtml(entry){
  const symbols={receipt:'↙',labour:'L',material:'M',expense:'E'},cost=entry.entry_type!=='receipt';
  return `<div class="order-activity-row ${entry.entry_type}"><span class="order-activity-icon">${symbols[entry.entry_type]||'•'}</span><div class="order-activity-copy"><b>${esc(entry.description)}</b><small>${prettyDate(entry.entry_date)}${entry.notes?` · ${esc(entry.notes)}`:''}</small></div><span class="order-activity-amount">${cost?'− ':'+'}${money(entry.amount)}</span></div>`;
}

function walkInOrderDocumentHtml(order){
  const m=walkInMetrics(order),party=state.parties.find(p=>p.id===order.party_id),rows=[...m.rows].sort((a,b)=>`${b.entry_date}${b.created_at}`.localeCompare(`${a.entry_date}${a.created_at}`));
  return `<div class="doc-head"><div class="doc-brand"><img class="doc-logo" src="assets/mughal-logo.png?v=2" alt="Mughal Interior"><p>Crafted woodwork for homes and businesses</p></div><div class="doc-meta"><b>${esc(order.order_number)}</b><p>Order date: ${prettyDate(order.order_date)}</p><p>Promised date: ${prettyDate(order.promised_date)}</p></div></div><div class="doc-title"><p class="eyebrow">CUSTOMER ORDER</p><h1>${esc(order.title)}</h1></div><div class="project-status-strip"><span>ORDER STATUS</span><b class="status ${statusClass(order.status)}">${esc(order.status)}</b></div><div class="doc-grid"><div class="doc-box"><small>CUSTOMER</small><b>${esc(order.customer_name)}</b><div>${esc(order.customer_phone||'')}</div>${party?.address?`<div>${esc(party.address)}</div>`:''}</div><div class="doc-box"><small>SCHEDULE</small><b>Received ${prettyDate(order.order_date)}</b><div>Promised ${prettyDate(order.promised_date)}</div></div></div><h3>Work details</h3><div class="doc-details">${esc(order.description)}</div><div class="customer-order-total"><div class="metric"><span>Order amount</span><b>${money(order.amount)}</b></div><div class="metric"><span>Received</span><b>${money(m.receipts)}</b></div><div class="metric"><span>Balance</span><b>${money(m.balance)}</b></div></div>${order.notes?`<div class="doc-terms"><h3>Notes</h3><p>${esc(order.notes)}</p></div>`:''}<div class="order-financials"><div class="metric"><span>Material</span><b>${money(m.materials)}</b></div><div class="metric"><span>Labour</span><b>${money(m.labour)}</b></div><div class="metric"><span>Expenses</span><b>${money(m.expenses)}</b></div><div class="metric"><span>Estimated profit</span><b>${money(m.profit)}</b></div></div><div class="order-activity">${rows.length?`<h3>Internal activity</h3>${rows.map(walkInActivityHtml).join('')}`:'<p class="muted">No receipts or costs recorded yet.</p>'}</div>`;
}

function updateWalkInActionButtons(order){
  const finished=['Delivered','Cancelled'].includes(order.status),next={Pending:'Start work','In Progress':'Mark ready',Ready:'Mark delivered'}[order.status];
  $('#advanceWalkInOrderBtn').classList.toggle('hidden',!next);$('#advanceWalkInOrderBtn').textContent=next||'';
  $('#cancelWalkInOrderBtn').classList.toggle('hidden',finished);
  ['#walkInOrderMaterialBtn','#walkInOrderLabourBtn','#walkInOrderExpenseBtn'].forEach(sel=>$(sel).classList.toggle('hidden',finished));
  $('#walkInOrderReceiptBtn').classList.toggle('hidden',order.status==='Cancelled');
}

function viewWalkInOrder(orderId){
  const order=state.walkInOrders.find(o=>o.id===orderId);if(!order)return;
  state.activeWalkInOrder=order;$('#walkInOrderDocument').innerHTML=walkInOrderDocumentHtml(order);updateWalkInActionButtons(order);closeSheets();openSheet('#walkInOrderDetailSheet');
}

async function setWalkInOrderStatus(status){
  const order=state.activeWalkInOrder;if(!order)return;
  try{const saved=await store.save('walk_in_orders',{...order,status,updated_at:new Date().toISOString()},true),index=state.walkInOrders.findIndex(o=>o.id===order.id);state.walkInOrders[index]=saved;state.activeWalkInOrder=saved;render();viewWalkInOrder(saved.id);toast(`Order marked ${status.toLowerCase()}.`)}catch(err){toast(err.message)}
}

function openWalkInEntry(type,orderId=state.activeWalkInOrder?.id){
  const order=state.walkInOrders.find(o=>o.id===orderId);if(!order||order.status==='Cancelled')return;
  const labels={receipt:'Add customer receipt',labour:'Add labour cost',expense:'Add order expense'},placeholders={receipt:'Cash received from customer',labour:'Carpenter or worker payment',expense:'Transport, polishing or other expense'};
  $('#walkInEntryForm').reset();$('#walkInEntryOrderId').value=order.id;$('#walkInEntryType').value=type;$('#walkInEntryDate').value=today();$('#walkInEntryTitle').textContent=labels[type];$('#walkInEntryDescription').placeholder=placeholders[type];closeSheets();openSheet('#walkInEntrySheet');
}

function fillWalkInMaterials(selected=''){
  $('#walkInMaterial').innerHTML=`<option value="">Select material</option>`+state.materials.map(m=>`<option value="${m.id}">${esc(m.name)} (${qty(materialMetrics(m).stock)} ${esc(m.unit)})</option>`).join('');if(selected)$('#walkInMaterial').value=selected;updateWalkInMaterial();
}

function updateWalkInMaterial(){
  const material=state.materials.find(m=>m.id===$('#walkInMaterial').value);if(!material){$('#walkInAvailableStock').textContent='Available stock: 0';return}
  const metrics=materialMetrics(material);$('#walkInAvailableStock').textContent=`Available stock: ${qty(metrics.stock)} ${material.unit}`;if(!$('#walkInMaterialCost').value)$('#walkInMaterialCost').value=(metrics.average||material.default_unit_cost||0).toFixed(2);
}

function openWalkInMaterial(orderId=state.activeWalkInOrder?.id){
  const order=state.walkInOrders.find(o=>o.id===orderId);if(!order||['Delivered','Cancelled'].includes(order.status))return;if(!state.materials.length){toast('Add inventory materials before assigning stock.');return}
  $('#walkInMaterialForm').reset();$('#walkInMaterialOrderId').value=order.id;$('#walkInMaterialDate').value=today();fillWalkInMaterials();closeSheets();openSheet('#walkInMaterialSheet');
}

async function createWalkInLocal(row){
  const year=row.order_date.slice(0,4),prefix=`MIW-${year}-`,next=Math.max(0,...state.walkInOrders.filter(o=>o.order_number?.startsWith(prefix)).map(o=>Number(o.order_number.slice(prefix.length))||0))+1;
  return {...row,id:id('wo'),order_number:`${prefix}${String(next).padStart(4,'0')}`,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
}

$('#walkInOrderForm').addEventListener('submit',async event=>{
  event.preventDefault();const existing=state.walkInOrders.find(o=>o.id===$('#walkInOrderId').value),orderDate=$('#walkInOrderDate').value,promised=$('#walkInOrderPromised').value||null;if(promised&&promised<orderDate){toast('Promised date cannot be before order date.');return}
  const row={id:existing?.id||id('wo'),party_id:$('#walkInOrderParty').value||null,customer_name:$('#walkInOrderCustomer').value.trim(),customer_phone:$('#walkInOrderPhone').value.trim()||null,title:$('#walkInOrderTitle').value.trim(),description:$('#walkInOrderDescription').value.trim(),order_date:orderDate,promised_date:promised,amount:Number($('#walkInOrderAmount').value),status:$('#walkInOrderStatus').value,notes:$('#walkInOrderNotes').value.trim()||null,updated_at:new Date().toISOString()};
  const button=$('#saveWalkInOrderBtn');button.disabled=true;button.textContent='Saving…';
  try{
    let saved;
    if(existing)saved=await store.save('walk_in_orders',{...existing,...row},true);
    else if(isCloud){const orderId=await store.request('/rest/v1/rpc/create_walk_in_order',{method:'POST',body:JSON.stringify({p_business_id:state.businessId,p_party_id:row.party_id,p_customer_name:row.customer_name,p_customer_phone:row.customer_phone,p_title:row.title,p_description:row.description,p_order_date:row.order_date,p_promised_date:row.promised_date,p_amount:row.amount,p_status:row.status,p_notes:row.notes})});await store.load();saved=state.walkInOrders.find(o=>o.id===orderId)}
    else saved=await createWalkInLocal(row);
    if(!isCloud){const index=state.walkInOrders.findIndex(o=>o.id===saved.id);index>=0?state.walkInOrders[index]=saved:state.walkInOrders.unshift(saved)}
    closeSheets();render();navigate('orders');toast(existing?'Order updated.':'Walk-in order created.');viewWalkInOrder(saved.id);
  }catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Save order'}
});

$('#walkInEntryForm').addEventListener('submit',async event=>{
  event.preventDefault();const order=state.walkInOrders.find(o=>o.id===$('#walkInEntryOrderId').value),type=$('#walkInEntryType').value,amount=Number($('#walkInEntryAmount').value);if(!order)return;
  const metrics=walkInMetrics(order);if(type==='receipt'&&amount>Math.max(0,metrics.balance)){toast(`Receipt cannot exceed the ${money(metrics.balance)} balance.`);return}
  const row={id:id('we'),walk_in_order_id:order.id,entry_type:type,entry_date:$('#walkInEntryDate').value,description:$('#walkInEntryDescription').value.trim(),amount,notes:$('#walkInEntryNotes').value.trim()||null,created_at:new Date().toISOString()};
  try{const saved=await store.save('walk_in_order_entries',row,false);if(isCloud)await store.load();else state.walkInOrderEntries.unshift(saved);closeSheets();render();navigate('orders');toast('Order activity saved.');viewWalkInOrder(order.id)}catch(err){toast(err.message)}
});

$('#walkInMaterialForm').addEventListener('submit',async event=>{
  event.preventDefault();const order=state.walkInOrders.find(o=>o.id===$('#walkInMaterialOrderId').value),material=state.materials.find(m=>m.id===$('#walkInMaterial').value),quantity=Number($('#walkInMaterialQuantity').value),unitCost=Number($('#walkInMaterialCost').value);if(!order||!material)return;
  const available=materialMetrics(material).stock;if(quantity>available){toast(`Only ${qty(available)} ${material.unit} available.`);return}
  const movement={id:id('mm'),material_id:material.id,project_id:null,walk_in_order_id:order.id,movement_type:'walk_in_issue',movement_date:$('#walkInMaterialDate').value,quantity,unit_cost:unitCost,supplier_name:null,reference:$('#walkInMaterialReference').value.trim()||null,notes:$('#walkInMaterialNotes').value.trim()||null,created_at:new Date().toISOString()};
  try{const saved=await store.save('material_movements',movement,false);if(isCloud)await store.load();else{state.materialMovements.unshift(saved);state.walkInOrderEntries.unshift({id:id('we'),walk_in_order_id:order.id,entry_type:'material',entry_date:movement.movement_date,description:`Material: ${material.name} (${qty(quantity)} ${material.unit})`,amount:quantity*unitCost,notes:[movement.reference,movement.notes].filter(Boolean).join(' · '),created_at:new Date().toISOString()})}closeSheets();render();navigate('orders');toast('Material assigned and stock reduced.');viewWalkInOrder(order.id)}catch(err){toast(err.message)}
});

document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(action==='new-walk-in-order')openWalkInOrder();if(action==='more-menu'){closeSheets();openSheet('#moreNavSheet')}
  const view=event.target.closest('[data-view-walk-in]');if(view)viewWalkInOrder(view.dataset.viewWalkIn);
  const entry=event.target.closest('[data-walk-in-entry]');if(entry)openWalkInEntry(entry.dataset.walkInEntry,entry.dataset.walkInId);
  const material=event.target.closest('[data-walk-in-material]');if(material)openWalkInMaterial(material.dataset.walkInMaterial);
  const moreLink=event.target.closest('#moreNavSheet [data-nav]');if(moreLink){closeSheets();$$('.bottom-nav button').forEach(b=>b.classList.remove('active'));$('.more-nav').classList.add('active')}
});

$('#walkInOrderParty').addEventListener('change',syncWalkInParty);$('#walkInOrderSearch').addEventListener('input',renderWalkInOrders);$('#walkInOrderStatusFilter').addEventListener('change',renderWalkInOrders);$('#walkInMaterial').addEventListener('change',updateWalkInMaterial);
$('#editWalkInOrderBtn').addEventListener('click',()=>openWalkInOrder(state.activeWalkInOrder?.id));
$('#advanceWalkInOrderBtn').addEventListener('click',()=>{const next={Pending:'In Progress','In Progress':'Ready',Ready:'Delivered'}[state.activeWalkInOrder?.status];if(next)setWalkInOrderStatus(next)});
$('#cancelWalkInOrderBtn').addEventListener('click',()=>{if(confirm('Cancel this walk-in order?'))setWalkInOrderStatus('Cancelled')});
$('#walkInOrderMaterialBtn').addEventListener('click',()=>openWalkInMaterial());$('#walkInOrderReceiptBtn').addEventListener('click',()=>openWalkInEntry('receipt'));$('#walkInOrderLabourBtn').addEventListener('click',()=>openWalkInEntry('labour'));$('#walkInOrderExpenseBtn').addEventListener('click',()=>openWalkInEntry('expense'));$('#printWalkInOrderBtn').addEventListener('click',()=>printSheet('#walkInOrderDetailSheet'));

boot();
