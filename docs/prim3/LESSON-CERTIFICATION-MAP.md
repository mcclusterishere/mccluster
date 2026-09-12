# PRIM3 lesson and certification map

Status: curriculum planning authority

This document maps the complete fixed 66 module PRIM3 LMS to CompTIA Security+ SY0-701 and Network+ N10-009.

The mapping deliberately distinguishes three things:

1. **SOURCE** means a concept is actually present in the PRIM3 song or canonical source unit.
2. **BRIDGE** means McCluster adds certification instruction that fits the unit but is not claimed to be taught by the song.
3. **OUTSIDE EXAM** means the song teaches useful material that is not a direct objective on either mandatory exam. It may remain as enrichment, especially where it supports A+ style hardware knowledge.

The course stays fixed at 66 modules. M01 through M03 are songless certification foundations. M04 through M66 are 21 PRIM3 source units expanded to three modules each. U18 remains owner source required and is not invented here.

## Objective key

### Security+ SY0-701

| ID | Curriculum label |
| --- | --- |
| 1.1 | Security control categories and types |
| 1.2 | Core security concepts, AAA, Zero Trust, physical and deception controls |
| 1.3 | Change management and security impact |
| 1.4 | Cryptography, hashing, PKI and certificates |
| 2.1 | Threat actors, attributes and motivations |
| 2.2 | Threat vectors and attack surfaces |
| 2.3 | Vulnerability types |
| 2.4 | Indicators and malicious activity |
| 2.5 | Enterprise mitigation techniques |
| 3.1 | Architecture models and security implications |
| 3.2 | Secure enterprise infrastructure principles |
| 3.3 | Data protection concepts and strategies |
| 3.4 | Resilience, recovery, continuity and backups |
| 4.1 | Security techniques for computing resources |
| 4.2 | Hardware, software and data asset management |
| 4.3 | Vulnerability management activities |
| 4.4 | Security alerting and monitoring |
| 4.5 | Enterprise security capabilities and controls |
| 4.6 | Identity and access management |
| 4.7 | Security automation and orchestration |
| 4.8 | Incident response |
| 4.9 | Investigation data sources |
| 5.1 | Security governance |
| 5.2 | Risk management |
| 5.3 | Third party risk management |
| 5.4 | Security compliance and privacy |
| 5.5 | Audits, assessments and penetration testing |
| 5.6 | Security awareness practices |

### Network+ N10-009

| ID | Curriculum label |
| --- | --- |
| 1.1 | OSI model |
| 1.2 | Network appliances, applications and functions |
| 1.3 | Cloud concepts and connectivity |
| 1.4 | Ports, protocols, services and traffic types |
| 1.5 | Transmission media, transceivers and connectors |
| 1.6 | Topologies, architectures and network types |
| 1.7 | IPv4 addressing |
| 1.8 | Modern and evolving network environments |
| 2.1 | Routing technologies |
| 2.2 | Switching technologies and features |
| 2.3 | Wireless devices and technologies |
| 2.4 | Physical installation factors |
| 3.1 | Organizational network processes and procedures |
| 3.2 | Network monitoring technologies |
| 3.3 | Disaster recovery and high availability |
| 3.4 | IPv4 and IPv6 network services |
| 3.5 | Network access and management methods |
| 4.1 | Basic network security concepts |
| 4.2 | Network attacks and impact |
| 4.3 | Network defenses and security solutions |
| 5.1 | Troubleshooting methodology |
| 5.2 | Cabling and physical interface troubleshooting |
| 5.3 | Network service troubleshooting |
| 5.4 | Performance troubleshooting |
| 5.5 | Troubleshooting tools and protocols |

## Songless certification foundation

| Module | Lesson | Security+ | Network+ | Role |
| --- | --- | --- | --- | --- |
| M01 | Security Foundations and Risk | 1.1, 1.2, 2.1, 5.2 | 4.1 | Establish CIA, controls, risk, threats, vulnerabilities, trust and basic governance language before the music begins. |
| M02 | Networking Foundations |  | 1.1, 1.2, 1.4, 1.6, 1.7, 2.1, 3.4, 3.5, 5.1 | Establish OSI, appliances, addressing, routing, core services and troubleshooting vocabulary that later songs can reuse instead of cramming. |
| M03 | Identity, Cryptography and Access | 1.4, 3.3, 4.6 | 4.1 | Establish authentication, authorization, access models, MFA, hashes, encryption, certificates and data protection basics. |

