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

## Step 4A topology

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

The generated connection graph models every connection with a medium/cable type and dependency semantics.

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

Every Step 4A device is one of:
- **existing canonical asset** — already present in the building inventory/registry;
- **design-intent planned asset** — populated for realistic digital-twin/training behavior but not claimed installed;
- **logical object** — non-physical network/service configuration;
- **transient client profile** — load/behavior model, not a permanent asset.

Exact equipment models, rack elevations, port counts beyond deterministic design sizing, cable routing lengths, fire-alarm conductor gauges, breaker sizes, UPS runtime, AP final coordinates, IP subnets, retention periods and provider circuits remain subject to real design/commissioning inputs.
