/* Native Control destination. All private reads use the shell's account-fenced
 * request function; state belongs to this mount, never localStorage. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Number.isSafeInteger(n) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100) : 'Unknown';
  function render() {
    return '<section class="cr-panel2" data-rental-admin><header class="cr-panel2__head"><h2>Whip Equipped · Vehicle market</h2></header><div class="cr-panel2__body">' +
      '<p><a href="mnet.html?mode=travel">Open the same transport globe</a> · Self-drive rentals from Whip Equipped LLC, a separate company.</p>' +
      '<p><strong>Preparation only. Booking, buying and publishing are closed.</strong> Stored records are not verified vehicles or availability. No real cars are prefilled.</p>' +
      '<p>One vehicle may eventually have a sale price and a weekly rental rate. Buying house-owned cars with Square is planned; card payment is not financing. Seller accounts, title uploads and social features come later.</p>' +
      '<label>Operator <select data-rental-tenant aria-label="Rental operator"><option value="">Load your operators first</option></select></label> ' +
      '<button type="button" class="cr-btn" data-rental-load>Load my operators</button>' +
      '<p data-rental-message role="status" aria-live="polite">No private data has been loaded.</p><div data-rental-content></div></div></section>';
  }
  function bind(root, ctx) {
    const host=root.querySelector('[data-rental-admin]'); if(!host || host.dataset.bound) return; host.dataset.bound='true';
    const select=host.querySelector('[data-rental-tenant]'), message=host.querySelector('[data-rental-message]'), content=host.querySelector('[data-rental-content]');
    let sequence=0, busy=false, selected='', offset=0, records=null;
    const say=s=>{if(host.isConnected)message.textContent=s;};
    const clear=()=>{records=null;content.replaceChildren();};
    async function load(page=0) {
      const seq=++sequence, tenant=select.value; clear(); selected=tenant; offset=page;
      if(!tenant){say('Choose an authorized operator.');return;}
      say('Loading stored fleet and booking records…');
      try {
        const result=await ctx.request('/api/operators/'+encodeURIComponent(tenant)+'/rentals?offset='+page);
        if(seq!==sequence||!host.isConnected||tenant!==select.value)return;
        if(result.source!=='stored_records'||!Array.isArray(result.vehicles)||!Array.isArray(result.bookings))throw Error('Rental admin response is unavailable.');
        records=result; draw(); say('Loaded stored records. Clearance, availability and ownership remain unverified.');
      } catch(e){if(seq===sequence){clear();say(e.message+' No sample data is substituted.');}}
    }
    host.querySelector('[data-rental-load]').onclick=async()=>{
      if(busy)return; const seq=++sequence;clear();select.replaceChildren();selected='';say('Checking your operator memberships…');
      try {
        const result=await ctx.request('/api/operators/mine'); if(seq!==sequence||!host.isConnected)return;
        const tenants=(result.tenants||[]).filter(t=>['owner','admin'].includes(t.role));
        select.innerHTML='<option value="">Choose operator</option>'+tenants.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+' · '+esc(t.role)+'</option>').join('');
        say(tenants.length?'Choose an operator to load its records.':'No owner/admin rental membership found. No fleet access has been granted.');
      }catch(e){say(e.message);}
    };
    select.onchange=()=>{if(!busy)load();};
    function draw(edit=null) {
      content.innerHTML='<h3>Launch review</h3><p>Not verified: owner consent and title; direct rental versus qualifying peer-to-peer authority; rental insurance; safety and availability; renter clearance and agreement; payment fulfillment; atomic booking holds.</p>'+
        '<h3>Fleet records · page '+(offset/50+1)+'</h3><p>Weekly amounts below are seven times the stored daily planning rate, not quotes. Sale prices are not configured. A legacy available flag does not prove availability.</p>'+
        (records.vehicles.length?records.vehicles.map(v=>'<article class="cr-panel2"><div class="cr-panel2__body"><h4>'+esc(v.name)+'</h4><p>'+esc(v.category)+' · '+esc(v.location_label)+'</p><p>Rental planning rate: '+money(v.daily_rate_cents)+'/day · '+money(v.daily_rate_cents*7)+'/week<br>Sale price: not configured · Buying closed<br>Stored availability flag: '+(v.available?'on (unverified)':'off')+'</p><button class="cr-btn" type="button" data-rental-edit="'+esc(v.id)+'">Edit preparation record</button></div></article>').join(''):'<p>No stored vehicles on this page. This does not establish fleet availability.</p>')+
        '<h3>Booking records</h3><p>Read-only stored history; statuses are not new reservations or verified fulfillment.</p>'+
        (records.bookings.length?'<ul>'+records.bookings.map(b=>'<li>'+esc(b.id)+' · '+esc(b.status)+' · '+esc(b.payment_status)+' · '+money(b.total_cents)+'<br>'+esc(b.start_at)+' → '+esc(b.end_at)+'</li>').join('')+'</ul>':'<p>No stored booking records on this page.</p>')+
        '<button type="button" class="cr-btn" data-rental-prev '+(!offset?'disabled':'')+'>Previous page</button> <button type="button" class="cr-btn" data-rental-next '+(records.next_offset===null?'disabled':'')+'>Next page</button> <button type="button" class="cr-btn" data-rental-refresh>Reload records</button>'+
        '<h3>'+(edit?'Edit':'Add')+' unpublished preparation record</h3><p>Use a non-sensitive vehicle label and general area only. No VIN, plate, exact pickup address, owner details or title documents. Saving keeps the record unavailable; it does not verify consent or insurance.</p>'+
        '<form data-rental-form><div class="cr-rental-fields">'+[
          ['name','Vehicle label',edit?.name||''],['category','Category',edit?.category||''],['location_label','General pickup area',edit?.location_label||'']
        ].map(([k,label,v])=>'<label>'+label+'<input name="'+k+'" required maxlength="100" value="'+esc(v)+'"></label>').join('')+
        '<label>Planning daily rate (USD cents)<input name="daily_rate_cents" type="number" required min="1" max="1000000" step="1" value="'+esc(edit?.daily_rate_cents||'')+'"></label></div><button class="cr-btn" type="submit">Save unpublished record</button> '+(edit?'<button class="cr-btn" type="button" data-rental-cancel>Cancel edit</button>':'')+'</form>';
      content.querySelectorAll('[data-rental-edit]').forEach(button=>button.onclick=()=>{draw(records.vehicles.find(v=>v.id===button.dataset.rentalEdit));content.querySelector('input').focus();});
      content.querySelector('[data-rental-prev]').onclick=()=>load(Math.max(0,offset-50));
      content.querySelector('[data-rental-next]').onclick=()=>load(records.next_offset);
      content.querySelector('[data-rental-refresh]').onclick=()=>load(offset);
      content.querySelector('[data-rental-cancel]')?.addEventListener('click',()=>draw());
      content.querySelector('form').onsubmit=async event=>{
        event.preventDefault();if(busy)return;busy=true;const tenant=selected,seq=++sequence;
        const form=new FormData(event.currentTarget),body=Object.fromEntries(form);body.daily_rate_cents=Number(body.daily_rate_cents);
        if(edit)body.expected_updated_at=edit.updated_at;
        const controls=[...host.querySelectorAll('button,input,select')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);say('Saving unpublished record…');
        try {
          const result=await ctx.request('/api/operators/'+encodeURIComponent(tenant)+'/vehicles'+(edit?'/'+encodeURIComponent(edit.id):''),{method:edit?'PATCH':'POST',body});
          if(seq!==sequence||!host.isConnected)return;
          if(!result.vehicle||result.vehicle.available!==false)throw Error('Save was not confirmed as unpublished. Reload before retrying.');
          await load(offset);say('Saved unpublished record to the backend. Bookings and purchases remain closed.');
        }catch(e){if(seq===sequence)say(e.message+' Reload records before retrying; a lost response may follow a completed save.');}
        finally{busy=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});}
      };
    }
  }
  window.CR.rentals={render,bind};
})();