## U01 High Alert — M04 to M06

**SOURCE concepts:** alert state, monitoring, scope of work, evidence trail, access and search boundaries, professional judgment. The lyric explicitly invokes scope, searches, waivers and paper evidence.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M04 | Alerts, Monitoring and Triage | alert state, observation, evidence confidence, professional judgment | 4.4, 4.9 | 3.2, 5.1 | event vs alert vs incident, telemetry, baselines, thresholds, false positives, prioritization |
| M05 | Scope, Authorization and Evidence | scope of work, permission boundaries, evidence trail | 1.2, 4.8, 4.9, 5.1 | 3.1, 4.1, 5.1 | authorization vs technical access, provenance, integrity, preservation, least privilege, documented decisions |
| M06 | Monitoring Infrastructure and Incident Response | high alert as an operational state | 4.4, 4.5, 4.8, 4.9 | 1.4, 3.2, 3.4, 5.1, 5.5 | log sources, Syslog, SIEM, time synchronization, correlation, case management, containment and recovery |

## U02 White Grey Black Hat — M07 to M09

**SOURCE concepts:** white, grey and black hat; white, grey and black box; authorization; permission; source code and disk images; attack surface; ports; documentation; reporting and remediation.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M07 | White Grey Black Hat | authorization and intent | 2.1, 5.3, 5.5 | 4.1 | ethical vs unauthorized testing, rules of engagement, tester authority |
| M08 | White Grey Black Box | known, partially known and unknown target knowledge | 5.5 | 4.1 | assessment planning, reconnaissance boundaries and coverage tradeoffs |
| M09 | Penetration Testing Infrastructure, Scope and Remediation | attack surface, ports, findings, reports and fixes | 4.3, 5.3, 5.5 | 3.1, 4.3 | vulnerability lifecycle, validation, remediation, retest and evidence quality |

## U03 OSINT — M10 to M12

**SOURCE concepts:** open source intelligence, public sources, social media, forums, vulnerability databases, information sharing centers, logs and indicators. References to infiltrating proprietary or subscription data are narrative examples of what is outside legitimate OSINT and are not instruction.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M10 | OSINT Sources and Information Boundaries | public sources, social media, forums, public vs private boundaries | 4.3, 5.5 |  | passive reconnaissance, provenance, lawful collection and source classification |
| M11 | Indicators, Corroboration and Confidence | system indicators, logs and source comparison | 2.4, 4.4, 4.9 | 3.2, 5.1 | fact vs inference, duplicate reporting, false positives, confidence scoring |
| M12 | Threat Intelligence Feeds and Sharing | vulnerability databases and information sharing organizations | 4.3, 5.3 | 3.1, 3.2 | CVE and scoring workflow, proprietary vs public feeds, sharing governance and third party dependencies |

## U04 Anti Social Engineering — M13 to M15

**SOURCE concepts:** shoulder surfing, phishing, smishing, spear phishing, malicious links, spoofing, trust abuse and social reconnaissance.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M13 | Phishing, Smishing and Spear Phishing | phishing channels and targeted social attacks | 2.2, 5.6 | 4.2 | recognition, reporting, awareness campaigns and message triage |
| M14 | Impersonation, Shoulder Surfing and Trust | observed credentials, fake identity and manipulated trust | 2.2, 4.6, 5.6 | 4.1, 4.2 | identity proofing, verification and least privilege behavior |
| M15 | Spoofing, Verification and Human Layer Defense | spoofing and deceptive communications | 2.5, 4.5, 4.6, 5.6 | 4.1, 4.3 | email and DNS filtering, secure identity workflows, protective controls and escalation |

## U05 Red Blue Purple White Team — M16 to M18

