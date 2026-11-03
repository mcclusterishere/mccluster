/* Deterministic equipment state for the existing ScreenSandbox. No sockets, shell execution, live credentials,
   telemetry control, or new persistence plane. IDs/connections come from the canonical asset registry. */
import { expandServerModel } from './equity-uprise-server-lab-runtime.mjs';

export const COMPUTER_TYPES = Object.freeze(['workstation', 'virtualization_host', 'nas_storage', 'backup_appliance', 'vms_nvr']);
export const BOOT_STAGES = Object.freeze(['OFF', 'POST', 'FIRMWARE', 'BOOTLOADER', 'LOGIN', 'DESKTOP']);
const copy = x => structuredClone(x);
const fail = (code, message, severity = null) => Object.assign(new Error(message), { code, severity });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const osUp = b => b === 'LOGIN' || b === 'DESKTOP';

export function buildComputerCatalog({ registry, connections, screens, profile, serverHardware }) {
  if (profile?.execution_target !== 'SANDBOX' || profile.live_control_allowed !== false) throw fail('SANDBOX_ONLY', 'Only sandbox profiles are accepted.');
  const items = registry.assets.filter(a => COMPUTER_TYPES.includes(a.classification?.asset_type));
  const serverParts = expandServerModel(serverHardware, 'SRV-2U-GEN');
  const catalog = items.map(a => {
    if (a.security?.live_control_allowed !== false) throw fail('SANDBOX_ONLY', a.asset_id);
    const server = a.classification.asset_type !== 'workstation';
    const linked = connections.connections.filter(c => c.from_asset_id === a.asset_id || c.to_asset_id === a.asset_id);
    const ports = linked.filter(c => /POWER-CORD|IEC-POWER|10G-DAC|CAT6A-PATCH|DISPLAYPORT/.test(c.cable_type)).map(c => ({
      id: c.connection_id, kind: /POWER-CORD|IEC-POWER/.test(c.cable_type) ? 'power' : c.cable_type === 'DISPLAYPORT' ? 'video' : 'network',
      port: c.to_asset_id === a.asset_id ? c.to_port : c.from_port,
      peer: c.to_asset_id === a.asset_id ? c.from_asset_id : c.to_asset_id,
      peer_port: c.to_asset_id === a.asset_id ? c.from_port : c.to_port,
      cable_type: c.cable_type,
    })).sort((x, y) => x.kind.localeCompare(y.kind) || x.port.localeCompare(y.port) || x.id.localeCompare(y.id));
    let parts;
    if (!server) parts = copy(profile.workstation.parts);
    else parts = serverParts.filter(p => ['motherboard','cpu','heatsink','psu','fan','backplane','raid_controller','riser','ocp_nic','m2_boot_module','tpm','cmos_battery'].includes(p.type) ||
      profile.server.initial_dimms.includes(p.id) || profile.server.initial_drives.includes(p.id)).map(p => ({
        id: p.id, label: p.label, type: p.type, box_mm: p.box,
        sku: p.type === 'dimm' ? 'DDR5-RDIMM-32' : p.type === 'psu' ? 'PSU-SERVER-MATCHED' : 'SERVER-' + p.type,
        serviceable: !['motherboard','backplane','tpm'].includes(p.type),
        ...(p.type === 'dimm' ? { capacity_gb: 32 } : {}), ...(p.type === 'psu' ? { sealed: true } : {}),
      }));
    return { id: a.asset_id, label: a.label, floor: a.location.level_id, type: a.classification.asset_type, server,
      profile_id: server ? profile.server.id : profile.workstation.id,
      geometry: server ? serverHardware.server_models['SRV-2U-GEN'] : profile.workstation,
      parts, ports, screens: screens.screens.filter(s => s.network_asset_id === a.asset_id).map(s => s.screen_id),
      placement: copy(a.location), geometry_status: a.classification.asset_type === 'virtualization_host' ? 'existing-server-training-model' : 'generic-training-reference',
      execution_target: 'SANDBOX', live_control_allowed: false,
    };
  }).sort((a,b) => a.id.localeCompare(b.id));
  if (new Set(catalog.map(x => x.id)).size !== catalog.length) throw fail('DUPLICATE_ASSET', 'Duplicate computer identity.');
  return catalog;
}

