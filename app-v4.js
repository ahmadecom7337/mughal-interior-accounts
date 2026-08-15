function supplierName(supplierId){return state.suppliers.find(s=>s.id===supplierId)?.name||'Unknown supplier'}
function purchaseItemsFor(billId){return state.purchaseBillItems.filter(i=>i.purchase_bill_id===billId)}
function purchaseBalance(bill){return Math.max(0,Number(bill.total_amount||0)-Number(bill.amount_paid||0))}

function purchaseBillCard(bill){
  const items=purchaseItemsFor(bill.id),units=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  return `<article class="item-card purchase-card"><div class="purchase-card-top"><div><div class="project-card-number">${esc(bill.bill_number)}</div><h3>${esc(supplierName(bill.supplier_id))}</h3></div><div><div class="amount">${money(bill.total_amount)}</div><span class="status ${statusClass(bill.payment_status)}">${esc(bill.payment_status)}</span></div></div><div class="purchase-card-info"><div><span>Bill date</span><b>${prettyDate(bill.bill_date)}</b></div><div><span>Due date</span><b>${prettyDate(bill.due_date)}</b></div><div><span>Supplier invoice</span><b>${esc(bill.supplier_invoice_no||'Not entered')}</b></div><div><span>Materials</span><b>${items.length} item${items.length===1?'':'s'} · ${qty(units)} units</b></div></div><div class="project-card-actions"><button class="quick-btn view" data-view-purchase-bill="${bill.id}">View bill</button></div></article>`
}

function renderPurchasing(){
  const posted=state.purchaseBills.filter(b=>b.status!=='Cancelled'),total=posted.reduce((sum,b)=>sum+Number(b.total_amount||0),0),due=posted.reduce((sum,b)=>sum+purchaseBalance(b),0);
  $('#purchaseValue').textContent=money(total);$('#purchaseDue').textContent=money(due);$('#supplierCount').textContent=state.suppliers.length;$('#purchaseBillCount').textContent=posted.length;
  const text=$('#purchaseSearch').value.toLowerCase(),status=$('#purchaseStatusFilter').value;
  const bills=state.purchaseBills.filter(b=>(status==='all'||b.payment_status===status)&&[b.bill_number,b.supplier_invoice_no,supplierName(b.supplier_id)].join(' ').toLowerCase().includes(text));
  $('#purchaseBillList').innerHTML=bills.length?bills.map(purchaseBillCard).join(''):'<div class="empty"><b>No purchase bills found</b><span>Post a supplier bill to receive materials into stock.</span></div>';
  const supplierText=$('#supplierSearch').value.toLowerCase(),suppliers=state.suppliers.filter(s=>[s.name,s.contact_name,s.phone,s.address].join(' ').toLowerCase().includes(supplierText));
  $('#supplierList').innerHTML=suppliers.length?suppliers.map(s=>{const bills=posted.filter(b=>b.supplier_id===s.id),balance=bills.reduce((sum,b)=>sum+purchaseBalance(b),0);return `<article class="item-card"><div><h3>${esc(s.name)}</h3><div class="meta">${s.contact_name?`<span>${esc(s.contact_name)}</span>`:''}${s.phone?`<span>${esc(s.phone)}</span>`:''}${s.address?`<span>${esc(s.address)}</span>`:''}</div><div class="supplier-balance">${bills.length} bill${bills.length===1?'':'s'} · ${money(balance)} due</div></div><div class="item-actions"><button class="mini-btn" data-edit-supplier="${s.id}">Edit</button><button class="btn soft" data-supplier-bill="${s.id}">New bill</button></div></article>`}).join(''):'<div class="empty"><b>No suppliers found</b><span>Add the shops and vendors you purchase materials from.</span></div>'
}

function openSupplier(supplierId=''){
  const supplier=state.suppliers.find(s=>s.id===supplierId);$('#supplierForm').reset();$('#supplierId').value=supplier?.id||'';$('#supplierName').value=supplier?.name||'';$('#supplierContact').value=supplier?.contact_name||'';$('#supplierPhone').value=supplier?.phone||'';$('#supplierAddress').value=supplier?.address||'';$('#supplierNotes').value=supplier?.notes||'';$('#supplierSheetTitle').textContent=supplier?'Edit supplier':'Add supplier';closeSheets();openSheet('#supplierSheet')
}

function fillPurchaseBillSuppliers(selected=''){
  $('#purchaseBillSupplier').innerHTML='<option value="">Select a supplier</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(selected)$('#purchaseBillSupplier').value=selected
}

function purchaseMaterialOptions(selected=''){
  return '<option value="">Select material</option>'+state.materials.map(m=>`<option value="${m.id}" ${m.id===selected?'selected':''}>${esc(m.name)} (${esc(m.unit)})</option>`).join('')
}