**SOURCE concepts:** red offense, blue defense, purple integration, white exercise control, yellow development, orange offensive development and green defensive development.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M16 | Red and Blue Teams | offensive assessment vs defensive protection | 5.5 | 4.3 | exercise vs real incident boundaries and defensive validation |
| M17 | Purple and White Teams | integrated learning, rules and referee function | 5.1, 5.3, 5.5 | 3.1 | rules of engagement, deconfliction, evidence and after action review |
| M18 | Security Engineering Teams and Exercise Operations | yellow, orange and green development roles | 1.1, 1.3, 4.7, 5.1 | 3.1, 5.1 | SDLC, secure CI and testing, change control, automation and lessons learned |

## U06 Got Wifi — M19 to M21

**SOURCE concepts:** evil twin, rogue access point, wireless intrusion prevention, RF observation, spectrum filtering, jamming, Bluetooth abuse, patching, disassociation attacks, WPA3, AES and OSI Layers 1 and 2.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M19 | Wireless Threats and Rogue Access | evil twins, rogue APs, disassociation and hostile RF conditions | 2.2, 2.4 | 2.3, 4.2 | SSID and BSSID behavior, rogue device recognition and wireless attack indicators |
| M20 | Wireless Defense, Encryption and Authentication | WIPS, WPA3, AES, security patches | 1.4, 2.5, 4.1, 4.5 | 2.3, 4.1, 4.3 | enterprise authentication, NAC, 802.1X, secure configuration and key management |
| M21 | RF Spectrum, OSI and Wireless Troubleshooting | spectrum, interference, Layer 1 and Layer 2 | 3.2, 4.4 | 1.1, 2.3, 5.4, 5.5 | frequencies, channels, signal strength, performance baselines and troubleshooting tools |

## U07 Data Breach — M22 to M24

**SOURCE concepts:** crash and slowdown indicators, inaccessible files and ransom messages, USB attack exposure, RFID skimming, dictionary and brute force passwords, MFA, supply chain risk, third party vetting, patching, abnormal transfers, access logs and cryptographic collision and salt references.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M22 | Breach Indicators, Malware and Password Attacks | ransomware symptoms, performance changes and password attacks | 2.4, 4.4 | 3.2, 4.2 | indicators, alert validation, malware triage and abnormal resource behavior |
| M23 | Physical, Supply Chain and Identity Risk | removable media, RFID, vendors, MFA and access | 2.2, 2.4, 4.6, 5.3 | 4.1, 4.2 | vendor due diligence, identity controls, removable media and physical attack surfaces |
| M24 | Detection, Containment and Evidence | traffic activity, abnormal transfers, access logs and breach response | 4.4, 4.8, 4.9 | 3.2, 5.1 | incident timeline, evidence preservation, containment, recovery and lessons learned |

## U08 App Attacks — M25 to M27

**SOURCE concepts:** privilege escalation, RBAC, XSS, input validation, sanitization, CSP, XML, LDAP, DLL and SQL injection references, URL parameters, salted hashes, code review, debugger use and testing failures.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M25 | Injection and Cross Site Scripting | XSS, SQL and other injection families, URL parameters | 2.3, 2.4 | 4.2 | trust boundaries, safe input handling, defensive validation and application attack indicators |
| M26 | Privilege Escalation, RBAC and Credential Abuse | privilege escalation, role controls and credential material | 1.4, 2.4, 4.6 | 4.1 | least privilege, role based access, password protection and credential response |
| M27 | Secure Coding, Testing and Debugging | code review, validation libraries, testing and debugging | 4.1, 4.3, 5.1 | 3.1, 5.1 | static and dynamic analysis, SDLC, remediation validation and safe debugging workflow |

## U09 Virus Types — M28 to M30

**SOURCE concepts:** worms, phishing, keylogging, Trojan software, ransomware, spyware, fileless malware, rootkits, MFA, biometrics, password spraying, plaintext credentials, rainbow tables and packet inspection references.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M28 | Malware Families and Propagation | worm, Trojan, ransomware, spyware, fileless malware, keylogger and rootkit | 2.4 | 4.2 | symptoms, propagation models, isolation and defensive classification |
| M29 | Credential Attacks, MFA and Biometrics | password spraying, plaintext credentials, rainbow tables, biometrics and MFA | 1.4, 2.4, 4.6 | 4.1 | authentication factors, password storage, salts, passwordless options and response |
| M30 | Packet Evidence, Rootkits and Defensive Triage | packet observation and stealth persistence indicators | 4.4, 4.5, 4.8, 4.9 | 3.2, 4.3, 5.5 | packet capture, EDR, quarantine, investigation and root cause analysis |

