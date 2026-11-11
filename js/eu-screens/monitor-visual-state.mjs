/* Pure presentation of the exact monitor's simulated state. No telemetry invented,
   no boot advancement, no login, and no changes to the canonical hardware model. */
const styles = {
  UNKNOWN: {label:'State unavailable', color:0x111519, emission:0},
  OFF: {label:'Host off · no signal', color:0x030405, emission:0},
  NO_SIGNAL: {label:'No signal / display unavailable', color:0x231b0c, emission:0.08},
  FAULT: {label:'Hardware fault', color:0x30130c, emission:0.12},
  BOOT: {label:'Booting', color:0x10293d, emission:0.18},
  LOGIN: {label:'Login required', color:0x253e55, emission:0.22},
  ON: {label:'Desktop ready', color:0x31505c, emission:0.25},
};
export function monitorVisualState(fleet, screen) {
  let status;
  if (screen?.asset_type !== 'monitor' || !fleet?.byId?.has(screen.network_asset_id)) return {...styles.UNKNOWN,state:'UNKNOWN'};
  try { status=fleet.monitorStatus(screen.network_asset_id,screen.asset_id); } catch { return {...styles.UNKNOWN,state:'UNKNOWN'}; }
  const state = !status.video_connection ? 'UNKNOWN' : status.stage==='OFF' ? 'OFF' : !status.display ? 'NO_SIGNAL' : status.reason ? 'FAULT' : status.desktop_ready ? 'ON' : status.stage==='LOGIN' ? 'LOGIN' : ['POST','FIRMWARE','BOOTLOADER'].includes(status.stage) ? 'BOOT' : 'UNKNOWN';
  return {...styles[state], state, stage:status.stage, reason:status.reason,
    label:state==='BOOT' ? 'Boot · '+status.stage : styles[state].label};
}