function addPurchaseItem(materialId=''){
  const material=state.materials.find(m=>m.id===materialId),row=document.createElement('div');row.className='purchase-item-row';row.innerHTML=`<label>Material *<select class="purchase-item-material" required>${purchaseMaterialOptions(materialId)}</select></label><label>Quantity *<input class="purchase-item-quantity" type="number" min="0.001" step="0.001" inputmode="decimal" required></label><label>Unit cost (Rs.) *<input class="purchase-item-cost" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${material?Number(material.default_unit_cost||0).toFixed(2):''}"></label><label>Line total<div class="purchase-item-total">Rs. 0</div></label><button class="remove-purchase-item" type="button" aria-label="Remove item">×</button>`;$('#purchaseBillItems').append(row);updatePurchaseBillTotal()
}

function updatePurchaseBillTotal(){
  let total=0;$$('.purchase-item-row',$('#purchaseBillItems')).forEach(row=>{const line=Number($('.purchase-item-quantity',row).value||0)*Number($('.purchase-item-cost',row).value||0);$('.purchase-item-total',row).textContent=money(line);total+=line});$('#purchaseBillTotal').textContent=money(total);return total
}

function openPurchaseBill(materialId='',supplierId=''){
  if(!state.materials.length){toast('Add a material before recording a purchase bill.');openMaterial();return}
  if(!state.suppliers.length){toast('Add a supplier before recording a purchase bill.');openSupplier();return}
  $('#purchaseBillForm').reset();fillPurchaseBillSuppliers(supplierId);$('#purchaseBillDate').value=today();$('#purchaseBillDueDate').value=plusDays(30);$('#purchaseBillItems').innerHTML='';addPurchaseItem(materialId);closeSheets();openSheet('#purchaseBillSheet')
}

function purchaseBillDocumentHtml(bill){
  const supplier=state.suppliers.find(s=>s.id===bill.supplier_id)||{},items=purchaseItemsFor(bill.id);
  return `<div class="doc-head"><div class="doc-brand"><img class="doc-logo" src="assets/mughal-logo.png" alt="Mughal Interior"><p>Material purchase record</p></div><div class="doc-meta"><b>${esc(bill.bill_number)}</b><p>Bill date: ${prettyDate(bill.bill_date)}</p><p>Due date: ${prettyDate(bill.due_date)}</p></div></div><div class="doc-title"><p class="eyebrow">PURCHASE BILL</p><h1>${esc(supplier.name||'Supplier purchase')}</h1></div><div class="project-status-strip"><span>PAYMENT STATUS</span><b class="status ${statusClass(bill.payment_status)}">${esc(bill.payment_status)}</b></div><div class="doc-grid"><div class="doc-box"><small>SUPPLIER</small><b>${esc(supplier.name||'')}</b><div>${esc(supplier.contact_name||'')}</div><div>${esc(supplier.phone||'')}</div><div>${esc(supplier.address||'')}</div></div><div class="doc-box"><small>REFERENCE</small><b>${esc(bill.supplier_invoice_no||'Not entered')}</b><div>${items.length} material item${items.length===1?'':'s'}</div></div></div><table class="purchase-document-table"><thead><tr><th>Material</th><th>Quantity</th><th>Unit cost</th><th>Amount</th></tr></thead><tbody>${items.map(item=>{const material=state.materials.find(m=>m.id===item.material_id)||{};return `<tr><td>${esc(material.name||'Unknown material')}</td><td>${qty(item.quantity)} ${esc(material.unit||'')}</td><td>${money(item.unit_cost)}</td><td>${money(item.line_total??Number(item.quantity)*Number(item.unit_cost))}</td></tr>`}).join('')}</tbody><tfoot><tr><td colspan="3">Total purchase bill</td><td>${money(bill.total_amount)}</td></tr></tfoot></table>${bill.notes?`<div class="doc-terms"><h3>Notes</h3><p>${esc(bill.notes)}</p></div>`:''}`
}

function viewPurchaseBill(billId){const bill=state.purchaseBills.find(b=>b.id===billId);if(!bill)return;state.activePurchaseBill=bill;$('#purchaseBillDocument').innerHTML=purchaseBillDocumentHtml(bill);closeSheets();openSheet('#purchaseBillDetailSheet')}

async function createPurchaseBillLocal(items){
  const year=$('#purchaseBillDate').value.slice(0,4),sequence=state.purchaseBills.filter(b=>String(b.bill_number).startsWith(`MIPB-${year}-`)).length+1,billId=id('pb'),bill={id:billId,supplier_id:$('#purchaseBillSupplier').value,bill_number:`MIPB-${year}-${String(sequence).padStart(4,'0')}`,supplier_invoice_no:$('#purchaseBillReference').value.trim(),bill_date:$('#purchaseBillDate').value,due_date:$('#purchaseBillDueDate').value||null,total_amount:updatePurchaseBillTotal(),amount_paid:0,payment_status:'Unpaid',status:'Posted',notes:$('#purchaseBillNotes').value.trim(),created_at:new Date().toISOString()};state.purchaseBills.unshift(bill);items.forEach(item=>{const itemId=id('pbi'),material=state.materials.find(m=>m.id===item.material_id),saved={id:itemId,purchase_bill_id:billId,...item,line_total:item.quantity*item.unit_cost,created_at:new Date().toISOString()};state.purchaseBillItems.push(saved);state.materialMovements.unshift({id:id('mm'),material_id:item.material_id,project_id:null,movement_type:'purchase',movement_date:bill.bill_date,quantity:item.quantity,unit_cost:item.unit_cost,supplier_id:bill.supplier_id,supplier_name:supplierName(bill.supplier_id),reference:bill.bill_number,purchase_bill_id:billId,purchase_bill_item_id:itemId,notes:'',created_at:new Date().toISOString()})});return billId
}