## U10 Installation Types — M31 to M33

**SOURCE concepts:** compatibility, clean and custom installs, backups, multiboot, in place installation, preserved user information, registry changes, terminals, reboot and upgrades.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M31 | Installation Strategies and Compatibility | clean, custom and in place installation choices | 1.3, 4.2 | 3.1 | dependencies, legacy support, approved change, inventory and impact analysis |
| M32 | Backup, Migration and Rollback | backup before change and preserving data during migration | 1.3, 3.4 | 3.3 | recovery points, rollback, restore validation and continuity planning |
| M33 | Upgrade, Reboot, Registry and Verification | upgrades, reboot behavior and post change state | 1.3, 4.1 | 3.1, 3.4, 5.1, 5.3 | maintenance windows, configuration backup, verification and service troubleshooting |

## U11 Dive In — M34 to M36

**SOURCE concepts:** dumpster diving, paper shredding, residual documents, discarded information, physical observation, cloned broadcasts, packet overload and wireless deauthentication references. Offensive narrative is converted into defensive disposal and availability lessons rather than operational intrusion guidance.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M34 | Dumpster Diving, Data Disposal and Asset Exposure | information left in trash and need for shredding | 4.2, 5.4, 5.6 | 4.1, 4.2 | sanitization, destruction, retention, privacy and user awareness |
| M35 | Residual Information, Physical Recon and Evidence | labels, documents and physical clues that reveal systems | 3.3, 4.9, 5.5 | 1.6, 3.1 | data classification, asset records, topology reconstruction and evidence handling |
| M36 | Availability and Wireless Disruption Defense | packet overload and deauthentication as risk concepts | 2.4, 2.5 | 4.2, 4.3, 5.4 | DoS indicators, wireless resilience, segmentation and performance troubleshooting |

## U12 IoT — M37 to M39

**SOURCE concepts:** IoT, smart meters, connected lighting, vehicles, wearables, specialized devices, default credentials and malware risk. Canonical PRIM3 source mapping also connects this unit to sensors, actuators, segmentation and human override.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M37 | IoT Architecture, Devices and Embedded Risk | smart devices, wearables, specialized connected systems | 2.3, 3.1 | 1.8, 4.1 | embedded systems, firmware, RTOS, attack surface and network placement |
| M38 | Default Credentials, Segmentation and Hardening | unchanged defaults and device compromise risk | 2.2, 2.5, 4.1 | 4.1, 4.3 | default password changes, segmentation, configuration enforcement and access control |
| M39 | Sensors, Actuators, Fail Safe and Recovery | canonical sensor and control layer attached to the IoT unit | 3.2, 3.4 | 3.3, 5.1 | failure modes, safe state, human override, recovery and validation |

## U13 IaaS, SaaS, PaaS — M40 to M42

**SOURCE concepts:** IaaS, SaaS, PaaS, application ownership, hardware and platform responsibilities, circuits, Ethernet switching, servers, virtual machines, Kubernetes, hybrid environments, testing platforms, dashboards, data aggregation and uptime.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M40 | Cloud Service Models and Shared Responsibility | IaaS, SaaS, PaaS and who owns which layer | 3.1, 5.3 | 1.3 | responsibility matrix, vendor dependency, public, private and hybrid models |
| M41 | Virtualization, Containers and Network Infrastructure | virtual machines, Kubernetes, switches and servers | 3.1, 3.2 | 1.2, 1.6, 1.8, 2.2 | virtualization, containerization, switching, topology and modern network architecture |
| M42 | Cloud Operations, Availability and Platform Risk | uptime, dashboards, aggregate data and platform operations | 3.1, 4.1, 4.7 | 1.3, 3.2, 3.3 | cloud hardening, monitoring, automation, high availability and supportability |

