(function(root){
const norm=s=>String(s).toLowerCase().trim().replace(/[–−—]/g,'-').replace(/\s+/g,' ').replace(/\s*([,-])\s*/g,'$1');
function accepted(m,value){return [m.name,...m.aliases].some(n=>norm(n)===norm(value));}
function update(old,ok,now=Date.now()){const streak=ok?(old?.streak||0)+1:0;return {seen:(old?.seen||0)+1,correct:(old?.correct||0)+(ok?1:0),streak,due:now+(ok?[600000,86400000,259200000,604800000][Math.min(streak-1,3)]:60000)};}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function choose(items,records,last){let pool=items.filter(x=>x.id!==last);if(!pool.length)pool=items;return [...pool].sort((a,b)=>{const pa=records[a.id],pb=records[b.id];const rank=p=>!p?1:p.due<=Date.now()?0:2;return rank(pa)-rank(pb)||(pa?.due||0)-(pb?.due||0);})[0];}
const api={norm,accepted,update,shuffle,choose};if(typeof module!=='undefined')module.exports=api;else root.ChemCore=api;
})(globalThis);
