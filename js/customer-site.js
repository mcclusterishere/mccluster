/* Account-scoped overview. Readiness is fetched, never inferred from a checkout return or local cache. */
(function () {
  'use strict';
  var root = document.getElementById('siteStatus');
  var generation = 0;
  var controller;
  var signIn = 'account.html?next=' + encodeURIComponent('customer-site.html');
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function action(parent, label, href, primary) {
    var a = el('a', label, 'site-action' + (primary ? ' site-action--primary' : ''));
    a.href = href; parent.appendChild(a); return a;
  }
  function card(parent, title) {
    var section = el('section', '', 'site-card'); section.appendChild(el('h2', title)); parent.appendChild(section); return section;
  }
  function actions(parent) { var row = el('div', '', 'site-actions'); parent.appendChild(row); return row; }
  function retry(parent) {
    var button = el('button', 'Refresh status', 'site-action'); button.type = 'button';
    button.addEventListener('click', load); parent.appendChild(button);
  }
  function signedOut() {
    root.replaceChildren(); var c = card(root, 'Start with your M Account');
    c.appendChild(el('p', 'Sign in to build and manage your own page. Existing membership and approval requirements still apply.'));
    action(actions(c), 'Sign in or create account', signIn, true);
    root.setAttribute('aria-busy', 'false');
  }
  function failure(c, result, subject) {
    if (result.status === 401) {
      c.appendChild(el('p', 'Your session has expired. Sign in again to check ' + subject + '.'));
      action(actions(c), 'Sign in again', signIn, true);
    } else if (result.status === 403) {
      c.appendChild(el('p', 'Your account does not currently have access to ' + subject + '. Check your account status.'));
      action(actions(c), 'Account status', signIn);
    } else {
      c.appendChild(el('p', 'We could not check ' + subject + '. No completed setup has been assumed. Try refreshing; if this continues, contact support with “' + subject + ' status unavailable”.'));
      retry(actions(c));
    }
  }
  function renderFront(result) {
    var c = card(root, 'Your free front page');
    c.appendChild(el('p', 'Use your M Account to create a page with your own media, words, and links.'));
    if (result.status === 409) {
      c.appendChild(el('p', 'Finish your profile and choose a handle before building your page.', 'site-status'));
      action(actions(c), 'Complete profile', 'mnet.html?view=profile', true); return;
    }
    if (!result.ok) { failure(c, result, 'your front page'); return; }
    var d = result.data;
    if (!d || d.ok !== true || typeof d.handle !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(d.handle)) {
      failure(c, {status:0}, 'your front page'); return;
    }
    var blocker = d.publish_blocker || (d.removed ? 'removed' : d.profile_visibility && d.profile_visibility !== 'public' ? 'private_profile' : null);
    var live = d.publicly_available === true && !!d.published && !blocker;
    var status = live ? 'Published' : d.published ? 'Saved publication · public availability not confirmed' : d.draft ? 'Draft saved · not published' : 'Ready to create your first draft';
    c.appendChild(el('p', status, 'site-status'));
    c.appendChild(el('p', '@' + d.handle));
    var row = actions(c);
    action(row, 'Manage project pages', 'customer-projects.html');
    action(row, d.draft ? 'Edit your page' : 'Build your page', 'front-studio.html', true);
    if (live) action(row, 'View published page', 'front.html?u=' + encodeURIComponent(d.handle));
    if (blocker === 'private_profile') {
      c.appendChild(el('p', 'Your profile is private. Review its visibility before publishing a public page.'));
      action(actions(c), 'Review profile visibility', 'mccluster-creator-studio.html');
    } else if (blocker === 'profile_required') {
      c.appendChild(el('p', 'Complete your profile before publishing.'));
      action(actions(c), 'Complete profile', 'mnet.html?view=profile');
    } else if (blocker === 'removed') {
      c.appendChild(el('p', 'This page has been removed and cannot be published. Contact support for a review.'));
    }
  }
  function renderBilling(result) {
    var grid = el('div', '', 'site-grid'); root.appendChild(grid);
    var c = card(grid, 'Site plans & business');
    c.appendChild(el('p', 'Paid workspaces are separate from your free front page. Payment and seller setup are checked in their management screens.'));
    if (!result.ok || !result.data || typeof result.data.paid !== 'boolean' || !Array.isArray(result.data.workspaces)) {
      failure(c, result.ok ? {status:0} : result, 'your site plan');
    } else {
      var workspaces = result.data.workspaces.filter(function (w) { return w && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(w.org_id); });
      c.appendChild(el('p', result.data.paid && workspaces.length ? 'Active workspace subscription' : 'No active workspace subscription', 'site-status'));
      workspaces.forEach(function (w) {
        var section = el('section'); section.appendChild(el('h3', 'Workspace ' + w.org_id));
        var row = actions(section);
        action(row, 'External social', 'customer-social.html?org_id=' + encodeURIComponent(w.org_id));
        c.appendChild(section);
      });
    }
    action(actions(c), 'Plans & seller setup', 'customer-commerce.html');
    var domains = card(grid, 'Your domain');
    domains.appendChild(el('p', 'Connect a domain you own and check ownership, DNS, and HTTPS status. Domain purchase and renewal availability is shown there.'));
    action(actions(domains), 'Manage domains', 'customer-domains.html');
    var content = card(grid, 'Your profile & music');
    content.appendChild(el('p', 'Update your identity, profile, and music using the existing account tools.'));
    var links = actions(content);
    action(links, 'Edit profile', 'mnet.html?view=profile'); action(links, 'Music studio', 'creator.html'); action(links, 'Music projects', 'music-workspace.html');
    var world = card(grid, 'Share in World');
    world.appendChild(el('p', 'Post to the site’s World feed. External social connections and publishing have separate setup and provider requirements.'));
    action(actions(world), 'Open World', 'mnet.html?view=feed');
  }
  function renderModules(result, token, id) {
    var c=card(root,'Website modules');
    if(!result.ok||!result.data||!Array.isArray(result.data.modules)) {
      c.appendChild(el('p','Website module settings are not available yet. Your account and saved pages remain separate.'));return;
    }
    var project=new URLSearchParams(location.search).get('project');
    c.appendChild(el('p',project?'Settings for project: '+project:'Settings for your personal website.'));
    result.data.modules.forEach(function(m){
      var row=el('div','', 'site-module');
      if(m.configurable&&m.key==='world_discovery') {
        var label=el('label'),input=el('input');input.type='checkbox';input.checked=m.enabled===true;
        label.append(input,document.createTextNode(' '+m.name));row.append(label);
        input.addEventListener('change',async function(){
          input.disabled=true;var wanted=input.checked;
          try {
            var response=await fetch('https://api.mccluster.org/v1/customer-site/modules'+(project?'?project='+encodeURIComponent(project):''),{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({module:m.key,enabled:wanted}),signal:controller.signal});
            if(!response.ok)throw Error('Settings could not be saved.');
            var d=await response.json();if(id!==generation)return;
            if(!d.modules.some(function(x){return x.key===m.key&&x.enabled===wanted;}))throw Error('Settings were not confirmed.');
            note.textContent=wanted?'World discovery is on. Create a listing and keep your page public to appear.':'World discovery is off. Your website is excluded from the directory.';
          }catch(e){if(id!==generation)return;input.checked=!wanted;note.textContent='Settings could not be saved. Please retry.';}
          finally{if(id===generation)input.disabled=false;}
        });
      } else row.appendChild(el('h3',m.name));
      var note=el('p',m.description);row.append(note);c.append(row);
    });
    action(actions(c),'Manage World listings','world-discover.html');
  }
  async function load() {
    var id = ++generation;
    if (controller) controller.abort();
    controller = new AbortController();
    root.replaceChildren(el('p', 'Checking your account…')); root.setAttribute('aria-busy', 'true');
    var session;
    try { session = await window.MCC.refreshIfNeeded(); } catch (_) { session = null; }
    if (id !== generation) return;
    if (!session || !session.access_token) { signedOut(); return; }
    var token = session.access_token;
    var requestController = controller;
    var timeout = setTimeout(function () { requestController.abort(); }, 12000);
    async function get(path) {
      try {
        var response = await fetch('https://api.mccluster.org' + path, {headers:{Authorization:'Bearer ' + token}, signal:requestController.signal, cache:'no-store'});
        var data = await response.json(); return {ok:response.ok, status:response.status, data:data};
      } catch (_) { return {ok:false, status:0}; }
    }
    var project=new URLSearchParams(location.search).get('project');
    var results = await Promise.all([get('/v1/fronts/me'), get('/v1/creator-billing/entitlement'), get('/v1/customer-site/modules'+(project?'?project='+encodeURIComponent(project):''))]);
    clearTimeout(timeout);
    if (id !== generation) return;
    if (!window.MCC.session() || window.MCC.session().access_token !== token) { load(); return; }
    root.replaceChildren(); renderFront(results[0]); renderModules(results[2],token,id); renderBilling(results[1]); retry(actions(root));
    root.setAttribute('aria-busy', 'false');
  }
  window.addEventListener('mcc:auth-changed', load);
  window.addEventListener('storage', function (e) { if (!e.key || e.key === 'mccdb_session' || e.key === 'mcc_sess_keep') load(); });
  load();
})();
