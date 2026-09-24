# Equity Uprise — Whole-Building Electronics / IT Infrastructure Fabric

> Status: **STEP 4A — DESIGN-INTENT ELECTRONICS FABRIC**
>
> This layer is for digital-twin simulation, training, planning, commissioning preparation and future as-built reconciliation. It is **not construction documentation, stamped engineering, an RF survey, a fire-alarm design, or an authorization to control physical systems**.

## Objective

Populate the existing Equity Uprise building with a realistic electronics and communications fabric that can support labs from first-day cabling fundamentals through advanced IT/OT operations.

The fabric distinguishes five things that must never be conflated:

1. **physical active devices** — switches, firewalls, servers, APs, phones, cameras, controllers, workstations;
2. **passive infrastructure** — patch panels, fiber panels, jacks, cable runs and pathways;
3. **power dependencies** — normal/emergency power, UPS, PDU, PoE and low-voltage control power;
4. **logical network objects** — VLANs, SSIDs, DHCP/DNS/NTP, AAA, VPN, monitoring, VMS, BAS and AV services;
5. **training state** — simulated failures, observations, learner actions, scoring and reset.

## Research basis

The design intentionally uses a single-building two-tier/collapsed-core approach rather than inventing a campus-scale three-tier core. Cisco's Campus LAN/WLAN guidance describes access + distribution/collapsed core as appropriate for many single-building networks:
https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cisco-campus-lan-wlan-design-guide.html

Structured horizontal cabling is modeled as Category 6A for new fixed Ethernet/PoE endpoints. Current Leviton and CommScope guidance recommends Cat 6A for enterprise wireless/high-PoE applications and cites standards guidance for two Cat 6A drops per WAP zone:
https://leviton.com/products/network-solutions/copper-systems/wireless-solutions
https://www.commscope.com/insights/the-enterprise-source/cat6a-the-fact-file/

Wi-Fi AP placement in this phase is a **design-intent population only**. Cisco's Wi-Fi 6E deployment guidance explicitly calls for coverage planning/site survey, especially for 6 GHz:
https://www.cisco.com/c/en/us/td/docs/wireless/access_point/technical-reference/cat9136-series-ap-deployment-guide.html

OT/BAS and physical-security networks are segmented from ordinary user networks. NIST SP 800-82 Rev. 3 covers building automation, physical access control and other OT, and NIST's current building-systems cybersecurity work emphasizes connected building-service risk:
https://csrc.nist.gov/pubs/sp/800/82/r3/final
https://www.nist.gov/programs-projects/cybersecurity-building-systems

CISA's ICS recommended practices emphasize reducing exposure, firewall isolation of control networks and secure remote access:
https://www.cisa.gov/resources-tools/resources/ics-recommended-practices

AV-over-IP is represented as multicast-capable Ethernet with explicit segmentation/QoS/IGMP semantics. Crestron's public AV-over-IP guidance documents multicast, VLAN/segment isolation, IGMP snooping/querier, bandwidth planning and QoS:
https://docs.crestron.com/en-us/9496/Content/Topics/AV-over-IP_Network-Design.htm

Training coverage draws on BICSI cabling technician/installer practice and Fluke's copper/fiber certification/troubleshooting guidance:
https://test.bicsi.org/education-certification/certification/cabling-installation/bicsi-technician-%28tech%29
https://www.flukenetworks.com/expertise/learn-about/cable-testing
https://www.flukenetworks.com/expertise/learn-about/otdr

## Step 4B physical-installation topology

### B1 MDF / core
The B1 telecom area becomes the main distribution frame and electronic core:
- provider/carrier handoff A;
- reserved second-carrier position without claiming service exists;
- provider CPE;
- edge router;
- HA firewall pair;
- dual collapsed-core switches;
- three virtualization hosts;
- NAS/storage;
- backup appliance;
- VMS/NVR;
- fire-alarm control panel plus read-only monitoring gateway;
- existing four network-rack identities are preserved as rack anchors.

