/* Equity Uprise screens — manual pages for the sandbox shell. Each page teaches the idea behind the command at
   A+ / Network+ / Security+ depth, then shows how it is used here. Plain data: the shell renders it. */

export const MAN = Object.freeze({
  help: { summary: "list the commands this console understands", synopsis: "help", body: [
    "Every console in the building speaks a little differently: a Linux workstation, a switch's IOS-style CLI,",
    "a server's BMC, a UPS network card. `help` lists what works where you are now.",
    "Tip: press Tab to complete commands, hostnames and ports; Up/Down walks your history."] },
  man: { summary: "read a manual page", synopsis: "man <command>", body: ["Manual pages explain the why, not just the syntax. Start with `man troubleshooting`."] },
  troubleshooting: { summary: "the method: observe, hypothesize, test, fix, verify", synopsis: "man troubleshooting", cert: "A+ / Network+ troubleshooting methodology", body: [
    "1. OBSERVE      what is the user-visible symptom? who is affected: one device, a room, a floor?",
    "2. HYPOTHESIZE  work the OSI model bottom-up: power -> cable/link -> VLAN/IP -> service -> application.",
    "3. TEST         one change of evidence at a time: ping, show interfaces status, ip addr, systemctl status.",
    "4. FIX          the smallest change that addresses the cause, not the symptom.",
    "5. VERIFY       prove it: the same test that failed now passes. Then document (your evidence is recorded).",
    "Scope tells you a lot: one device = its port/cable/config; a whole floor = its switch, UPS or uplink;",
    "everything by name but not by IP = DNS; new devices get 169.254 addresses = DHCP."] },
  ping: { summary: "test reachability with ICMP echo", synopsis: "ping <host|ip> [-c count]", cert: "Network+: ICMP, connectivity testing", body: [
    "ping sends ICMP echo requests and waits for echo replies. A reply proves layer 1-3 work end to end.",
    "'Destination Host Unreachable' comes from a router/gateway that has no path; silence (timeouts) means",
    "the packets left but nothing came back. 'unknown host' means name resolution failed before any packet",
    "was sent: try the IP address to separate DNS problems from network problems.",
    "On a switch the IOS form prints ! for each reply and . for each timeout."] },
  traceroute: { summary: "show each hop toward a host", synopsis: "traceroute <host>", cert: "Network+: routing, hop-by-hop isolation", body: [
    "traceroute sends probes with increasing TTL so every router on the path answers in turn.",
    "The last hop that answers is where to look: the next device or link after it is the suspect."] },
  nslookup: { summary: "query DNS for a name", synopsis: "nslookup <name>   (also: dig, host)", cert: "Network+: DNS records and troubleshooting", body: [
    "DNS turns names into addresses (A records). If nslookup times out, the resolver (ns1) is unreachable",
    "or down; if it answers NXDOMAIN the name does not exist. Names here live in the eu.sandbox zone."] },
  dig: { summary: "query DNS (detailed)", synopsis: "dig <name>", body: ["Same question as nslookup with the full answer section. See `man nslookup`."] },
  ip: { summary: "show addresses, links and routes", synopsis: "ip addr | ip link | ip route", cert: "A+ / Network+: IP addressing, APIPA, default gateway", body: [
    "ip addr shows the interface's address and whether the link is UP (state UP, LOWER_UP = carrier).",
    "NO-CARRIER means no link at layer 1: cable, port shut down, or no power to the far end.",
    "An address in 169.254.0.0/16 is APIPA: the host asked DHCP for a lease and got no answer.",
    "ip route shows the default gateway: off-subnet traffic goes there."] },
  ifconfig: { summary: "legacy interface view", synopsis: "ifconfig", body: ["Older equivalent of `ip addr`. Windows uses `ipconfig` (also accepted here)."] },
  dhclient: { summary: "ask DHCP for a lease", synopsis: "dhclient -v   (Windows: ipconfig /renew)", cert: "A+ / Network+: DHCP DORA", body: [
    "DHCP is DORA: Discover (broadcast), Offer, Request, Acknowledge. Discovers that get no Offer mean the",
    "DHCP server is down or unreachable from this VLAN (on a routed network the switch relays the broadcast)."] },
  systemctl: { summary: "inspect and control services", synopsis: "systemctl status|restart|start|stop <unit>", cert: "Linux+ / Security+ ops: service management", body: [
    "systemd runs services as units. `status` shows Active: active (running) or failed, plus recent log lines.",
    "`restart` stops and starts it. Restarting fixes a crashed daemon; it does not fix a bad config or a dead",
    "dependency, so read the status and the journal first. Units here: dhcpd, named, chronyd, radiusd, ...",
    "Services run on the B1 virtualization hosts: ssh b1-hyp01 (dhcpd, named, chronyd), b1-hyp02, b1-hyp03."] },
  journalctl: { summary: "read the system journal", synopsis: "journalctl [-u unit] [-n lines] [-p err]", cert: "Security+: logging and event review", body: [
    "Logs are evidence. Filter by unit (-u named), by priority (-p err) and keep the time order in mind:",
    "the first error is usually the cause, the rest are consequences."] },
  ipmitool: { summary: "talk to a server's BMC (out-of-band)", synopsis: "ipmitool [-H host] sel list | sensor | chassis status | chassis power on|off", cert: "Server+ / A+: out-of-band management", body: [
    "A BMC is a small computer inside the server that works even when the OS is down. IPMI lets you read",
    "the System Event Log (sel), sensors (temperatures, fans, PSUs) and power the chassis on or off.",
    "If a host answers on its BMC but not on its OS address, the hardware is alive and the OS or power state",
    "is the problem."] },
  raid: { summary: "storage array health", synopsis: "raid status | raid rebuild   (also: cat /proc/mdstat)", cert: "A+ / Server+: RAID levels and rebuilds", body: [
    "RAID 6 survives two failed disks; a degraded array is still serving data but has lost redundancy.",
    "Replace the failed member and rebuild. Until the rebuild finishes, a further failure is far more dangerous."] },
  ups: { summary: "rack UPS status and service", synopsis: "ups status [ups] | ups selftest | ups replace-battery", cert: "A+ / Network+: power, UPS, environmental", body: [
    "Each floor's network closet (IDF) has a rack UPS. If it fails, the access switch loses power and every",
    "PoE device behind it (APs, cameras, phones) goes dark at once: a floor-wide symptom with one cause.",
    "Read status, run a self-test, and replace the battery module when it reports failed."] },
  camera: { summary: "IP camera and video recorder status", synopsis: "camera list | camera status <cam> | vms status", cert: "Security+: physical security controls, CCTV", body: [
    "A camera needs PoE power, a link to its switch port, the right VLAN (70, CCTV), and a working path to",
    "the recorder (b1-nvr01). 'No signal' is a symptom: walk power -> link -> VLAN -> recorder."] },
  bacnet: { summary: "building controls (BACnet)", synopsis: "bacnet who-is | bacnet read <ctrl> | bacnet reinit <ctrl>", cert: "Security+: OT/ICS awareness", body: [
    "Building automation controllers speak BACnet. Who-Is/I-Am discovers devices; ReinitializeDevice restarts",
    "a controller's application. OT networks are segmented (VLAN 90) because they control physical systems."] },
  cable: { summary: "physical layer work (field technician)", synopsis: "cable test|reseat|replace <host|port>", cert: "A+ / Network+: cable testers, TDR, fiber", body: [
    "`cable test` runs a TDR-style test: OK, OPEN (break) or SHORT, with the distance to the fault.",
    "`reseat` re-terminates/re-plugs a patch cord; `replace` swaps a damaged cable or fiber jumper.",
    "In this sandbox these are field actions on the simulated plant, nothing else."] },
  show: { summary: "IOS show commands (on a switch)", synopsis: "show interfaces status | show interface <port> | show vlan brief | show power inline | show ip igmp snooping | show mls qos | show logging | show lldp neighbors | show running-config", cert: "Network+ / CCNA: switch verification", body: [
    "show interfaces status is the first look at a switch: connected, notconnect (no link), disabled",
    "(administratively shut down) or err-disabled, plus each port's VLAN. Then drill into one port."] },
  configure: { summary: "enter configuration mode (switch)", synopsis: "configure terminal -> interface <port> -> ... -> end", cert: "Network+ / CCNA: switch configuration", body: [
    "configure terminal enters global config; interface Gi1/0/8 selects a port. In interface mode:",
    "  shutdown / no shutdown            disable / enable the port",
    "  switchport access vlan <id>       data VLAN for the port",
    "  switchport voice vlan <id>        voice VLAN for an IP phone (50 here)",
    "  power inline auto | never         PoE on / off",
    "Global: ip igmp snooping (multicast containment), mls qos (QoS for media). `end` leaves config,",
    "`write memory` saves. Prefix `do` to run a show command from config mode."] },
  ssh: { summary: "open a shell on another device", synopsis: "ssh <host>", cert: "Security+: secure remote administration", body: [
    "SSH is encrypted remote administration (TCP 22). You can only reach what the network lets you reach:",
    "a down switch, a cut uplink or a host on the wrong VLAN will fail here first. `exit` comes back."] },
  vlan: { summary: "what the VLANs are for", synopsis: "man vlan", cert: "Network+ / Security+: segmentation", body: [
    "10 MGMT  20 STAFF  30 LAB  40 GUEST (internet only)  50 VOICE  60 AV  70 CCTV  80 ACCESS",
    "90 BAS-OT  100 IOT  110 SERVERS  120 PRINTERS  130 DMZ",
    "Segmentation limits blast radius: a guest or IoT device cannot reach servers or controls.",
    "A workstation dropped into VLAN 40 gets an address and the internet, but nothing internal."] },
  ticket: { summary: "your training ticket", synopsis: "ticket", body: ["TRAINING mode opens one guided ticket per floor from the canonical scenario pack. `lab start` reopens it after a reset."] },
  reset: { summary: "return this mode's sandbox to baseline", synopsis: "reset", body: ["Clears every sandbox fault in the current mode only. Other modes are untouched."] },
  status: { summary: "sandbox summary", synopsis: "status", body: ["Counts of available / degraded / unavailable devices in the sandbox and the mode you are in."] },
  alarms: { summary: "current NOC alarms (symptoms)", synopsis: "alarms", body: ["What monitoring sees: unreachable or degraded devices. Symptoms, not causes."] },
});
