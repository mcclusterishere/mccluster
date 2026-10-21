/* McCluster operator registry.
   There is one admin shell: control.html. Any owner palette outside Control
   points back into Control hashes instead of reopening retired rooms. */
(function (root) {
  "use strict";
  var SURFACES = [
    {id:"home",label:"Control Room",href:"control.html#home",group:"Control",blurb:"Attention, current work and platform state.",keywords:"home admin backend dashboard owner control",state:"live"},
    {id:"ai",label:"McCluster AI",href:"control.html#ai",group:"Control",blurb:"Persistent operator chat with canonical Core.",keywords:"ai chat qwen core agent assistant",state:"live"},
    {id:"inbox",label:"Work · Inbox",href:"control.html#work:inbox",group:"Work",blurb:"Incoming conversations and human takeover.",keywords:"inbox messages conversations reply communications",state:"live"},
    {id:"pipeline",label:"Work · Pipeline",href:"control.html#work:pipeline",group:"Work",blurb:"Leads and opportunities.",keywords:"crm front desk leads sales inquiries opportunities signups",state:"live"},
    {id:"people",label:"Work · People",href:"control.html#work:people",group:"Work",blurb:"People resolved from canonical business records.",keywords:"people contacts customers members",state:"live"},
    {id:"relationships",label:"Work · Relationships",href:"control.html#work:relationships",group:"Work",blurb:"Clients, partners, sponsors and vendors, linked to canonical companies and people.",keywords:"relationships clients partners sponsors vendors accounts history",state:"live"},
    {id:"projects",label:"Work · Projects",href:"control.html#work:projects",group:"Work",blurb:"Post-sale service projects and their delivery.",keywords:"projects service client work scope delivery",state:"live"},
    {id:"deliverables",label:"Work · Deliverables",href:"control.html#work:deliverables",group:"Work",blurb:"What each project owes, and whether it was approved.",keywords:"deliverables handoff approval artifacts",state:"live"},
    {id:"payments",label:"Work · Payments",href:"control.html#work:payments",group:"Work",blurb:"Service payments billed and received, with verification state.",keywords:"payments invoices billing paid due money revenue",state:"live"},
    {id:"renewals",label:"Work · Renewals",href:"control.html#work:renewals",group:"Work",blurb:"Recurring client obligations and upcoming renewals.",keywords:"renewals recurring hosting retainer subscription",state:"live"},
    {id:"clients",label:"Work · Clients",href:"control.html#work:clients",group:"Work",blurb:"Client work and site requests.",keywords:"clients business console sites requests changes",state:"live"},
    {id:"outreach",label:"Work · Outreach",href:"control.html#work:outreach",group:"Work",blurb:"Templates, outbound email and follow-up.",keywords:"outreach desk email campaign followup templates unsubscribe mail",state:"live"},
    {id:"operations",label:"Work · Operations",href:"control.html#work:operations",group:"Work",blurb:"Orders, merch, walls and rights operations.",keywords:"back office orders bookings merch prints rights gallery",state:"live"},
    {id:"projects",label:"Create · Projects",href:"control.html#create:projects",group:"Create",blurb:"Creative objectives and media generation.",keywords:"projects studio create generate media campaigns canvas",state:"live"},
    {id:"library",label:"Create · Library",href:"control.html#create:library",group:"Create",blurb:"Canonical assets.",keywords:"library assets files media",state:"live"},
    {id:"schedule",label:"Create · Schedule",href:"control.html#create:schedule",group:"Create",blurb:"Publishing queue and distribution schedule.",keywords:"schedule calendar publish posts",state:"live"},
    {id:"channels",label:"Create · Channels",href:"control.html#create:channels",group:"Create",blurb:"Social destinations, composer and campaign connections.",keywords:"socials room instagram facebook tiktok youtube channels composer",state:"live"},
    {id:"music",label:"Create · Music",href:"control.html#create:music",group:"Create",blurb:"Review, catalogue, rights and distribution.",keywords:"music review desk vault lanes isrc catalog catalogue rights release distribution",state:"live"},
    {id:"analytics",label:"Analytics",href:"control.html#analytics",group:"Analytics",blurb:"Traffic, audience, content, identity, commerce and forensics.",keywords:"analytics insights traffic visitors sessions funnel attribution forensics telemetry charts",state:"live"},
    {id:"system-overview",label:"System · Overview",href:"control.html#system:overview",group:"System",blurb:"Platform topology and service health.",keywords:"system health ovh cloudflare supabase infrastructure",state:"live"},
    {id:"system-workload",label:"System · Workload",href:"control.html#system:workload",group:"System",blurb:"Agents, jobs, queues and failures.",keywords:"workload jobs agents queues runs failures",state:"live"},
    {id:"system-observability",label:"System · Observability",href:"control.html#system:observability",group:"System",blurb:"Incidents, traces and failure evidence.",keywords:"observability logs traces incidents errors",state:"live"},
    {id:"system-resources",label:"System · Resources",href:"control.html#system:resources",group:"System",blurb:"Providers, usage and API resources.",keywords:"resources providers spend usage api integrations",state:"live"},
    {id:"apps",label:"Apps",href:"control.html#apps",group:"Control",blurb:"Specialized product workspaces.",keywords:"apps whip prim3 halo spatial manufacture",state:"live"}
  ];
  var GROUPS=["Control","Work","Create","Analytics","System"];
  function words(value){return " "+String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()+" ";}
  function search(q){
    q=String(q||"").trim().toLowerCase();
    if(!q)return SURFACES.slice();
    var STOP=/^(a|an|the|my|me|i|is|are|was|to|of|in|on|for|and|or|do|did|does|show|see|get|go|who|what|where|how|can|all)$/;
    var terms=q.split(/\s+/).filter(function(t){return t.length>=3&&!STOP.test(t);});
    if(!terms.length)return SURFACES.slice();
    return SURFACES.map(function(s){
      var label=s.label.toLowerCase(),hay=words(s.label+" "+s.group+" "+s.blurb+" "+s.keywords),score=0;
      terms.forEach(function(t){
        if(label.indexOf(t)===0)score+=100;
        else if(label.indexOf(t)>=0)score+=50;
        else if(hay.indexOf(" "+t+" ")>=0)score+=10;
      });
      return{s:s,score:score};
    }).filter(function(x){return x.score>0;})
      .sort(function(a,b){return b.score-a.score||a.s.label.localeCompare(b.s.label);})
      .map(function(x){return x.s;});
  }
  function byGroup(){return GROUPS.map(function(g){return{group:g,items:SURFACES.filter(function(s){return s.group===g;})};}).filter(function(g){return g.items.length;});}
  root.MCC_SURFACES={all:SURFACES,groups:GROUPS,byGroup:byGroup,search:search,get:function(id){return SURFACES.find(function(s){return s.id===id;})||null;}};
})(window);