export class ComputerFleet {
  constructor({ catalog, sandbox, readSession, persist, mode }) {
    if (!['WORKPLACE','TRAINING','MISSION'].includes(mode)) throw fail('UNKNOWN_MODE', 'Unknown simulation mode.');
    this.catalog = catalog; this.byId = new Map(catalog.map(c => [c.id,c])); this.sandbox = sandbox;
    this.readSession = readSession; this.persist = persist; this.mode = mode;
  }
  device(id) { const c = this.byId.get(id); if (!c) throw fail('UNKNOWN_COMPUTER', 'No registered computer: ' + id); return c; }
  initial(id) { const c = this.device(id); return { v:1, boot:'DESKTOP', cover:false, esd:false, parts:Object.fromEntries(c.parts.map(p => [p.id,true])), disconnected:[], faults:[], user:'operator' }; }
  machine(id) {
    const c = this.device(id), s = this.initial(id);
    const raw = this.mode === 'WORKPLACE' ? null : this.readSession().hardware?.machines?.[id];
    if (!raw || raw.v !== 1) return s;
    s.boot = BOOT_STAGES.includes(raw.boot) ? raw.boot : 'OFF';
    s.cover = raw.cover === true; s.esd = raw.esd === true;
    for (const p of c.parts) s.parts[p.id] = raw.parts?.[p.id] !== false;
    s.disconnected = (Array.isArray(raw.disconnected) ? raw.disconnected : []).filter(x => c.ports.some(p => p.id === x));
    s.faults = (Array.isArray(raw.faults) ? raw.faults : []).filter(x => c.parts.some(p => p.id === x)).slice(0,c.parts.length);
    s.user = s.boot === 'DESKTOP' && ['operator','technician'].includes(raw.user) ? raw.user : null;
    return s;
  }
  base(id) { return this.sandbox.assetStates.get(id); }
  baseUp(id) { const b=this.base(id); return Boolean(b && b.availability !== 'unavailable'); }
  status(id, machine = this.machine(id)) {
    const c = this.device(id), s = machine;
    const good = p => s.parts[p.id] && !s.faults.includes(p.id);
    const power = c.ports.filter(p => p.kind === 'power').map((p,i) => ({ ...p,
      connected: !s.disconnected.includes(p.id),
      healthy: this.baseUp(p.peer) && this.sandbox.connectionStates.get(p.id)?.availability !== 'unavailable' &&
        good(c.parts.find(x => x.id === 'PSU'+(i+1)) || c.parts.find(x => x.type === 'psu')),
    }));
    const ac = power.some(p => p.connected && p.healthy);
    const missing = c.parts.filter(p => ['cpu','heatsink','motherboard'].includes(p.type) && !good(p));
    const memory = c.parts.filter(p => p.type === 'dimm' && good(p)).reduce((n,p) => n+(p.capacity_gb||0),0);
    const memoryMax = c.parts.filter(p => p.type === 'dimm').reduce((n,p) => n+(p.capacity_gb||0),0);
    const cooling = c.parts.filter(p => p.type === 'fan').every(good);
    const storage = c.parts.filter(p => p.type === 'm2_boot_module');
    const bootDisk = storage.length > 0 && storage.every(good);
    const post = ac && !s.cover && !missing.length && memory > 0;
    const reason = !ac ? 'NO_AC_POWER' : s.cover ? 'SERVICE_COVER_OPEN' : missing.length ? 'POST_COMPONENT_MISSING' : !memory ? 'NO_USABLE_MEMORY' : !bootDisk ? 'BOOT_DEVICE_MISSING' : null;
    const stage = !ac ? 'OFF' : s.boot;
    const baseAvailable = this.baseUp(id);
    const os_ready = baseAvailable && post && bootDisk && osUp(stage);
    const links = c.ports.filter(p => p.kind === 'network').map(p => ({ ...p,
      up: os_ready && !s.disconnected.includes(p.id) && this.baseUp(p.peer) && this.sandbox.connectionStates.get(p.id)?.availability !== 'unavailable',
    }));
    const video = c.ports.filter(p => p.kind === 'video');
    const display = ac && stage !== 'OFF' && (video.length === 0 || video.some(p => !s.disconnected.includes(p.id) && this.baseUp(p.peer) && this.sandbox.connectionStates.get(p.id)?.availability !== 'unavailable'));
    return { id, stage, ac, power, post, memory_gb:memory, memory_expected_gb:memoryMax, cooling, boot_disk:bootDisk,
      os_ready, desktop_ready:os_ready && stage === 'DESKTOP' && Boolean(s.user), display,
      network_up:links.length > 0 && links.some(p => p.up), links, base_available:baseAvailable,
      reason:reason || (!baseAvailable ? 'CANONICAL_GRAPH_FAULT' : null),
      degraded:!cooling || memory < memoryMax || power.some(p => !p.connected || !p.healthy) || s.faults.length > 0,
      bmc_power:c.server && ac, bmc_network:'not independently wired in this reference',
      cover:s.cover, esd:s.esd, safety_model:'cold-service-only; #714 retains dedicated hot-swap exercises',
    };
  }
  record(id, action, result) {
    const session=this.readSession();
    if (!session.hardware || typeof session.hardware !== 'object' || Array.isArray(session.hardware)) session.hardware = { v:1, machines:{}, seq:0, events:[] };
    if (!session.hardware.machines || typeof session.hardware.machines !== 'object' || Array.isArray(session.hardware.machines)) session.hardware.machines = {};
    const h=session.hardware;
    h.seq=(Number.isSafeInteger(h.seq) ? h.seq : 0)+1;
    h.events = [...(Array.isArray(h.events) ? h.events : []).slice(-199), { seq:h.seq, asset_id:id,
      action:action.type, part:action.part||null, port:action.port||null, code:result.code,
      accepted:result.accepted, safety:result.safety||null, execution_target:'SANDBOX', assessed:false }];
  }
  act(id, action) {
    const c=this.device(id);
    if (!action || typeof action.type !== 'string') throw fail('INVALID_ACTION','Action required.');
    if (this.mode === 'WORKPLACE') return { accepted:false, code:'READ_ONLY_MODE', message:'Workplace is read-only. Open Training or Mission to change equipment.' };
    const s=this.machine(id), before=copy(s), st=this.status(id,s);
    let result;
    try {
      const part = action.part ? c.parts.find(p => p.id === action.part) : null;
      const service = () => {
        if (s.boot !== 'OFF' || c.ports.some(p => p.kind === 'power' && !s.disconnected.includes(p.id))) throw fail('ISOLATE_ALL_AC','Shut down and disconnect every AC cord before internal service. Standby power is still power.','major');
        if (!s.cover) throw fail('OPEN_COVER','Open the service cover first.');
        if (!s.esd) throw fail('ESD_REQUIRED','Apply the simulated ESD bond before touching a component.','major');
      };
      switch(action.type) {
        case 'shutdown': s.boot='OFF';s.user=null;break;
        case 'power_on':
          if (!st.ac) throw fail('NO_AC_POWER','No healthy connected power feed.');
          if (s.cover) throw fail('CLOSE_COVER','Close the service cover before energizing.','major');
          if (s.boot !== 'OFF') throw fail('ALREADY_ON','Shut down before starting a new boot.');
          s.boot='POST';s.user=null;break;
        case 'advance':
          if (!st.post) throw fail(st.reason||'POST_FAILED','POST cannot complete. Inspect installed CPU, cooler, memory and power.');
          if (s.boot === 'POST') s.boot='FIRMWARE';
          else if (s.boot === 'FIRMWARE') { if (!st.boot_disk) throw fail('BOOT_DEVICE_MISSING','Firmware cannot find a usable boot SSD.'); s.boot='BOOTLOADER'; }
          else if (s.boot === 'BOOTLOADER') { if (!st.boot_disk) throw fail('BOOT_DEVICE_MISSING','Boot device is unavailable.'); s.boot='LOGIN'; }
          else throw fail('NO_BOOT_STEP','No pending boot step.');
          break;
        case 'sign_in':
          if (s.boot !== 'LOGIN' || !st.os_ready) throw fail('OS_NOT_READY','The operating system has not reached its login screen.');
          if (!['operator','technician'].includes(action.user)) throw fail('DEMO_IDENTITY_ONLY','Use a sandbox persona, never real credentials.');
          s.boot='DESKTOP';s.user=action.user;break;
        case 'sign_out': if (!st.os_ready) throw fail('OS_NOT_READY','No running desktop.'); s.boot='LOGIN';s.user=null;break;
        case 'disconnect': case 'connect': {
          const p=c.ports.find(p => p.id === action.port); if (!p) throw fail('UNKNOWN_PORT','Use an exact registered cable ID.');
          if (action.type === 'connect' && action.peer !== p.peer) throw fail('WRONG_ENDPOINT','The cable must return to its recorded peer: '+p.peer+'.');
          if (action.type === 'connect' && p.kind === 'power' && s.cover) throw fail('CLOSE_COVER','Close the cover before reconnecting AC.','major');
          if (action.type === 'disconnect') s.disconnected=[...new Set([...s.disconnected,p.id])]; else s.disconnected=s.disconnected.filter(x=>x!==p.id);
          if (!this.status(id,s).ac) { s.boot='OFF';s.user=null; }
          break;
        }
        case 'open_cover':
          if (s.boot !== 'OFF' || c.ports.some(p=>p.kind==='power'&&!s.disconnected.includes(p.id))) throw fail('ISOLATE_ALL_AC','Shut down and disconnect all AC cords before opening.','major');
          s.cover=true;break;
        case 'close_cover': s.cover=false;break;
        case 'esd': s.esd=action.enabled===true;break;
        case 'remove': case 'install': case 'replace':
          if (!part || part.serviceable === false) throw fail('NOT_SERVICEABLE','Select a removable component. Board-level or sealed PSU repair is not modeled.');
          service();
          if (action.type === 'remove') { if (!s.parts[part.id]) throw fail('ALREADY_REMOVED','This part is already removed.'); s.parts[part.id]=false; }
          else {
            if (action.sku !== part.sku) throw fail('INCOMPATIBLE_PART','This profile requires '+part.sku+' in '+part.id+'.');
            if (action.type === 'install' && s.parts[part.id]) throw fail('OCCUPIED_SLOT','The slot is occupied; remove the module or use Replace.');
            if (part.type === 'heatsink' && c.parts.some(p=>p.type==='cpu'&&!s.parts[p.id])) throw fail('CPU_REQUIRED','Install the processors before their coolers.');
            s.parts[part.id]=true;s.faults=s.faults.filter(x=>x!==part.id);
          }
          break;
        case 'inject_fault':
          if (!part || part.serviceable === false) throw fail('UNKNOWN_PART','This component has no supported fault.');
          s.faults=[...new Set([...s.faults,part.id])];break;
        case 'reset': Object.assign(s,this.initial(id));break;
        default: throw fail('UNKNOWN_ACTION','Action not supported.');
      }
      result={accepted:true,code:'OK',message:'Sandbox equipment updated.'};
    } catch(e) { Object.assign(s,before); result={accepted:false,code:e.code||'REFUSED',message:e.message,safety:e.severity||null}; }
    this.record(id,action,result);
    if(result.accepted) this.readSession().hardware.machines[id]=s;
    this.persist();
    return {...result,status:this.status(id)};
  }
  effectiveAsset(id, base) {
    if (!base) return null;
    let blocked=false, degraded=false, why;
    if(this.byId.has(id)) {
      const st=this.status(id); blocked=!st.os_ready || !st.network_up; degraded=st.degraded;
      why=!st.os_ready ? st.reason||'equipment_boot_'+st.stage.toLowerCase() : 'equipment_network_disconnected';
    } else {
      const a=this.sandbox.assetsById.get(id);
      const hosts=(a?.systems?.dependency_asset_ids||[]).filter(x=>this.byId.has(x));
      blocked=hosts.some(x=>{const s=this.status(x);return !s.os_ready||!s.network_up;});
      why='equipment_host_unavailable';
    }
    if(!blocked && !degraded) return base;
    return {...base,availability:base.availability==='unavailable'||blocked?'unavailable':'degraded',
      condition_flags:[...new Set([...(base.condition_flags||[]),blocked?why:'equipment_degraded'])]};
  }
  effectiveConnection(id, base) {
    if(!base) return null;
    const c=this.sandbox.connectionsById.get(id);
    const hosts=[c?.from_asset_id,c?.to_asset_id].filter(x=>this.byId.has(x));
    const down=hosts.some(x=>this.machine(x).disconnected.includes(id));
    return down?{...base,availability:'unavailable',condition_flags:[...(base.condition_flags||[]),'equipment_cable_disconnected']}:base;
  }
  coverage() { return { computers:this.catalog.length,workstations:this.catalog.filter(x=>!x.server).length,
    servers:this.catalog.filter(x=>x.server).length,unbound_screens:this.catalog.filter(x=>!x.screens.length).map(x=>x.id),
    unresolved_placement:this.catalog.filter(x=>x.placement.placement_authority==='unknown').map(x=>x.id),
    scope:'canonical registered computers only; furnishing-only props excluded',physical_verification:false }; }
  exportEvidence(id) { return {schema:'computer-equipment-evidence/1',asset_id:id,profile_id:this.device(id).profile_id,
    mode:this.mode,execution_target:'SANDBOX',live_control_allowed:false,assessed:false,state:this.machine(id),
    events:copy((this.readSession().hardware?.events||[]).filter(e=>e.asset_id===id)),coverage:this.coverage()}; }
}