document.addEventListener('click',e=>{
  const action=e.target.closest('[data-action]')?.dataset.action;if(action==='new-supplier')openSupplier();if(action==='new-purchase-bill')openPurchaseBill();
  const edit=e.target.closest('[data-edit-supplier]');if(edit)openSupplier(edit.dataset.editSupplier);
  const supplierBill=e.target.closest('[data-supplier-bill]');if(supplierBill)openPurchaseBill('',supplierBill.dataset.supplierBill);
  const bill=e.target.closest('[data-view-purchase-bill]');if(bill)viewPurchaseBill(bill.dataset.viewPurchaseBill);
  const tab=e.target.closest('[data-purchase-tab]');if(tab){$$('[data-purchase-tab]').forEach(b=>b.classList.toggle('active',b===tab));$('#purchaseBillsPanel').classList.toggle('hidden',tab.dataset.purchaseTab!=='bills');$('#suppliersPanel').classList.toggle('hidden',tab.dataset.purchaseTab!=='suppliers')}
  const remove=e.target.closest('.remove-purchase-item');if(remove){remove.closest('.purchase-item-row').remove();if(!$('#purchaseBillItems').children.length)addPurchaseItem();updatePurchaseBillTotal()}
});

$('#purchaseSearch').addEventListener('input',renderPurchasing);$('#purchaseStatusFilter').addEventListener('change',renderPurchasing);$('#supplierSearch').addEventListener('input',renderPurchasing);$('#addPurchaseItemBtn').addEventListener('click',()=>addPurchaseItem());$('#printPurchaseBillBtn').addEventListener('click',()=>printSheet('#purchaseBillDetailSheet'));
$('#purchaseBillItems').addEventListener('input',updatePurchaseBillTotal);$('#purchaseBillItems').addEventListener('change',e=>{if(e.target.classList.contains('purchase-item-material')){const row=e.target.closest('.purchase-item-row'),material=state.materials.find(m=>m.id===e.target.value),cost=$('.purchase-item-cost',row);if(material&&!Number(cost.value))cost.value=Number(material.default_unit_cost||0).toFixed(2);updatePurchaseBillTotal()}});

$('#supplierForm').addEventListener('submit',async e=>{e.preventDefault();const existing=state.suppliers.find(s=>s.id===$('#supplierId').value),row={id:existing?.id||id('sup'),name:$('#supplierName').value.trim(),contact_name:$('#supplierContact').value.trim(),phone:$('#supplierPhone').value.trim(),address:$('#supplierAddress').value.trim(),notes:$('#supplierNotes').value.trim(),active:true,created_at:existing?.created_at||new Date().toISOString()};try{const saved=await store.save('suppliers',row,Boolean(existing)),index=state.suppliers.findIndex(s=>s.id===saved.id);index>=0?state.suppliers[index]=saved:state.suppliers.push(saved);closeSheets();render();navigate('purchases');toast(existing?'Supplier updated.':'Supplier added.')}catch(err){toast(err.message)}});

$('#purchaseBillForm').onsubmit=async e=>{
  e.preventDefault();
  const rows=$$('.purchase-item-row',$('#purchaseBillItems'));
  const items=rows.map(row=>({material_id:$('.purchase-item-material',row).value,quantity:Number($('.purchase-item-quantity',row).value),unit_cost:Number($('.purchase-item-cost',row).value)}));
  if(items.some(i=>!i.material_id||i.quantity<=0||i.unit_cost<=0)){toast('Complete every material, quantity and unit cost.');return}
  if(new Set(items.map(i=>i.material_id)).size!==items.length){toast('Each material should appear once on a bill. Combine duplicate quantities.');return}
  if($('#purchaseBillDueDate').value&&$('#purchaseBillDueDate').value<$('#purchaseBillDate').value){toast('Due date cannot be before bill date.');return}
  const button=$('#savePurchaseBillBtn');button.disabled=true;button.textContent='Posting bill…';
  try{
    let billId;
    if(isCloud){billId=await store.request('/rest/v1/rpc/create_purchase_bill',{method:'POST',body:JSON.stringify({p_supplier_id:$('#purchaseBillSupplier').value,p_bill_date:$('#purchaseBillDate').value,p_due_date:$('#purchaseBillDueDate').value||null,p_supplier_invoice_no:$('#purchaseBillReference').value.trim(),p_notes:$('#purchaseBillNotes').value.trim(),p_items:items})});await store.load()}
    else billId=await createPurchaseBillLocal(items);
    closeSheets();render();navigate('purchases');toast('Purchase bill posted and stock received.');viewPurchaseBill(billId)
  }catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Post bill & receive stock'}
};

boot();