### F1–F6 IDFs
Each occupied floor receives one canonical IDF/rack anchor. Existing rack identities are reused where present. Access-switch count is **derived from actual modeled active wired endpoint demand**, using 48-port PoE-capable access switches and a design-fill target of 36 active ports to preserve spare capacity.

Each floor receives:
- access switching;
- copper patch panels;
- fiber termination;
- rack UPS/PDU;
- WAPs and spare WAP drops;
- staff/training workstations;
- IP phones;
- MFP;
- security cameras;
- access controller/readers;
- intercom;
- BAS controller and environmental sensors;
- AV control/DSP/cameras/microphones/speakers appropriate to floor function;
- existing displays/kiosks/terminals from the canonical floor inventory are linked rather than duplicated.

### Roof
L7 electronics are served from the F6 IDF. The roof has outdoor-design-intent WAP coverage, security devices, emergency communications already in the building authority, and BAS/weather sensing. Exact weatherproof equipment, antenna selection and lightning/surge engineering remain site-specific.

## Cabling

The generated connection graph models every physical connection with a medium/cable type, explicit endpoint ports, deterministic route geometry, pathway classification, design-intent length and dependency semantics.

Step 4B is the physical-installation reconciliation pass. It converts the earlier connection graph from “device A is connected to device B” into an inspectable installed plant:
- B1/F1–F6 normal and emergency panelboards;
- riser-to-panel feeder paths;
- panel-to-receptacle/floor-box branch circuits;
- receptacle-to-equipment power cords;
- patch-panel-to-work-area/ceiling Cat6A permanent links;
- explicit data-jack termination assets;
- jack-to-endpoint patch cords with PoE where applicable;
- OS2 fiber riser/backbone paths;
- BAS field bus plus modeled Class 2 sensor power;
- OSDP reader buses;
- fire-alarm SLC/NAC segregation;
- AV, speaker and local display cabling.

The routing geometry reuses the locked Services/riser envelopes and floor support zones. It does not invent a second building-services backbone.

### Building backbone
- OS2 single-mode fiber duplex circuits from B1 MDF to each floor access layer;
- dual logical uplinks to the two core switches;
- current digital model has one shared MEP/service reservation, therefore **dual links are not claimed to be physically diverse routes**.

### Horizontal Ethernet
- Cat 6A permanent links from patch panels to fixed data/PoE endpoints;
- Cat 6A patch cords between access-switch ports and patch panels;
- each active WAP receives one active Cat 6A link and one spare Cat 6A WAP link;
- PoE is represented as power transported on the active Ethernet link rather than a fake second power cable.

### Local AV
- AV-over-IP endpoints use Cat 6A/Ethernet;
- local display patching uses HDMI/DisplayPort where appropriate;
- networked microphones/cameras may use Ethernet/PoE;
- amplified speakers use separate speaker-pair wiring from the DSP/amplifier stage.

### BAS / OT
- supervisory/floor controllers attach to the BAS-OT VLAN over Ethernet;
- field environmental sensors use a modeled BACnet MS/TP shielded twisted-pair bus where wired;
- real controller selection, topology limits, EOL/biasing and exact field wiring require final controls engineering.

### Access control
- access-control panels attach to the ACCESS VLAN;
- readers attach to their local controller using modeled OSDP/RS-485;
- lock/REX/contact circuits are represented only at the connection-family level until door hardware engineering exists.

### Fire alarm
Fire alarm is intentionally **not modeled as ordinary LAN endpoints**. Detectors and notification appliances remain on dedicated listed fire-alarm signaling/notification circuits. Only a separate read-only integration gateway is allowed to appear on the building data network.

## Logical network

Design-intent logical segmentation:
- management;
- staff;
- lab/student;
- guest;
- voice;
- AV;
- CCTV;
- access control;
- BAS/OT;
- IoT;
- servers;
- printers;
- DMZ.