/* Adapt the existing allowlisted console, not a second shell. Network diagnostics continue to use the
   canonical net graph via ScreenSandbox.state; only local boot/display and BMC equipment commands need bridging. */
export function wrapEquipmentShell(shell, ss, screen = null) {
  if (!ss.hardware) return shell;
  const fleet=ss.hardware, text=(t,c='')=>({t,c}), response=(lines)=>({lines,prompt:shell.prompt()});
  const wrapped=Object.create(shell);
  wrapped.exec = line => {
    const raw=String(line||'').trim(), c=shell.context;
    const tokens=raw.split(/\s+/), command=tokens[0].toLowerCase();
    if (c.asset && fleet.byId.has(c.asset) && !['help','man','exit','logout','reset','clear'].includes(command)) {
      const hw=fleet.status(c.asset), local=c.type==='bash'&&c.asset===screen?.network_asset_id&&c.user==='staff';
      const ready=c.type==='bmc'?hw.bmc_power:local?hw.desktop_ready&&hw.display:hw.os_ready&&hw.network_up;
      if (!ready) return response([text('[equipment] '+(hw.reason||hw.stage)+': inspect power, display and boot in Hardware.','warn')]);
    }
    if (command==='ipmitool') {
      const hi=tokens.indexOf('-H');
      const host=hi>=0?shell.net.resolve((tokens[hi+1]||'').replace(/-bmc$/,''))?.id:c.type==='bmc'?c.asset:null;
      if (host && fleet.byId.has(host) && fleet.device(host).server) {
        // No real credentials belong in a training console or its retained command history.
        if(tokens.some(t=>['-P','-f','-E'].includes(t)))return response([text('Do not enter real credentials. This BMC uses the sandbox persona only.','warn')]);
        const st=fleet.status(host);
        if(!st.bmc_power)return response([text('BMC unavailable: all AC feeds are absent or failed.','err')]);
        const tail=tokens.filter((_,i)=>i!==0&&(hi<0||i!==hi&&i!==hi+1)).join(' ');
        if(/^chassis power (on|up|off|soft|cycle|reset)$/.test(tail)){
          const action=/ (on|up)$/.test(tail)?'power_on':'shutdown';
          let out=fleet.act(host,{type:action});
          if(/ (cycle|reset)$/.test(tail)&&out.accepted)out=fleet.act(host,{type:'power_on'});
          ss.pushHistory(raw);
          return response([text('[equipment] '+out.code+' · '+out.message,out.accepted?'ok':'err'),text('Stage: '+fleet.status(host).stage+'. Complete boot in Hardware.','dim')]);
        }
        if(/^chassis (status|power status)$/.test(tail))return response([text('System Power: '+(st.stage==='OFF'?'off':'on')),text('Boot stage: '+st.stage),text('BMC wiring is an abstract management channel, not an installed addressing claim.','dim')]);
        if(/^(sensor|sdr)/.test(tail))return response([text('Discrete training state, not measured temperature or RPM','dim'),text('Memory: '+st.memory_gb+' GB'),text('Cooling: '+(st.cooling?'available':'fan degraded')),...st.power.map(p=>text(p.port+': '+(p.connected&&p.healthy?'available':'absent/failed')))]);
        if(/^sel( list)?$/.test(tail))return response((ss.session.hardware?.events||[]).filter(e=>e.asset_id===host).map(e=>text(`${e.seq} ${e.action} ${e.part||e.port||''} ${e.code}`)).concat(text('Canonical events: '+(ss.state(host)?.active_fault_ids||[]).join(', '))));
      }
    }
    return shell.exec(raw);
  };
  return wrapped;
}