## U14 Cap Ex Vs. Op Ex — M43 to M45

**SOURCE concepts:** capital vs operational expenditure, upfront cost, ongoing cost, ownership vs rental, fixed vs load driven expense and termination flexibility.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M43 | CapEx, OpEx and Asset Ownership | ownership, rental and cost structure | 3.1, 4.2 | 3.1 | procurement, asset lifecycle, ownership and risk transfer |
| M44 | Capacity, Load and Cost Modeling | load driven expense, fixed cost and capacity | 3.1, 3.4, 5.2 | 2.4, 5.4 | capacity planning, power load, quantitative risk and performance tradeoffs |
| M45 | Architecture Procurement and Resilience Tradeoffs | choosing ownership or service consumption under constraints | 3.1, 5.2, 5.3 | 1.3, 3.3 | vendor selection, SLA, cloud economics, availability and recovery tradeoffs |

## U15 Trappin From The Cloud — M46 to M48

**SOURCE concepts:** cloud compute, storage, networking, analytics, packet observation, agility, scalability, resource allocation, disaster recovery, elasticity and high availability.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M46 | Cloud Compute, Storage, Networking and Analytics | four common cloud resource families and packet visibility | 3.1, 4.9 | 1.3, 1.7, 2.1, 3.2 | cloud IP and routing, telemetry, VPC networking and analytics |
| M47 | Agility, Scalability, Elasticity and Allocation | rapid change, scaling and dynamic allocation | 3.1, 4.7 | 1.3, 1.8 | secure scaling, automation, infrastructure as code and modern network operations |
| M48 | High Availability, Disaster Recovery and Failover | disaster recovery and high availability | 3.4, 4.8 | 3.3, 5.1 | active active vs active passive, failover tests, recovery verification and lessons learned |

## U16 Per Diem — M49 to M51

**SOURCE concepts:** keyboard, touchscreen, optical drive, Bluetooth, memory, CPU, speakers, SSD, magnetic HDD, hybrid storage, NFC, DC power, battery and PCIe.

This song is intentionally **hardware heavy**. Much of its direct teaching is A+ style enrichment rather than mandatory Security+ or Network+ coverage. The map does not force false exam alignment.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE or outside exam focus |
| --- | --- | --- | --- | --- | --- |
| M49 | End User Hardware and Interfaces | keyboard, touchscreen, optical drive, speakers | 4.2 |  | OUTSIDE EXAM for most component identification; retain as hardware literacy and asset management enrichment |
| M50 | Storage, Memory, CPU, Power and Expansion | SSD, HDD, memory, CPU, DC power, battery and PCIe | 3.1, 4.2 | 2.4 | compute and power considerations, asset inventory and physical installation context |
| M51 | Wireless Proximity and Hardware Troubleshooting | Bluetooth, NFC and component chain diagnosis | 2.2, 4.1 | 5.1, 5.5 | wireless exposure, troubleshooting method and tool selection; NFC specifics remain enrichment |

## U17 Patch Work — M52 to M54

**SOURCE concepts:** updates, patching, backward compatibility, PoE, Trojan risk, UEFI and BIOS, fuzzing, input validation, code signing, integrity, secure cookies, XSS, static code analysis, IP blocking, secure coding, debugging and dynamic analysis.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M52 | Patch, Change, Compatibility and Firmware | updates, backward compatibility, firmware and patching | 1.3, 2.3, 2.5, 4.3 | 3.1 | change approval, firmware lifecycle, remediation, rollback and validation |
| M53 | Secure Coding, Validation, Signing and Cookies | fuzzing, input validation, code signing, integrity and secure cookies | 1.4, 2.3, 4.1 | 4.3 | application hardening, trusted code, web controls and defensive validation |
| M54 | Static and Dynamic Analysis, Debugging and Verification | static analysis, dynamic analysis and debugging | 4.3, 5.1 | 3.1, 5.1 | package monitoring, remediation verification, SDLC, documentation and root cause analysis |

## U18 Open Song 21 — M55 to M57

Status: **OWNER SOURCE REQUIRED**.

