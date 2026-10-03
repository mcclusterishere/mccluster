export const ELECTRONICS_SPATIAL_BINDING_VERSION = "1.1.0";
export const ELECTRONICS_SOURCE_UNITS = "feet";
export const ELECTRONICS_TO_METERS = 0.3048;

const A = {
  0: {
    support:["B1-TELECOM-RACKS-01","B1-ELEC-UPS-01","B1-MECH-BAS-01","B1-LAB-CONSOLE-01"],
    work:["B1-TELECOM-CONSOLE-01","B1-LAB-TABLE-01","B1-OPS-DESK-01"],
    security:["B1-OPS-GATE-01","B1-LOCK-PANEL-01","B1-EMERGENCY-COMMS-01"],
    ceiling:["B1-TELECOM-ROOM-01","B1-LAB-ZONE-01","B1-OPS-ZONE-01","B1-STAGING-ZONE-01"],
    av:["B1-LAB-DASHBOARD-01","B1-OPS-STATUS-01","B1-OPS-OCCUPANCY-01"],
    fire:["B1-FIRE-RISER-01","B1-FIRE-PUMP-01"]
  },
  1: {
    support:["F1-IT-RACK-01","F1-OPS-PANEL-01"],
    work:["F1-RECEPTION-MONITOR-01","F1-PASSPORT-TABLE-01","F1-PASSPORT-TABLE-02","F1-INTAKE-TABLE-01"],
    security:["F1-ENTRY-DOOR-INNER","F1-RECEPTION-DESK-01","F1-PASS-ELEV-CALL-01","F1-STAIR-A-BARRIER-DOWN","F1-STAIR-B-BARRIER-DOWN"],
    ceiling:["F1-ARRIVAL-INSET-01","F1-LOUNGE-RUG-01","F1-INTAKE-TABLE-01","F1-PASSPORT-TABLE-01"],
    av:["F1-JOURNEY-DISPLAY-01","F1-JOURNEY-DISPLAY-02","F1-JOURNEY-DISPLAY-03","F1-JOURNEY-DISPLAY-04","F1-INTAKE-DISPLAY-01","F1-LOUNGE-DISPLAY-01"],
    fire:["F1-FE-01","F1-FE-02"]
  },
  2: {
    support:["F2-AVIT-RACK-01","F2-STORAGE-SHELVING-01"],
    work:["F2-FORUM-TABLE-01","F2-MEMBER-CHECKIN-01","F2-LOUNGE-TABLE-01"],
    security:["F2-MEMBER-CHECKIN-01","F2-FREIGHT-CONTROL-01"],
    ceiling:["F2-FORUM-TABLE-01","F2-LOUNGE-RUG-01","F2-MEMBER-CHECKIN-01"],
    av:["F2-DISPLAY-CURRENT-ISSUES","F2-DISPLAY-PERSPECTIVES","F2-DISPLAY-OPPORTUNITIES","F2-TALK-INTERFACE-01"],
    fire:["F2-FE-WEST-01","F2-FE-EAST-01"]
  },
  3: {
    support:["F3-NETWORK-IT-RACK-01","F3-RECORDS-STORAGE-01"],
    work:["F3-OPPORTUNITY-TABLE-01","F3-INTERVIEW-A-TABLE-01","F3-INTERVIEW-B-TABLE-01","F3-MEMBER-CHECKIN-01"],
    security:["F3-MEMBER-CHECKIN-01","F3-INTERVIEW-A-DOOR-01","F3-INTERVIEW-B-DOOR-01","F3-FREIGHT-CONTROL-01"],
    ceiling:["F3-OPPORTUNITY-TABLE-01","F3-LOUNGE-RUG-01","F3-INTERVIEW-A-TABLE-01","F3-INTERVIEW-B-TABLE-01"],
    av:["F3-DISPLAY-MATCH","F3-DISPLAY-PEOPLE","F3-DISPLAY-APPLICATIONS","F3-PEOPLE-DISPLAY-01","F3-INTERVIEW-A-DISPLAY-01","F3-INTERVIEW-B-DISPLAY-01"],
    fire:["F3-FE-WEST-01","F3-FE-EAST-01"]
  },
  4: {
    support:["F4-MEDIA-IT-RACK-01","F4-MEDIA-STORAGE-01"],
    work:["F4-EDIT-DESK-01","F4-RECORDING-WORKSURFACE-01","F4-LISTENING-TABLE-01","F4-FLOOR-CONTROL-01"],
    security:["F4-RECORDING-DOOR-01","F4-EDIT-DOOR-01","F4-FLOOR-CONTROL-01","F4-FREIGHT-CONTROL-01"],
    ceiling:["F4-LISTENING-TABLE-01","F4-RECORDING-WORKSURFACE-01","F4-EDIT-DESK-01","F4-GALLERY-TABLE-01"],
    av:["F4-DISPLAY-LISTEN","F4-DISPLAY-WATCH","F4-DISPLAY-ARCHIVE","F4-RECORDING-MONITOR-01","F4-EDIT-DISPLAY-01","F4-MIC-STAND-01"],
    fire:["F4-FE-WEST-01","F4-FE-EAST-01"]
  },
  5: {
    support:["F5-RESEARCH-SYSTEMS-01","F5-EVIDENCE-STORAGE-01"],
    work:["F5-POLICY-TABLE-01","F5-SOURCE-TABLE-01","F5-PUB-TABLE-01","F5-PUB-WORKSTATION-01","F5-ARCHIVE-TABLE-01"],
    security:["F5-SOURCE-DOOR-01","F5-PUB-DOOR-01","F5-NAVIGATOR-01","F5-FREIGHT-CONTROL-01"],
    ceiling:["F5-POLICY-TABLE-01","F5-SOURCE-TABLE-01","F5-PUB-TABLE-01","F5-ARCHIVE-TABLE-01"],
    av:["F5-DISPLAY-RESEARCH","F5-DISPLAY-EVIDENCE","F5-DISPLAY-RECORD","F5-SOURCE-DISPLAY-01","F5-PUB-DISPLAY-01","F5-ARCHIVE-SEARCH-01"],
    fire:["F5-FE-WEST-01","F5-FE-EAST-01"]
  },
  6: {
    support:["F6-DESK-SYSTEMS-01","F6-AUDIT-STORAGE-01"],
    work:["F6-COMMAND-TABLE-01","F6-STRATEGY-TABLE-01","F6-BRIEFING-TABLE-01","F6-ROOF-TRANSITION-01"],
    security:["F6-STRATEGY-DOOR-01","F6-BRIEFING-DOOR-01","F6-ROOF-TRANSITION-01","F6-FREIGHT-CONTROL-01"],
    ceiling:["F6-COMMAND-TABLE-01","F6-STRATEGY-TABLE-01","F6-BRIEFING-TABLE-01","F6-SALON-TABLE-01"],
    av:["F6-DISPLAY-NOW","F6-DISPLAY-PAST","F6-DISPLAY-JOIN","F6-STRATEGY-DISPLAY-01","F6-BRIEFING-DISPLAY-01","F6-HALO-GLOBE-01"],
    fire:["F6-FE-WEST-01","F6-FE-EAST-01"]
  },
  7: {
    support:["F7-MEP-SCREEN-01","F7-MECH-UNIT-01","F7-MECH-UNIT-02","F7-MECH-UNIT-03"],
    work:["F7-ROOF-DECK-01","F7-PATH-A-01","F7-PATH-B-02"],
    security:["F7-STAIR-A-HEADHOUSE-01","F7-STAIR-B-HEADHOUSE-01","F7-PASSENGER-OVERRUN-01"],
    ceiling:["F7-ROOF-DECK-01","F7-MEP-SCREEN-01","F7-MOBILITY-FIELD-01"],
    av:["F7-ROOF-DECK-01"],
    fire:["F7-STAIR-A-HEADHOUSE-01","F7-STAIR-B-HEADHOUSE-01"]
  }
};

