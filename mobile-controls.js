(() => {
  // Local SVG artwork; no icon-font, CDN, or additional runtime dependency.
  const paths = {
    people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
    project:'<path d="m3 10 9-7 9 7v11H3zM9 21v-8h6v8M8 7V3H5v6"/>',
    quote:'<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5"/>',
    invoice:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 7h8M8 11h8M8 15h4"/>',
    receipt:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M8 15h3m5-13v5m-2-2 2 2 2-2"/>',
    labour:'<path d="M5 10a7 7 0 0 1 14 0M3 10h18M9 4v6m6-6v6M7 13a5 5 0 0 0 10 0M4 22v-2a8 8 0 0 1 16 0v2"/>',
    material:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7 5l10 4"/>',
    expense:'<path d="M4 3h12l4 4v14H4zM8 8h4M8 12h8M8 16h3m4 0h2"/>',
    supplier:'<path d="M2 6h12v12H2zM14 10h4l4 4v4h-8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
    purchase:'<path d="M3 3h2l3 12h11l2-9H6M8 18h11"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
    wallet:'<path d="M19 7V4H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V7M21 12h-6v5h6"/><circle cx="17" cy="14.5" r=".5"/>',
    bank:'<path d="m2 8 10-5 10 5H2zm2 3v7m5-7v7m6-7v7m5-7v7M2 21h20"/>',
    withdraw:'<path d="M4 3h16v6H4zM12 6v10m-4-4 4 4 4-4M3 16v5h18v-5"/>',
    deposit:'<path d="M4 15h16v6H4zM12 18V8m-4 4 4-4 4 4M3 8V3h18v5"/>',
    transfer:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    chart:'<path d="M3 3v18h18M7 16v-5m5 5V6m5 10v-8"/>',
    profit:'<path d="M3 21h18M4 16l6-6 4 3 7-9m-6 0h6v6"/>',
    ledger:'<path d="M5 3h16v18H5zM3 7h4M3 12h4M3 17h4M11 7h6m-6 5h6m-6 5h6"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    down:'<path d="m6 9 6 6 6-6"/>',
    back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',
    edit:'<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    view:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    filter:'<path d="M3 5h18l-7 8v7l-4-2v-5z"/>',
    save:'<path d="M4 3h13l4 4v14H3V3zM8 3v6h8V3M7 21v-8h10v8"/>',
    logout:'<path d="M9 3H3v18h6m4-9h9m-4-4 4 4-4 4"/>'
  };
  function icon(name) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('ui-icon');svg.innerHTML=paths[name]||paths.invoice;return svg;
  }
  const routes={parties:'people',projectMaster:'project',projectsHub:'project',quotes:'quote',invoices:'invoice',receipt:'receipt',labour:'labour',material:'material',expense:'expense',orders:'invoice',orderInvoices:'invoice',orderReceipts:'receipt',orderExpenses:'expense',orderMaterials:'material',orderLabour:'labour',orderItems:'material',purchasing:'purchase',purchaseSuppliers:'supplier',purchaseMaterials:'material',purchases:'purchase',cashPurchasing:'wallet',consumablePool:'material',purchasePayments:'wallet',labourPayments:'labour',banking:'bank',bankAccounts:'bank',cashWithdrawals:'withdraw',cashDeposits:'deposit',bankTransfers:'transfer',bankingExpenses:'expense',reports:'chart',profit:'profit',receivables:'receipt',expenses:'expense',labourAssigned:'labour',materialCost:'material',supplierPayables:'supplier',materialMovement:'transfer',materialQuantity:'material',labourStatement:'ledger',bankStatement:'bank'};
  const colors={people:['#366bbb','#e3edfc'],project:['#308462','#e0f1e8'],quote:['#9b6b22','#fff0d5'],invoice:['#7357b0','#ece5fb'],receipt:['#21896f','#ddf3eb'],labour:['#bb642f','#ffecdd'],material:['#37849e','#e0f1f7'],expense:['#b75377','#fae3ec'],supplier:['#4577ba','#e4edfb'],purchase:['#927020','#f8edcf'],wallet:['#27866b','#dff1e8'],bank:['#515dac','#e8eafb'],withdraw:['#b76932','#fbe7d9'],deposit:['#308360','#e0f2e7'],transfer:['#487aa6','#e5eff7'],chart:['#715aad','#eee7fa'],profit:['#308260','#e2f2e8'],ledger:['#a06a2d','#f7ecd8']};
  function addIcons() {
    document.querySelectorAll('.action-grid>button,.bottom-nav>button').forEach(button=>{
      const slot=button.querySelector(':scope > span');if(!slot||slot.querySelector('svg'))return;
      const key=button.dataset.route||button.dataset.projectAction||button.dataset.orderRoute||button.dataset.purchaseRoute||button.dataset.bankingRoute||button.dataset.openReport||button.dataset.tab;
      const name=routes[key]||'invoice',color=colors[name]||colors.invoice;slot.replaceChildren(icon(name));slot.style.setProperty('--icon-color',color[0]);slot.style.setProperty('--icon-soft',color[1]);
    });
    document.querySelectorAll('.search>span').forEach(slot=>{if(!slot.querySelector('svg'))slot.replaceChildren(icon('search'));});
    document.querySelectorAll('button').forEach(button=>{
      if(button.closest('.action-grid,.bottom-nav,#selectionDialog')||button.classList.contains('search-select-trigger')||button.querySelector(':scope > svg')||button.classList.contains('processing'))return;
      const label=button.textContent.trim(),action=button.dataset.action||'';let name='';
      if(button.classList.contains('back'))name='back';
      else if(button.id==='logoutBtn')name='logout';
      else if(button.hasAttribute('data-close')||button.matches('[data-remove-order-line],[data-remove-purchase-line]'))name='close';
      else if(button.id==='detailDelete')name='trash';
      else if(button.id==='detailEdit')name='edit';
      else if(button.classList.contains('view-button'))name='view';
      else if(/download|pdf|csv/i.test(label))name='download';
      else if(/approve/i.test(label))name='check';
      else if(/save|sign in/i.test(label))name='save';
      else if(/all dates/i.test(label))name='calendar';
      else if(/clear filters/i.test(label))name='filter';
      else if(/return|transfer|scope/.test(action))name='transfer';
      else if(/pay-wages|pay-advance/.test(action)||button.hasAttribute('data-pay-worker'))name='wallet';
      else if(/deposit/.test(action))name='deposit';else if(/withdraw/.test(action))name='withdraw';
      else if(/^\+|^add|^assign|^charge/i.test(label))name='plus';
      if(!name)return;
      if(['←','×','MI'].includes(label)){button.textContent='';if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',name==='back'?'Back':name==='logout'?'Sign out':'Close');}
      else if(label.startsWith('+ ')){const text=Array.from(button.childNodes).find(node=>node.nodeType===3&&node.textContent.includes('+ '));if(text)text.textContent=text.textContent.replace('+ ','');}
      button.prepend(icon(name));button.classList.add('has-ui-icon');
    });
  }

  const controls=new Map();let active=null,dialog=null,search=null,list=null,title=null,error=null,previousOverflow='';
  const supportsDialog=typeof HTMLDialogElement!=='undefined'&&typeof HTMLDialogElement.prototype.showModal==='function';
  function labelFor(source){
    const label=source.labels?.[0]||source.closest('label');
    return source.getAttribute('aria-label')||Array.from(label?.childNodes||[]).filter(node=>node.nodeType===3).map(node=>node.textContent).join(' ').replace(/\*/g,'').trim()||source.getAttribute('placeholder')||'Select an option';
  }
  function choicesFor(source){
    const select=source.tagName==='SELECT',options=select?source.options:document.getElementById(source.getAttribute('list'))?.options;
    return Array.from(options||[]).map((option,index)=>({index,value:option.value,label:select?option.label:[option.value,option.label!==option.value?option.label:''].filter(Boolean).join(' - '),disabled:option.disabled||option.parentElement?.disabled,hidden:option.hidden||option.parentElement?.hidden}));
  }
  function sync(source){
    const control=controls.get(source);if(!control)return;
    const selected=source.tagName==='SELECT'?source.options[source.selectedIndex]?.label:source.value;
    const text=selected||source.getAttribute('placeholder')||`Select ${control.label.toLowerCase()}`;
    if(control.value.textContent!==text)control.value.textContent=text;
    const disabled=source.disabled||source.readOnly||source.matches(':disabled');if(control.button.disabled!==Boolean(disabled))control.button.disabled=Boolean(disabled);
    control.button.setAttribute('aria-label',`${control.label}: ${text}`);control.button.setAttribute('aria-required',String(source.required));
    if(active?.source===source&&(!source.isConnected||disabled))closePicker();
  }
  function closePicker(){
    if(!dialog?.open)return;const control=active;active=null;dialog.close();document.body.style.overflow=previousOverflow;
    if(control){control.button.setAttribute('aria-expanded','false');if(control.button.isConnected&&!control.button.disabled)control.button.focus({preventScroll:true});}
  }
  function choose(value,index){
    if(!active)return;const {source}=active;
    if(source.disabled||source.readOnly)return;
    const available=choicesFor(source),free=source.dataset.allowCustom==='true';
    const option=index===undefined?available.find(row=>row.value===value):available.find(row=>row.index===index&&row.value===value);
    if(!free&&(!option||option.disabled||option.hidden))return;
    if(source.tagName==='SELECT'&&option)source.selectedIndex=option.index;else source.value=value;
    sync(source);closePicker();source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));refresh();
  }
  function renderChoices(){
    if(!active)return;const source=active.source,query=search.value.trim().toLocaleLowerCase();list.replaceChildren();
    const choices=choicesFor(source).filter(row=>!row.hidden&&row.label.toLocaleLowerCase().includes(query));
    choices.forEach(option=>{const button=document.createElement('button');button.type='button';button.className='selection-option';button.disabled=Boolean(option.disabled);button.textContent=option.label||'Clear selection';const selected=source.tagName==='SELECT'?source.selectedIndex===option.index:source.value===option.value;button.setAttribute('aria-pressed',String(selected));if(selected)button.append(icon('check'));button.addEventListener('click',()=>choose(option.value,option.index));list.append(button);});
    if(source.dataset.allowCustom==='true'){
      const value=search.value.trim(),button=document.createElement('button');button.type='button';button.className='selection-option selection-custom';button.textContent=value?`Use ${value}`:'Clear mobile number';button.addEventListener('click',()=>choose(value));list.append(button);
    }
    if(!list.children.length){const empty=document.createElement('p');empty.className='selection-empty';empty.setAttribute('role','status');empty.textContent=query?'No matches found. Try another search.':'No options available yet.';list.append(empty);}
  }
  function makeDialog(){
    dialog=document.createElement('dialog');dialog.id='selectionDialog';dialog.className='selection-dialog';dialog.setAttribute('aria-labelledby','selectionTitle');
    dialog.innerHTML='<div class="selection-head"><h2 id="selectionTitle"></h2><button type="button" class="selection-close" aria-label="Close selection"></button></div><label class="selection-search"><span></span><input type="search" placeholder="Search options" aria-label="Search options" autocomplete="off"></label><p class="selection-error" role="alert" hidden></p><div class="selection-list"></div>';
    document.body.append(dialog);title=dialog.querySelector('h2');search=dialog.querySelector('input');list=dialog.querySelector('.selection-list');error=dialog.querySelector('.selection-error');dialog.querySelector('.selection-search span').append(icon('search'));
    const close=dialog.querySelector('.selection-close');close.append(icon('close'));close.addEventListener('click',closePicker);
    dialog.addEventListener('cancel',event=>{event.preventDefault();closePicker();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closePicker();}});
    search.addEventListener('input',renderChoices);
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Tab'){const items=Array.from(dialog.querySelectorAll('button:not(:disabled),input')).filter(node=>!node.hidden);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){const items=Array.from(list.querySelectorAll('button:not(:disabled)'));if(!items.length)return;event.preventDefault();const at=items.indexOf(document.activeElement),down=event.key==='ArrowDown',next=at<0?(down?0:items.length-1):(at+(down?1:-1)+items.length)%items.length;items[next].focus();}
      if(event.key==='Enter'&&event.target===search){event.preventDefault();list.querySelector('button:not(:disabled)')?.click();}
    });
  }
  function openPicker(source,invalid=false){
    sync(source);const control=controls.get(source);if(!control||control.button.disabled)return;
    if(dialog?.open)closePicker();if(!dialog)makeDialog();active=control;title.textContent=control.label;search.value='';search.inputMode=source.inputMode||'search';error.hidden=!invalid;error.textContent=invalid?`Please choose ${control.label.toLowerCase()}.`:'';renderChoices();
    previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();control.button.setAttribute('aria-expanded','true');
    // Keep the keyboard closed on touch; users can tap Search when they want to type.
    dialog.querySelector('.selection-close').focus({preventScroll:true});
  }
  function enhance(source){
    if(controls.has(source))return;
    const label=labelFor(source),wrapper=document.createElement('span'),button=document.createElement('button'),value=document.createElement('span');
    wrapper.className='search-select-control';button.type='button';button.className='search-select-trigger';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','selectionDialog');button.setAttribute('aria-expanded','false');value.className='search-select-value';button.append(value,icon('down'));
    source.before(wrapper);wrapper.append(source,button);source.classList.add('enhanced-select-source');source.tabIndex=-1;source.setAttribute('aria-hidden','true');
    if(source.id==='orderInvoiceMobile')source.dataset.allowCustom='true';
    const control={source,button,value,label};controls.set(source,control);
    // Never override native form-control properties. App renders and edit dialogs
    // refresh the trigger after setting values; native validation/events stay intact.
    button.addEventListener('click',()=>openPicker(source));button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openPicker(source);}});
    source.addEventListener('invalid',event=>{event.preventDefault();if(!dialog?.open)openPicker(source,true);});source.addEventListener('change',()=>sync(source));source.addEventListener('input',()=>sync(source));sync(source);
  }
  let disposed=false;
  function refresh(){
    if(disposed)return;
    if(supportsDialog){document.querySelectorAll('select:not([multiple]),input[list]').forEach(enhance);controls.forEach((control,source)=>{if(!source.isConnected){if(active===control)closePicker();controls.delete(source);}else sync(source);});}
    addIcons();
  }
  let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});}
  const observer=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#selectionDialog')))schedule();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','readonly','required','selected','value','hidden']});
  document.addEventListener('reset',()=>queueMicrotask(refresh),true);
  window.MughalControls={refresh,destroy(){closePicker();disposed=true;observer.disconnect();}};refresh();
})();