No song, concepts or exam mapping are invented. The three module positions remain reserved until the owner supplies the canonical source. Mandatory Security+ and Network+ completeness must not depend on these three unknown modules.

| Module | Lesson | Status |
| --- | --- | --- |
| M55 | Owner Source Required Part One | BLOCKED |
| M56 | Owner Source Required Part Two | BLOCKED |
| M57 | Infrastructure Bridge Pending Source | BLOCKED |

## U19 RAID HOT SITE — M58 to M60

**SOURCE concepts:** RAID 0, 1, 5, 6 and 10, striping, mirroring, parity, redundancy, drive failure tolerance, hot, warm and cold sites, restoration time and restoration cost.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M58 | RAID, Redundancy and Failure Domains | striping, mirroring, parity and failure tolerance | 3.4 | 3.3 | redundancy vs backup, failure domains and recovery consequences |
| M59 | Hot, Warm and Cold Sites | recovery site readiness, restore time and restore cost | 3.4, 5.2 | 3.3 | RTO, RPO, MTTR, MTBF, business impact and site selection |
| M60 | Backups, Failover Testing and Continuity | redundant recovery and operational continuity | 3.4, 4.8 | 3.3, 5.1 | backup types, failover validation, tabletop work, recovery and lessons learned |

## U20 Evil Twin — M61 to M63

**SOURCE concepts:** cloned SSIDs, evil twin, SIM swap, zero day references, pass the hash, replay, man in the browser, drive by download, typosquatting, on path or man in the middle, timing attack, logic bomb, RFID skimming, CSRF, privilege abuse and identity deception. These attacks are taught through recognition, impact and defense rather than operational reproduction.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M61 | Wireless and Identity Deception | cloned SSIDs, evil twin, typosquatting and on path deception | 2.2, 2.4 | 2.3, 4.2 | rogue AP detection, trusted network validation, impersonation and user verification |
| M62 | Credential Replay, SIM Swap and Privilege Abuse | replay, pass the hash, SIM swap and privilege escalation | 2.4, 4.6 | 4.1, 4.2 | MFA, identity proofing, privileged access and credential replay response |
| M63 | Browser, Zero Day and Application Attack Recognition | zero day, drive by download, logic bomb, CSRF and browser deception | 2.3, 2.4, 4.1 | 4.2, 4.3 | patching, application hardening, filtering, isolation and defensive response |

## U21 Ghost In The Wires — M64 to M66

**SOURCE concepts:** network infrastructure, bound vs unbound media, radio and light, coaxial cable, Cat cable, fiber, transmission interception, crosstalk, RJ45 Ethernet, S/PDIF, coax and fiber audio, analog connectors, HDMI, VGA and troubleshooting.

| Module | Lesson | SOURCE focus | Security+ | Network+ | BRIDGE focus |
| --- | --- | --- | --- | --- | --- |
| M64 | Network Media, Copper, Coax, Fiber and Wireless | bound and unbound transmission, coax, twisted pair and fiber | 3.2 | 1.1, 1.5 | Ethernet media standards, fiber modes, cable selection and physical security implications |
| M65 | Connectors, Interfaces and Signal Transport | RJ45, coax, fiber, audio and display interfaces | 4.2 | 1.5, 2.4, 5.2 | connector recognition, termination, physical installation and interface faults |
| M66 | Cabling Faults, Crosstalk and Troubleshooting | troubleshooting and crosstalk | 3.2, 4.4 | 5.1, 5.2, 5.4, 5.5 | attenuation, interference, counters, signal strength, cable tools, packet tools and documented verification |

# Numbered objective coverage ledger

The following ledger is a **planned assignment map**, not a claim that every lesson has already been authored. An objective becomes complete only after its official bullets and nested bullets are actually taught and assessed.

## Security+ assignment ledger

