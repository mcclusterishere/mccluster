import {createCompanyOperations} from '../../src/company-operations/service.js';
import {CompanyOperationError} from '../../src/company-operations/domain.js';
export const ORG = '00000000-0000-4000-8000-000000000001';
export const OTHER_ORG = '00000000-0000-4000-8000-000000000002';
export const OWNER = '00000000-0000-4000-8000-000000000011';
export const REVIEWER = '00000000-0000-4000-8000-000000000012';
export const COMPANY = '00000000-0000-4000-8000-000000000021';
export const AT = '2026-11-09T12:00:00.000Z';
export const SHA = 'a'.repeat(64);
export const register = {id:'register', type:'register_company', data:{name:'Synthetic Example Corporation',form:'for_profit_corporation',jurisdiction:'US-CT',currency:'USD',currencyExponent:2}};
export const document = (id, kind) => ({id: 'doc-' + id, type:'record_document', data:{id,kind,artifactRef:'artifact-' + id,sha256:SHA,effectiveDate:'2026-11-09'}});
export const ownership = {id:'ownership',type:'record_ownership_snapshot',data:{id:'snapshot',effectiveDate:'2026-11-09',sourceDocument:'register-doc',supersedes:null,
  classes:[{id:'common',authorizedUnits:'1000',outstandingUnits:'3',unitScale:0,allocationBasis:'equal_per_unit',holdings:[{partyRef:'synthetic-party-a',units:'1'},{partyRef:'synthetic-party-b',units:'2'}]}]}};
export const draft = {id:'draft',type:'draft_declaration',data:{id:'declaration',kind:'cash_dividend',snapshotId:'snapshot',classId:'common',totalMinor:'100',currency:'USD',recordDate:'2026-11-09',payableDate:'2026-11-10'}};
export const review = {id:'review',type:'record_declaration_review',data:{declarationId:'declaration',termsRevision:1,decision:'approve',legalDocument:'legal',accountingDocument:'accounting'}};
export const declare = {id:'declare',type:'record_declaration',data:{declarationId:'declaration',termsRevision:1,resolutionDocument:'resolution',declaredDate:'2026-11-09'}};
export function fixture(custom = {}) {
  const events = new Map(); let revoked = false;
  const authorize = async session => {if (revoked) throw new CompanyOperationError('owner_required',403);
    return {orgId: session?.orgId || ORG, actorId: session?.actorId || OWNER, role: session?.role || 'owner',enabled:true,human:session?.human !== false};};
  const key = (p,c) => p.orgId+':'+c;
  const store = {
    async read(p,c) {return structuredClone(events.get(key(p,c)) || []);},
    async append(p,c,expected,event) {
      const rows=events.get(key(p,c)) || [], old=rows.find(x=>x.command.id===event.command.id);
      if (old) return structuredClone(old);
      if (rows.length!==expected) throw new CompanyOperationError('revision_conflict',409);
      events.set(key(p,c), [...rows,structuredClone(event)]); return structuredClone(event);
    }
  };
  const service=createCompanyOperations({store,authorize,verifyArtifact:async (p,ref)=>({orgId:p.orgId,artifactRef:ref,sha256:SHA,immutable:true}),now:()=>AT,...custom});
  const command=async (c,session={})=>service.command(session,COMPANY,{expectedRevision:(await service.read(session,COMPANY)).revision,command:structuredClone(c)});
  const prepare=async (through='draft')=>{
    for(const c of [register,document('register-doc','ownership_register'),document('legal','legal_review'),document('accounting','accounting_review'),document('resolution','resolution'),document('correction','correction'),ownership,draft])await command(c);
    if(through==='draft')return;
    await command({id:'submit',type:'submit_declaration_review',data:{declarationId:'declaration'}});
    if(through==='in_review')return;
    await command(review,{actorId:REVIEWER});
    if(through==='reviewed')return;
    await command(declare);
    if(through==='declared')return;
    await command({id:'handoff',type:'prepare_handoff',data:{declarationId:'declaration'}});
  };
  return {service,store,events,command,prepare,revoke:()=>{revoked=true;}};
}