Logical services include DHCP, DNS, NTP, AAA/RADIUS, directory/identity, syslog/SIEM, NMS/SNMP, configuration backup, remote-access VPN, WLAN control, VMS, BAS supervisory, AV control, file/storage and backup.

**VPN is modeled as a logical service hosted by the firewall stack, not as a magical standalone cable or device.**

## Wireless

Installed WAP counts are provisional training-design counts. Final RF design needs:
- construction material model;
- ceiling heights/materials;
- occupancy and client-density targets;
- 2.4/5/6 GHz policy;
- channel width/reuse plan;
- transmit-power plan;
- predictive survey;
- post-install validation survey.

Mobile phones/tablets are modeled as transient client populations rather than permanent bolted-down building assets. They connect to WAPs by Wi-Fi or to external carrier infrastructure by cellular RF.

## Lab-readiness ladder

The generated lab catalog progresses through:
- cable identification, termination, wiremap and certification;
- fiber polarity, loss and OTDR;
- patch-panel/port tracing;
- PoE;
- switching, VLANs, trunks, STP and dual uplinks;
- DHCP, DNS, NTP and AAA;
- IP phones and QoS;
- Wi-Fi RF and authentication;
- firewalls and VPN;
- virtualization, storage and backup;
- camera/VMS and access control;
- BAS/OT segmentation;
- AV multicast/IGMP/QoS;
- UPS/power failure;
- multi-system whole-building incident response.

## Truth boundary

Every Step 4B device/termination is one of:
- **existing canonical asset** — already present in the building inventory/registry;
- **design-intent planned asset** — populated for realistic digital-twin/training behavior but not claimed installed;
- **logical object** — non-physical network/service configuration;
- **transient client profile** — load/behavior model, not a permanent asset.

The digital twin now carries deterministic modeled route lengths and port identities for training, but these remain coordination values rather than field-certified as-builts. Exact equipment SKUs, conductor gauges, breaker/feeder sizing, conduit fill, bend radius, firestopping, cable support spacing, grounding/bonding, rack elevations, RF validation, cable certification results, UPS runtime, final IP addressing, retention periods and provider circuits remain subject to licensed engineering / installer / commissioning inputs.

## Step 4C device archetype / component contract

Step 4C separates **physical placement** from **device realism**. Step 4B remains the wiring/topology authority; Step 4C defines what a learner can actually see, inspect and operate at an endpoint.

Device maturity is tracked as:

`placeholder → recognizable → componentized → interactive → lab_complete`

A device may not be called `lab_complete` unless its modeled assembly contains the ports and components referenced by its physical wiring and its visible state is driven by the same sandbox asset state used for diagnosis.

The first Step 4C archetype is the fixed PoE IP security camera. Its visible assembly includes mount, bracket, housing, optics, IR illumination, status indication, RJ45/PoE termination and cable entry. The camera inspector exposes its exact modeled connection chain and a training-only field-of-view overlay. Runtime states such as camera-link/PoE loss change the componentized camera presentation rather than coloring the whole object as a generic fault marker.

The archetype authority is `production/electronics/device-archetypes-v1.json`. Per-instance generated component records are published as `production/electronics/generated/equity-uprise-device-components-v1.json`.

The same pattern must be reused for APs, workstations, monitors, phones, MFPs, switches, patch panels, panelboards, sensors, access-control devices and AV hardware; cosmetic one-off mesh replacement is not sufficient.

### Physical-lab rule

A learner must be able to follow the same chain a real technician would follow. For a typical wired endpoint the inspectable path is:

`device → patch/power cord → jack or receptacle → horizontal/branch cable → patch panel or panelboard → access switch / electrical distribution → riser/backbone → B1 core/source`.

For PoE equipment the electrical dependency is intentionally carried over the Ethernet path rather than represented as a fake local AC cable. For fire alarm and other life-safety systems, training remains read-only/simulated and the model preserves dedicated signaling circuits instead of treating field devices as general LAN endpoints.