const OFFSETS = [[0,0],[0.8,0],[-0.8,0],[0,0.8],[0,-0.8],[0.8,0.8],[-0.8,0.8],[0.8,-0.8],[-0.8,-0.8]];

function levelOf(id){
  if(/^B1-/.test(id)) return 0;
  if(/^L7-/.test(id)) return 7;
  const m=/^F([1-7])-/.exec(id);
  return m ? Number(m[1]) : null;
}
function numericIndex(id){
  const nums=(id.match(/\d+/g)||[]).map(Number);
  return nums.length ? nums[nums.length-1]-1 : 0;
}
function classOf(id){
  if(/^LOGIC-/.test(id)) return null;
  if(/FIRE-(?:DET|STROBE)/.test(id)) return "fire";
  if(/NET-WAP|BAS-ENV/.test(id)) return "ceiling";
  if(/SEC-(?:CAM|READER|INTERCOM)/.test(id)) return "security";
  if(/AV-(?:CAM|MIC|SPKR)|::AV-DECODER/.test(id)) return "av";
  if(/USER-(?:WS|MON)|VOICE-PHONE|PRINT-MFP/.test(id)) return "work";
  if(/(?:NET-(?:ACCESS-SW|PATCH-PANEL|FIBER-PANEL|EDGE-RTR|CORE-SW|FW)|ICT-|ELEC-PANEL|BAS-CTRL|SEC-ACCESS-CTRL|AV-(?:CTRL|DSP)|WAN-|SRV-|SEC-NVR)/.test(id)) return "support";
  if(/FIRE-(?:FACP|GW)/.test(id)) return "support";
  return null;
}
function affFor(id, cls){
  if(/NET-WAP/.test(id)) return 10.1;
  if(/BAS-ENV/.test(id)) return 7.8;
  if(/FIRE-DET/.test(id)) return 9.7;
  if(/FIRE-STROBE/.test(id)) return 7.2;
  if(/SEC-CAM/.test(id)) return 8.8;
  if(/SEC-(?:READER|INTERCOM)/.test(id)) return 4.2;
  if(/AV-SPKR/.test(id)) return 8.5;
  if(/AV-CAM/.test(id)) return 7.4;
  if(/AV-MIC/.test(id)) return 4.6;
  if(/USER-MON/.test(id)) return 4.1;
  if(/USER-WS|VOICE-PHONE/.test(id)) return 3.2;
  if(/PRINT-MFP/.test(id)) return 3.0;
  if(/::AV-DECODER/.test(id)) return 4.4;
  if(cls==="support") return 3.5;
  return 4.0;
}
export function resolveElectronicsSpatialBinding(assetId){
  const level=levelOf(assetId), cls=classOf(assetId);
  if(level===null || !cls || !A[level]) return null;
  const anchors=A[level][cls]||[], idx=Math.max(0,numericIndex(assetId));
  const anchor_id=anchors.length ? anchors[idx%anchors.length] : null;
  const offset_ft=OFFSETS[idx%OFFSETS.length];
  return {
    asset_id:assetId,
    level,
    class:cls,
    anchor_id,
    offset_ft,
    aff_ft:affFor(assetId,cls),
    placement_mode:"native_generator_coordinates",
    physical_visibility:"generated_physical_installation",
    authority:"step4b_native_physical_installation_with_canonical_context",
    exterior_intent:level===7
  };
}

export function isSpatiallyPhysicalAsset(assetId){
  return !!resolveElectronicsSpatialBinding(assetId);
}

export function spatialBindingCatalog(){
  return JSON.parse(JSON.stringify(A));
}
