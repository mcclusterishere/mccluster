import {Validator,format} from '@cfworker/json-schema';
// Interpreter supports complete draft 4/7/2019-09/2020-12 validation without
// eval/new Function, which workerd disallows. Never fetch remote schema refs.
const drafts=new Map([
 ['http://json-schema.org/draft-04/schema#','4'],['http://json-schema.org/draft-07/schema#','7'],
 ['https://json-schema.org/draft/2019-09/schema','2019-09'],['https://json-schema.org/draft/2020-12/schema','2020-12']
]);
export function validateRegistrationSchema(schema,body) {
 try {
  if(!schema||typeof schema!=='object'||JSON.stringify(schema).length>131072||JSON.stringify(body).length>16384)return false;
  const draft=schema.$schema?drafts.get(schema.$schema):'7';if(!draft)return false;
  let nodes=0;
  const walk=(value,depth=0)=>{
   if(++nodes>10000||depth>40)throw Error('Schema limit');
   if(!value||typeof value!=='object')return;
   for(const [key,v] of Object.entries(value)){
    if(key==='format'&&(typeof v!=='string'||typeof format[v]!=='function'))throw Error('Unsupported assertion format');
    if(['$ref','$recursiveRef','$dynamicRef'].includes(key)&&(typeof v!=='string'||!v.startsWith('#')))throw Error('External schema reference');
    walk(v,depth+1);
   }
  };walk(schema);
  return new Validator(schema,draft,true).validate(body).valid===true;
 }catch{return false;}
}
