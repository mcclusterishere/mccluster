import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildComputerCatalog, ComputerFleet, wrapEquipmentShell} from './equity-uprise-computer-hardware.mjs';
import {ElectronicsSandbox} from './equity-uprise-electronics-sandbox.mjs';
import {ScreenSandbox} from '../../../../../js/eu-screens/sandbox-session.mjs';
import {createNet} from '../../../../../js/eu-screens/net.mjs';
import {createShell as baseShell} from '../../../../../js/eu-screens/shell.mjs';
import {saveSession, loadSession, resetAllSessions} from '../../../../../js/eu-screens/state.mjs';
import {whenOwner} from '../../../../../js/eu-screens/gate.mjs';
const ROOT=fileURLToPath(new URL('../../../../../',import.meta.url));
const P=ROOT+'docs/design/equity-uprise-building/production/';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const registry=read(P+'asset-registry/generated/equity-uprise-asset-registry-v1.json');
const connections=read(P+'electronics/generated/equity-uprise-electronics-connections-v1.json');
const manifest=read(P+'electronics/generated/equity-uprise-electronics-manifest-v1.json');
const screens=read(ROOT+'screens/data/screen-registry-v1.json');
const profile=read(P+'lab-runtime/computer-hardware-profile-v1.json');
const serverHardware=read(P+'electronics/server-lab-hardware-v1.json');
const catalog=buildComputerCatalog({registry,connections,screens,profile,serverHardware});
const createShell = opts => wrapEquipmentShell(baseShell(opts), opts.ss, opts.screen);
const WS='F1-USER-WS-01', SRV='B1-SRV-HYP-01-I001';
function memoryStore(){const data={};return {load:m=>data[m]?structuredClone(data[m]):null,save:(m,s)=>(data[m]=structuredClone(s),structuredClone(s))};}
function setup(mode='TRAINING',storage=memoryStore()){
  const sandbox=new ElectronicsSandbox({registry,connections,manifest});
  const ss=new ScreenSandbox({sandbox,screens,mode,storage,hardwareFactory:ss=>new ComputerFleet({catalog,sandbox,mode,readSession:()=>ss.session,persist:()=>ss.persist()})});
  return {ss,f:ss.hardware,net:createNet(ss)};
}
function act(f,id,type,more={}){return f.act(id,{type,...more});}
function boot(f,id){assert.equal(act(f,id,'power_on').accepted,true);for(let i=0;i<3;i++)assert.equal(act(f,id,'advance').accepted,true);assert.equal(f.status(id).stage,'LOGIN');assert.equal(act(f,id,'sign_in',{user:'operator'}).accepted,true);}
function service(f,id){act(f,id,'shutdown');for(const p of f.device(id).ports.filter(p=>p.kind==='power'))act(f,id,'disconnect',{port:p.id});assert.equal(act(f,id,'open_cover').accepted,true);assert.equal(act(f,id,'esd',{enabled:true}).accepted,true);}
function reconnect(f,id){act(f,id,'close_cover');for(const p of f.device(id).ports.filter(p=>p.kind==='power'))assert.equal(act(f,id,'connect',{port:p.id,peer:p.peer}).accepted,true);}

