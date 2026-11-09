(function(root){
'use strict';
const cards=Object.freeze([
{id:'solar',theme:'energy',title:'Check your solar readiness',description:'Start with the building, its constraints and the questions an accredited installer would need to answer.',step:'Review official local planning and utility resources. List permission, roof and connection questions for a qualified installer. Do not climb roofs or do electrical work.',source:'https://drawdown.org/explorer/deploy-distributed-solar-pv',assessment:null},
{id:'heating',theme:'energy',title:'Investigate cleaner heating',description:'Understand the current system before comparing heat-pump options with qualified help.',step:'Record non-sensitive questions about comfort, insulation and heating needs. Ask a qualified professional about suitability, installation and local requirements. Do not modify equipment.',source:'https://drawdown.org/explorer/use-heat-pumps',assessment:null},
{id:'food',theme:'food',title:'Make food waste visible',description:'A measured baseline is a better starting point than a guessed impact number.',step:'Choose a safe way to record avoidable food waste over one week, then repeat after a small planning change. Label units and dates. Follow food-safety guidance; do not eat spoiled food.',source:'https://drawdown.org/explorer/reduce-food-loss-waste',assessment:null}
]);
const legacyKey='fyre-local-planning-v1';
// Invoked only by the explicit, confirmed cleanup action. Never inspect legacy data.
function clearLegacyNotes(storage){try{storage.removeItem(legacyKey);return true;}catch{return false;}}
const api=Object.freeze({cards,clearLegacyNotes});if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FyreModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
