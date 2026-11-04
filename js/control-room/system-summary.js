/* Read-only presentation of the existing owner-scoped event snapshot.
   Shared trace IDs group evidence; groups are never claimed to be incidents. */
(function (root) {
  'use strict';
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function time(event) { return event.occurred_at || event.created_at || ''; }
  function groupEvents(events) {
    const groups = new Map(), seen = new Set();
    (events || []).forEach((event, index) => {
      const identity = event.id == null ? 'row:' + index : JSON.stringify([event.source, event.id]);
      if (seen.has(identity)) return;
      seen.add(identity);
      const key = event.trace_id ? 'trace:' + event.trace_id : identity;
      if (!groups.has(key)) groups.set(key, {key, events: []});
      groups.get(key).events.push(event);
    });
    return [...groups.values()].map(group => {
      group.events.sort((a,b) => (Date.parse(time(b)) || 0) - (Date.parse(time(a)) || 0));
      group.level = group.events.some(e => e.level === 'error') ? 'error' : group.events.some(e => e.level === 'warn') ? 'warn' : 'info';
      group.latest = time(group.events[0]);
      group.success = group.events.find(e => ['ok','success','succeeded','done'].includes(e.outcome)) || null;
      return group;
    }).sort((a,b) => (Date.parse(b.latest) || 0) - (Date.parse(a.latest) || 0));
  }
  function date(value) { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Time not reported'; }
  function age(value) { const n=Date.parse(value); return Number.isFinite(n) ? Math.max(0,Math.floor((Date.now()-n)/60000)) + ' min ago' : 'Age unknown'; }
  function explain(event) {
    const name=String(event.event_name || ''), message=String(event.message || '');
    const job=name.match(/^core\.job\.(.+)\.(failed|retry|completed)$/);
    const names={local_analysis:'Local analysis',objective_reflection:'Objective review',prim3_agent_news:'Game news generation'};
    const title=job ? (names[job[1]] || job[1].replace(/_/g,' ')) + (job[2]==='failed'?' failed':job[2]==='retry'?' retry':' completed') : name || [event.method,event.route].filter(Boolean).join(' ') || 'Recorded event';
    let reason='The record does not establish the underlying cause.';
    if (/statement timeout/i.test(message)) reason='The database query exceeded its time limit.';
    else if (/fetch failed/i.test(message)) reason='A network request failed. The record does not establish which dependency caused it.';
    else if (/meta_error_190/i.test(message)) reason='The connected Meta service reported an authentication error. Inspect the channel connection.';
    const source={core:'Background work',worker:'API request or server activity',console:'This screen could not read a source',ledger:'Recorded operator or system change'}[String(event.source||'').toLowerCase()] || 'Source meaning not reported';
    return {title,reason,source};
  }
  function render(events, options) {
    options = options || {};
    if (!options.loaded) return '<section class="cr-system-summary"><h2>Event summary unavailable</h2><p>' + (options.pending ? 'Reading events…' : 'Read the events below before drawing a conclusion about system health.') + '</p></section>';
    const groups=groupEvents(events), total=groups.reduce((n,g)=>n+g.events.length,0), errors=groups.reduce((n,g)=>n+g.events.filter(e=>e.level==='error').length,0);
    return '<section class="cr-system-summary" aria-label="Grouped event timeline"><h2>What needs a closer look</h2><p><b>' + errors + ' error ' + (errors === 1 ? 'entry' : 'entries') + '</b> in ' + total + ' loaded events · ' + groups.length + ' evidence groups. These are not incident counts.' + (options.hasMore ? ' More events are available below.' : '') + '</p><p>Same trace = one request or operation. Different traces stay separate. The selected filters apply to this summary; a successful event does not prove recovery.</p><div class="cr-system-timeline">' + groups.map(g=>{
      const first=g.events.find(e=>e.level===g.level)||g.events[0], description=explain(first), label=g.level==='error'?'! Error recorded':g.level==='warn'?'△ Warning recorded':'i Activity recorded';
      const title=description.title;
      return '<details class="cr-system-event"><summary><span class="cr-system-level cr-system-level--'+g.level+'">'+label+'</span><strong>'+escape(title)+'</strong><span>'+g.events.length+' '+(g.events.length===1?'entry':'entries')+' · '+escape(age(g.latest))+'</span></summary><p><b>Meaning:</b> '+(g.level==='error'?'An operation recorded an error; the logs alone do not establish a wider outage.':g.level==='warn'?'An operation reported a warning and needs review.':'Recorded activity, not a failure by itself.')+' '+escape(description.reason)+'</p><p><b>Source:</b> '+escape(description.source)+'</p><p><b>Impact:</b> '+escape(first.resource_type ? 'Related record: '+first.resource_type+' '+(first.resource_id||'') : 'User impact is not reported in this event.')+'</p><p><b>Latest:</b> '+escape(date(g.latest))+'<br><b>Last reported success in this group:</b> '+escape(g.success ? date(time(g.success)) : 'Unknown in the loaded events')+'</p><p><b>Next:</b> Inspect the entries and their trace before deciding whether a repair is needed.</p><ol>'+g.events.map(e=>'<li><button type="button" class="cr-btn" data-action="inspect-observation" data-id="'+escape(e.id)+'">Inspect '+escape(e.level||'info')+' · '+escape(e.source||'source unknown')+' · '+escape(date(time(e)))+'</button><details><summary>Original event evidence</summary><pre>'+escape(JSON.stringify(e,null,2))+'</pre></details></li>').join('')+'</ol></details>';
    }).join('')+'</div>'+(total?'':'<p>No events match this loaded view. This does not prove that every service is healthy.</p>')+'</section>';
  }
  function dependencies(input) {
    const cards = [
      ['API', 'Receives app requests', input.api, 'api'],
      ['Database', 'Stores records and account data', input.database, 'db'],
      ['Core', 'Runs background work and AI', input.core, 'core']
    ];
    return '<section class="cr-system-summary"><h2>How requests reach your services</h2><p>App → API → database or Core. These are dependencies, not proof of what caused an error.</p><div class="cr-system-flow">'+cards.map(c=>'<button type="button" class="cr-system-node" data-action="inspect-service" data-key="'+c[3]+'"><b>'+c[0]+'</b><span>'+c[1]+'</span><strong>'+(c[2]===true?'✓ Check passed':c[2]===false?'! Check failed':'? Not reported')+'</strong></button>').join('')+'</div><p>Snapshot read: '+escape(date(input.at))+' · '+escape(age(input.at))+'. Last successful service check is not supplied by this snapshot.</p></section>';
  }
  root.CR=root.CR||{};root.CR.systemSummary={groupEvents,explain,render,dependencies};
})(typeof window==='undefined'?globalThis:window);