| Objective | Primary modules |
| --- | --- |
| 1.1 | M01, M18 |
| 1.2 | M01, M05 |
| 1.3 | M18, M31, M32, M33, M52 |
| 1.4 | M03, M20, M26, M29, M53 |
| 2.1 | M01, M07 |
| 2.2 | M13, M14, M19, M23, M34, M38, M61 |
| 2.3 | M25, M37, M52, M63 |
| 2.4 | M11, M19, M22, M23, M25, M26, M28, M29, M36, M61, M62, M63 |
| 2.5 | M15, M20, M36, M38, M52 |
| 3.1 | M37, M40, M41, M42, M43, M44, M45, M46, M47 |
| 3.2 | M39, M41, M64, M66 |
| 3.3 | M03, M35 |
| 3.4 | M32, M39, M44, M48, M58, M59, M60 |
| 4.1 | M20, M27, M33, M38, M42, M53, M63 |
| 4.2 | M31, M34, M43, M49, M50, M65 |
| 4.3 | M09, M10, M12, M27, M52, M54 |
| 4.4 | M04, M06, M11, M22, M24, M30, M66 |
| 4.5 | M06, M15, M20, M30 |
| 4.6 | M03, M14, M15, M23, M26, M29, M62 |
| 4.7 | M18, M42, M47 |
| 4.8 | M05, M06, M24, M30, M48, M60 |
| 4.9 | M04, M05, M06, M11, M24, M30, M35, M46 |
| 5.1 | M05, M18, M27, M54 |
| 5.2 | M01, M44, M45, M59 |
| 5.3 | M07, M09, M12, M23, M40, M45 |
| 5.4 | M01, M34 |
| 5.5 | M07, M08, M09, M10, M17, M35 |
| 5.6 | M13, M14, M15, M34 |

## Network+ assignment ledger

| Objective | Primary modules |
| --- | --- |
| 1.1 | M02, M21, M64 |
| 1.2 | M02, M41 |
| 1.3 | M40, M42, M45, M46, M47 |
| 1.4 | M02, M06 |
| 1.5 | M02, M64, M65 |
| 1.6 | M02, M35, M41 |
| 1.7 | M02, M46 |
| 1.8 | M02, M37, M41, M47 |
| 2.1 | M02, M46 |
| 2.2 | M02, M41 |
| 2.3 | M19, M20, M21, M61 |
| 2.4 | M02, M44, M50, M65 |
| 3.1 | M05, M09, M12, M17, M18, M27, M31, M33, M35, M43, M52, M54 |
| 3.2 | M04, M06, M11, M12, M22, M24, M30, M42, M46 |
| 3.3 | M32, M39, M42, M45, M48, M58, M59, M60 |
| 3.4 | M02, M06, M33 |
| 3.5 | M02, M05 |
| 4.1 | M03, M05, M07, M14, M15, M20, M23, M26, M29, M34, M37, M38, M62 |
| 4.2 | M13, M14, M19, M22, M23, M25, M28, M34, M36, M51, M61, M62, M63 |
| 4.3 | M09, M15, M16, M20, M30, M36, M38, M53, M63 |
| 5.1 | M02, M04, M05, M06, M11, M18, M24, M27, M33, M39, M48, M51, M54, M60, M66 |
| 5.2 | M64, M65, M66 |
| 5.3 | M02, M33 |
| 5.4 | M21, M36, M44, M66 |
| 5.5 | M06, M21, M30, M51, M66 |

# Curriculum consequences

1. Every numbered objective on both mandatory exams has at least one planned home without using U18 as a dependency.
2. Song concepts remain recognizable and are not rewritten merely to force a certification match.
3. The strongest natural Security+ units are High Alert, White Grey Black Hat, Anti Social Engineering, Data Breach, App Attacks, Virus Types, Patch Work and Evil Twin.
4. The strongest natural Network+ units are Got Wifi, IaaS SaaS PaaS, Trappin From The Cloud, RAID HOT SITE and Ghost In The Wires.
5. Per Diem is intentionally allowed to remain hardware enrichment where the current two exams do not directly require its component vocabulary.
6. CapEx Vs. OpEx becomes the architecture economics, procurement, capacity and risk tradeoff unit instead of being forced into a narrow technical objective.
7. The next authoring pass must descend from numbered objectives to every official bullet and nested bullet, then attach each bullet to one or more modules and an assessment or lab artifact. This document establishes the lesson level map that makes that deeper traceability possible.