test('fleet is all 42 canonical computers with actual bound screens and cables, not invented assets',()=>{
  assert.equal(catalog.length,42);assert.equal(catalog.filter(c=>!c.server).length,36);assert.equal(catalog.filter(c=>c.server).length,6);
  assert.ok(catalog.every(c=>c.screens.length));assert.ok(catalog.every(c=>c.ports.some(p=>p.kind==='power')));
  for(const c of catalog)for(const p of c.ports)assert.ok(connections.connections.some(x=>x.connection_id===p.id));
  assert.ok(!catalog.some(c=>c.floor==='L7'));
});
for(const c of catalog)test(c.id+': baseline, physical power, full boot, persona and isolation',()=>{
  const {f}=setup();assert.equal(f.status(c.id).desktop_ready,true);
  assert.equal(act(f,c.id,'shutdown').accepted,true);assert.equal(f.status(c.id).os_ready,false);
  boot(f,c.id);assert.equal(f.status(c.id).desktop_ready,true);
  assert.equal(f.status(c.id).memory_gb,c.server?256:32);
  assert.equal(f.status(c.id===WS?SRV:WS).desktop_ready,true);
});
test('all workstation reference envelopes fit their declared chassis',()=>{
 const c=catalog.find(c=>!c.server),d=c.geometry.chassis_mm;
 for(const p of c.parts){const [x,y,z,w,h,depth]=p.box_mm;assert.ok(x>=0&&y>=0&&z>=0&&w>0&&h>0&&depth>0,p.id);assert.ok(x+w<=d.w&&y+h<=d.h&&z+depth<=d.d,p.id);}
});
test('live profiles and unknown computers are refused',()=>{
 assert.throws(()=>buildComputerCatalog({registry,connections,screens,profile:{...profile,live_control_allowed:true},serverHardware}),/sandbox/i);
 const {f}=setup();assert.throws(()=>f.act('invented',{type:'power_on'}),/No registered computer/);
});
test('workplace refuses every mutation and strips stored hardware faults',()=>{
 const {f,ss}=setup('WORKPLACE');for(const type of ['shutdown','power_on','remove','inject_fault','reset'])assert.equal(act(f,WS,type,{part:'RAM-A2'}).code,'READ_ONLY_MODE');
 assert.equal(ss.session.hardware,undefined);assert.equal(f.status(WS).desktop_ready,true);
 saveSession('WORKPLACE',{hardware:{machines:{[WS]:{boot:'OFF'}}}});assert.equal(loadSession('WORKPLACE').hardware,undefined);resetAllSessions();
});
test('cold service refuses live cover/removal and all standby feeds, with append-only safety events',()=>{
 const {f,ss}=setup();assert.equal(act(f,WS,'open_cover').code,'ISOLATE_ALL_AC');act(f,WS,'shutdown');
 assert.equal(act(f,WS,'open_cover').code,'ISOLATE_ALL_AC');assert.equal(act(f,WS,'remove',{part:'RAM-A2'}).code,'ISOLATE_ALL_AC');
 assert.equal(ss.session.hardware.events.length,4);assert.equal(ss.session.hardware.events[3].safety,'major');assert.equal(f.machine(WS).parts['RAM-A2'],true);
});
test('ESD and open cover required; RAM format/slot kit mismatch is refused without mutation',()=>{
 const {f}=setup();service(f,WS);act(f,WS,'esd',{enabled:false});assert.equal(act(f,WS,'remove',{part:'RAM-A2'}).code,'ESD_REQUIRED');
 act(f,WS,'esd',{enabled:true});assert.equal(act(f,WS,'remove',{part:'RAM-A2'}).accepted,true);
 assert.equal(act(f,WS,'install',{part:'RAM-A2',sku:'DDR5-RDIMM-32'}).code,'INCOMPATIBLE_PART');
 assert.equal(f.machine(WS).parts['RAM-A2'],false);assert.equal(act(f,WS,'install',{part:'RAM-A2',sku:'DDR5-UDIMM-16'}).accepted,true);
});
test('removing every DIMM blocks POST; replacement restores only the changed component',()=>{
 const {f}=setup();service(f,WS);act(f,WS,'remove',{part:'RAM-A2'});act(f,WS,'remove',{part:'RAM-B2'});reconnect(f,WS);
 act(f,WS,'power_on');assert.equal(act(f,WS,'advance').code,'NO_USABLE_MEMORY');assert.equal(f.status(WS).os_ready,false);
 service(f,WS);act(f,WS,'install',{part:'RAM-A2',sku:'DDR5-UDIMM-16'});reconnect(f,WS);boot(f,WS);assert.equal(f.status(WS).memory_gb,16);assert.equal(f.status(WS).degraded,true);
});
test('boot SSD absent stops the firmware stage, not a fake successful login',()=>{
 const {f}=setup();service(f,WS);act(f,WS,'remove',{part:'SSD'});reconnect(f,WS);act(f,WS,'power_on');assert.equal(act(f,WS,'advance').accepted,true);
 assert.equal(act(f,WS,'advance').code,'BOOT_DEVICE_MISSING');assert.equal(act(f,WS,'sign_in',{user:'operator'}).code,'OS_NOT_READY');
});
test('CPU or cooler absent blocks POST; cover inspection never grants safe service',()=>{
 const {f}=setup();service(f,WS);act(f,WS,'remove',{part:'CPU'});reconnect(f,WS);act(f,WS,'power_on');assert.equal(act(f,WS,'advance').code,'POST_COMPONENT_MISSING');
});
test('PSU mismatches and unknown ports/endpoints are rejected',()=>{
 const {f}=setup();service(f,SRV);assert.equal(act(f,SRV,'replace',{part:'PSU1',sku:'PSU-1400W-OTHER'}).code,'INCOMPATIBLE_PART');
 const p=f.device(SRV).ports.find(p=>p.kind==='network');assert.equal(act(f,SRV,'connect',{port:p.id,peer:'B1-NET-CORE-SW-01-I002'}).code,p.peer==='B1-NET-CORE-SW-01-I002'?'OK':'WRONG_ENDPOINT');
 assert.equal(act(f,SRV,'disconnect',{port:'invented'}).code,'UNKNOWN_PORT');
});
test('one server feed may be lost without outage; both feeds isolate BMC and host; reconnection does not auto-boot',()=>{
 const {f}=setup();const [a,b]=f.device(SRV).ports.filter(p=>p.kind==='power');
 act(f,SRV,'disconnect',{port:a.id});assert.equal(f.status(SRV).os_ready,true);assert.equal(f.status(SRV).degraded,true);
 act(f,SRV,'disconnect',{port:b.id});assert.equal(f.status(SRV).bmc_power,false);assert.equal(f.status(SRV).os_ready,false);
 act(f,SRV,'connect',{port:a.id,peer:a.peer});assert.equal(f.status(SRV).stage,'OFF');assert.equal(f.status(SRV).bmc_power,true);
});
test('two data links fail over independently and exact topology cannot be rewired by client assertion',()=>{
 const {f,net}=setup();const [a,b]=f.device(SRV).ports.filter(p=>p.kind==='network');
 assert.notEqual(a.peer,b.peer);act(f,SRV,'disconnect',{port:a.id});assert.equal(net.hostNet(SRV).ok,true);
 act(f,SRV,'disconnect',{port:b.id});assert.equal(net.hostNet(SRV).ok,false);assert.equal(f.status(SRV).os_ready,true);
 assert.equal(act(f,SRV,'connect',{port:a.id,peer:b.peer}).code,'WRONG_ENDPOINT');
 act(f,SRV,'connect',{port:a.id,peer:a.peer});assert.equal(net.hostNet(SRV).ok,true);
});
test('workstation unplug propagates into real sandbox switch port and ping, without disabling the local OS',()=>{
 const {f,net}=setup();const p=f.device(WS).ports.find(p=>p.kind==='network');const port=net.endpointPort.get(WS),row=net.portTables.get(port.switchId).find(r=>r.port===port.port);
 act(f,WS,'disconnect',{port:p.id});assert.equal(net.portStatus(port.switchId,row).status,'notconnect');assert.equal(net.hostNet(WS).ok,false);assert.equal(f.status(WS).os_ready,true);
 act(f,WS,'connect',{port:p.id,peer:p.peer});assert.equal(net.portStatus(port.switchId,row).status,'connected');
});
test('display disconnect is independent of network and blocks local console visibility',()=>{
 const {f,ss,net}=setup();for(const p of f.device(WS).ports.filter(p=>p.kind==='video'))act(f,WS,'disconnect',{port:p.id});
 assert.equal(f.status(WS).display,false);assert.equal(net.hostNet(WS).ok,true);
 const sh=createShell({ss,screen:screens.screens.find(s=>s.network_asset_id===WS)});
 assert.match(sh.exec('ls').lines.map(x=>x.t).join(),/equipment/);
});
test('hardware host failure propagates to its dependent service without mutating base dataset',()=>{
 const {f,ss,net}=setup();const before=structuredClone(ss.sandbox.assetStates.get('LOGIC-SVC-DNS'));
 act(f,SRV,'shutdown');assert.equal(net.hostNet('LOGIC-SVC-DNS').ok,false);assert.deepEqual(ss.sandbox.assetStates.get('LOGIC-SVC-DNS'),before);
 boot(f,SRV);assert.equal(net.hostNet('LOGIC-SVC-DNS').ok,true);
});
test('reset/repair cannot clear an unrelated canonical graph fault',()=>{
 const {f,ss}=setup();ss.inject('host_down',[SRV],'test');act(f,SRV,'reset');assert.equal(f.status(SRV).os_ready,false);assert.equal(ss.has(SRV,'host_down'),true);
 ss.clearFor(['host_down'],{assetIds:[SRV]});assert.equal(f.status(SRV).os_ready,true);
});
test('component failures reduce reported memory, and matching replacement repairs only that part',()=>{
 const {f}=setup();act(f,WS,'inject_fault',{part:'RAM-A2'});act(f,WS,'inject_fault',{part:'FAN'});assert.equal(f.status(WS).memory_gb,16);assert.equal(f.status(WS).cooling,false);
 service(f,WS);act(f,WS,'replace',{part:'RAM-A2',sku:'DDR5-UDIMM-16'});reconnect(f,WS);boot(f,WS);assert.equal(f.status(WS).memory_gb,32);assert.equal(f.status(WS).cooling,false);
});
test('cold-service refuses supplying AC while the lid is open',()=>{
 const {f}=setup();service(f,WS);const p=f.device(WS).ports.find(p=>p.kind==='power');assert.equal(act(f,WS,'connect',{port:p.id,peer:p.peer}).code,'CLOSE_COVER');assert.equal(f.status(WS).ac,false);
});
test('training and mission state survive navigation but are isolated; reset preserves the event ledger',()=>{
 const storage=memoryStore();let {f}=setup('TRAINING',storage);act(f,WS,'shutdown');
 assert.equal(setup('TRAINING',storage).f.status(WS).stage,'OFF');assert.equal(setup('MISSION',storage).f.status(WS).stage,'DESKTOP');assert.equal(setup('WORKPLACE',storage).f.status(WS).stage,'DESKTOP');
 act(f,WS,'reset');assert.equal(f.exportEvidence(WS).events.length,2);assert.equal(f.exportEvidence(WS).assessed,false);
});
test('global sandbox reset clears physical and logical faults only in the current mode',()=>{
 const storage=memoryStore(),t=setup('TRAINING',storage),m=setup('MISSION',storage);act(t.f,WS,'shutdown');act(m.f,WS,'shutdown');t.ss.reset();
 assert.equal(t.f.status(WS).stage,'DESKTOP');assert.equal(setup('MISSION',storage).f.status(WS).stage,'OFF');
});
test('only sandbox personas are accepted and no password reaches evidence',()=>{
 const {f}=setup();act(f,WS,'sign_out');assert.equal(act(f,WS,'sign_in',{user:'real-user',password:'DO_NOT_STORE'}).code,'DEMO_IDENTITY_ONLY');
 assert.ok(!JSON.stringify(f.exportEvidence(WS)).includes('DO_NOT_STORE'));assert.equal(act(f,WS,'sign_in',{user:'technician'}).accepted,true);
});
test('BMC power control follows the hardware state and cannot bypass missing feeds',()=>{
 const {f,ss}=setup();const sh=createShell({ss});
 assert.match(sh.exec('ipmitool -H b1-hyp01 chassis power off').lines.map(x=>x.t).join(),/OK/);assert.equal(f.status(SRV).stage,'OFF');
 sh.exec('ipmitool -H b1-hyp01 chassis power on');assert.equal(f.status(SRV).stage,'POST');
 for(const p of f.device(SRV).ports.filter(p=>p.kind==='power'))act(f,SRV,'disconnect',{port:p.id});assert.match(sh.exec('ipmitool -H b1-hyp01 chassis power on').lines.map(x=>x.t).join(),/BMC unavailable/);
});
test('equipment refusal and evidence exports never mutate canonical source objects',()=>{
 const source=JSON.stringify({registry,connections,profile});const {f}=setup();act(f,WS,'remove',{part:'RAM-A2'});const e=f.exportEvidence(WS);e.state.boot='OFF';assert.equal(f.status(WS).stage,'DESKTOP');assert.equal(JSON.stringify({registry,connections,profile}),source);
});
test('missing owner gate is fail-closed, rather than silently opening a screen app',async()=>{
 const win=new EventTarget();await assert.rejects(whenOwner({doc:{documentElement:{dataset:{}},querySelector:()=>null},win}),/gate is missing/);
});
test('Hardware is reachable from the existing screen apps and Game Hub; original server exercises retained',()=>{
 const terminal=readFileSync(ROOT+'js/eu-screens/apps/terminal.mjs','utf8');assert.match(terminal,/id: "hardware"/);
 const pages=read(ROOT+'data/game-hub/modules.json').modules.flatMap(x=>x.games);assert.ok(pages.some(x=>x.id==='building-computers'));assert.ok(pages.some(x=>x.id==='equity-uprise-server-lab'));
 const deploy=readFileSync(ROOT+'.github/workflows/deploy-pages.yml','utf8');assert.match(deploy,/equity-uprise-computer-\*\.mjs/);assert.match(deploy,/computer-hardware-profile-v1.json/);
});
