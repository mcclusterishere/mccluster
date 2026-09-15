(function () {
  "use strict";

  window.PRIM3_LESSONS = {
    M01: {
      title: "Security Foundations and Risk",
      summary: "Build the language that every later security lesson depends on. Learn what we protect, what can go wrong, how risk is described and how security controls reduce risk without pretending that any single control makes a system safe.",
      reading: [
        ["Why this course starts here", "Before learning attacks, tools or response, you need a small set of ideas that explain why security work exists. This foundation module is not attached to a PRIM3 song or episode. It gives you certification knowledge that the album does not need to carry."],
        ["Assets are things worth protecting", "An asset is anything an organization values. Assets can include data, devices, applications, services, money, reputation, intellectual property, facilities and people. Security decisions make more sense when you first identify which assets matter and why."],
        ["Confidentiality", "Confidentiality means information is available only to people, systems or processes that are allowed to see it. Access control, encryption and careful handling can help protect confidentiality. A confidentiality failure is an exposure problem."],
        ["Integrity", "Integrity means information and systems remain accurate, complete and protected from unauthorized change. Integrity matters when storing records, sending messages, installing software and making configuration changes. A system can remain available while still having an integrity problem."],
        ["Availability", "Availability means systems, services and information are accessible when authorized users need them. Redundancy, backups, resilient design, maintenance and incident response can all support availability. Availability is not simply whether a device is powered on."],
        ["Threats and vulnerabilities are different", "A threat is something that could cause harm. A vulnerability is a weakness that could be used or triggered. A threat does not automatically create damage, and a vulnerability does not automatically mean an incident has happened. Risk appears when we consider them in context."],
        ["Risk combines possibility and consequence", "Risk considers the chance that something harmful will happen and the impact if it does. Organizations use risk to decide what deserves attention first. A low likelihood event can still matter when the possible impact is severe, and a common event can matter even when each individual impact is small."],
        ["Likelihood and impact", "Likelihood asks how probable an unwanted event is. Impact asks how much harm the event could cause. Security teams often compare both so they can prioritize limited time and money. These ratings are estimates, so the reasoning behind them should be documented."],
        ["Controls reduce risk", "A security control is a safeguard used to prevent, detect, respond to or recover from unwanted events. Controls may be technical, physical, administrative or operational. A control can reduce likelihood, reduce impact or improve detection and recovery."],
        ["Layered security", "Strong security rarely depends on one control. Layering means using multiple safeguards so one failure does not automatically become total failure. A password may protect an account, multifactor authentication can add another check, monitoring can detect unusual use and recovery planning can reduce damage if prevention fails."],
        ["Data has different states", "Data can be stored, moving between systems or actively being processed. These states are commonly described as data at rest, data in transit and data in use. Different protections may be appropriate for each state."],
        ["Zero trust is a verification model", "Zero trust does not mean trusting nobody emotionally. It means access decisions should continuously consider identity, device, context and policy instead of assuming that being inside a network automatically makes activity safe. The practical idea is verify explicitly and limit access to what is needed."],
        ["Shared responsibility", "Security responsibility is often divided among multiple parties. A cloud provider may protect physical facilities and parts of the platform while the customer remains responsible for users, configurations and data. Knowing who owns each responsibility prevents dangerous assumptions."],
        ["Governance turns goals into rules", "Governance defines how an organization makes security decisions. Policies state expectations. Standards make expectations more specific. Procedures explain how work is performed. Good governance connects business goals, legal duties, risk decisions and technical controls."],
        ["The foundation mental model", "Start every security problem by asking six questions. What are we protecting? What could harm it? What weakness exists? How likely is the problem? What would the impact be? Which controls reduce the risk to an acceptable level? Those questions will return throughout the course." ]
      ],
      terms: [
        ["Asset", "Something an organization values and wants to protect."],
        ["Confidentiality", "Protecting information from unauthorized disclosure."],
        ["Integrity", "Protecting information and systems from unauthorized or improper change."],
        ["Availability", "Keeping authorized access to systems and information reliable when needed."],
        ["Threat", "Something that could cause harm to an asset."],
        ["Vulnerability", "A weakness that could be used or triggered to cause harm."],
        ["Risk", "The possibility of loss or harm considered through likelihood and impact."],
        ["Likelihood", "An estimate of how probable an unwanted event is."],
        ["Impact", "The amount of harm an unwanted event could cause."],
        ["Security control", "A safeguard used to reduce risk."],
        ["Layered security", "Using multiple safeguards so one failure does not become total failure."],
        ["Zero trust", "A model that requires explicit verification and limited access instead of automatic trust based on location."],
        ["Shared responsibility", "A model where different parties own different security duties."],
        ["Policy", "A formal statement of organizational expectations or requirements." ]
      ],
      quiz: [
        {q:"What is an asset?",a:["Something the organization values and wants to protect","Only a physical computer","Only confidential data","Any event in a log"],c:0},
        {q:"Which security goal focuses on preventing unauthorized disclosure?",a:["Confidentiality","Integrity","Availability","Capacity"],c:0},
        {q:"Which security goal focuses on preventing unauthorized change?",a:["Integrity","Availability","Confidentiality","Scalability"],c:0},
        {q:"Which security goal focuses on reliable authorized access?",a:["Availability","Confidentiality","Integrity","Attribution"],c:0},
        {q:"What is the difference between a threat and a vulnerability?",a:["A threat could cause harm while a vulnerability is a weakness","They are identical terms","A vulnerability is always an attacker","A threat is always a software bug"],c:0},
        {q:"What two ideas are commonly considered when prioritizing risk?",a:["Likelihood and impact","Color and speed","Storage and screen size","Brand and warranty"],c:0},
        {q:"What is the purpose of a security control?",a:["Reduce risk through prevention, detection, response or recovery","Guarantee that incidents can never happen","Replace all policies","Eliminate the need for monitoring"],c:0},
        {q:"Why use layered security?",a:["So one failed safeguard does not automatically become total failure","So every control performs the same job","So users receive unlimited access","So risk no longer needs review"],c:0},
        {q:"What does zero trust emphasize?",a:["Explicit verification and limited access","Trusting every internal device automatically","Removing identity checks","Allowing permanent broad access"],c:0},
        {q:"What does shared responsibility require?",a:["Knowing which party owns each security duty","Assuming the service provider owns every duty","Giving every duty to the user","Avoiding written responsibilities"],c:0}
      ]
    },

    M02: {
      title: "Networking Foundations",
      summary: "Learn how devices find each other, how traffic moves and which services make ordinary networks usable. This module creates the vocabulary needed for later Network Plus material and for nearly every cybersecurity topic in PRIM3.",
      reading: [
        ["Why networking comes before network security", "You cannot protect traffic you do not understand. This module is not attached to a song or episode. It gives you the basic network picture that later lessons can build on without stopping to redefine every device and service."],
        ["A network connects communicating systems", "A network allows devices and services to exchange information. A host is a device that participates in communication. A client usually requests a service. A server usually provides a service. One system can act as both depending on the task."],
        ["Layers simplify a complex process", "Networking models divide communication into layers so people can reason about one part at a time. The OSI model describes seven conceptual layers. The TCP IP model groups network communication more broadly. You do not need to memorize every detail today. First understand that each layer has a different job."],
        ["Local delivery and media access addresses", "Network interfaces use local link identifiers commonly called media access control addresses. Switches use this information to move frames within a local network. This local identity is different from an internet protocol address."],
        ["Internet protocol addresses identify network locations", "Internet protocol addresses help devices communicate across networks. Internet Protocol version four uses thirty two bit addresses. Internet Protocol version six uses much larger one hundred twenty eight bit addresses. The address helps describe where traffic should go at the network layer."],
        ["Subnets create boundaries", "A subnet divides an address space into smaller network ranges. Subnetting helps organize devices, control broadcast domains, plan routes and support segmentation. You will study the math more deeply later, but the first idea is that a subnet defines which addresses belong to the same logical network."],
        ["Default gateways reach other networks", "When a host needs to reach a destination outside its local subnet, it normally sends the traffic toward a default gateway. A router commonly performs this role. The router examines network layer information and decides where the packet should go next."],
        ["Switches and routers solve different problems", "A switch primarily connects devices within a local network and forwards frames. A router connects different networks and forwards packets between them. Modern devices can combine many functions, but keeping the basic roles separate helps troubleshooting."],
        ["Firewalls enforce traffic policy", "A firewall evaluates traffic against rules and decides whether communication should be allowed, blocked or inspected. Firewalls can exist on endpoints, network boundaries and cloud environments. A firewall does not make every permitted connection safe. It enforces a defined traffic policy."],
        ["Wireless access points connect wireless clients", "A wireless access point allows compatible wireless devices to join a network. The access point still depends on addressing, authentication, switching, routing and upstream services. Strong signal does not guarantee that every other network dependency is working."],
        ["Name resolution makes networks usable", "Domain Name System services translate names into information that computers can use, commonly including internet protocol addresses. People remember names more easily than numeric addresses, so name resolution becomes a critical dependency for many applications."],
        ["Address assignment reduces manual configuration", "Dynamic Host Configuration Protocol can provide clients with network settings such as an address, subnet information, a default gateway and name resolution servers. If address assignment fails, a device can have a working network interface and still be unable to communicate normally."],
        ["Network address translation changes address representation", "Network address translation allows one set of addresses to be represented as another set as traffic crosses a boundary. A common use lets many private addresses share one or more public addresses. Translation changes addressing, not the meaning of the application data itself."],
        ["Ports help identify services", "Transport protocols use port numbers to distinguish conversations and services on a host. A port is not a physical connector in this context. It is a logical identifier. Certification study will require you to recognize common services and their usual ports, but first understand what problem ports solve."],
        ["Protocols are agreed communication rules", "A protocol defines how systems communicate. Some protocols provide addressing or transport. Others provide application services such as name resolution, web access, email or remote management. Secure alternatives often add encryption and stronger authentication to older service patterns."],
        ["Troubleshoot the path, not the guess", "A useful beginner method is to move through the communication path. Check power and physical connection. Check the local interface. Check addressing. Check the default gateway. Check name resolution. Check routing and policy. Check the destination service. This keeps troubleshooting systematic." ]
      ],
      terms: [
        ["Host", "A device that participates in network communication."],
        ["Client", "A system or application that requests a service."],
        ["Server", "A system or application that provides a service."],
        ["OSI model", "A seven layer conceptual model used to describe network communication functions."],
        ["TCP IP model", "A practical layered model used to describe internet based communication."],
        ["Media access control address", "A local link identifier associated with a network interface."],
        ["Internet protocol address", "A logical network address used to identify and route to a network location."],
        ["Subnet", "A logical division of an internet protocol address range."],
        ["Default gateway", "The router a host normally uses to reach other networks."],
        ["Switch", "A device that commonly forwards frames within a local network."],
        ["Router", "A device that forwards packets between networks."],
        ["Firewall", "A control that evaluates network traffic against policy."],
        ["Domain Name System", "A distributed naming system that resolves names into useful network information."],
        ["Dynamic Host Configuration Protocol", "A service that can automatically provide network configuration to clients."],
        ["Network address translation", "A process that represents one network address as another across a boundary."],
        ["Port", "A logical transport identifier used to distinguish services and conversations."],
        ["Protocol", "A defined set of rules for communication between systems." ]
      ],
      quiz: [
        {q:"What is a host?",a:["A device that participates in network communication","Only a server in a data center","Only a wireless device","A security policy"],c:0},
        {q:"Why are layered network models useful?",a:["They divide communication into understandable functions","They remove the need for protocols","They guarantee security","They replace physical networks"],c:0},
        {q:"Which device primarily forwards frames inside a local network?",a:["A switch","A router only","A certificate authority","A password manager"],c:0},
        {q:"Which device normally connects different networks?",a:["A router","A keyboard","A camera sensor","A file extension"],c:0},
        {q:"What does a default gateway help a host reach?",a:["Destinations outside the local subnet","Only files stored on the same computer","Only wireless networks","Only encrypted websites"],c:0},
        {q:"What is the purpose of Domain Name System services?",a:["Resolve names into useful network information","Assign user roles","Encrypt storage drives","Measure processor temperature"],c:0},
        {q:"What can Dynamic Host Configuration Protocol provide?",a:["Automatic network configuration such as addresses and gateway information","Digital signatures","Application source code","Physical access badges"],c:0},
        {q:"What does a firewall primarily do?",a:["Evaluate traffic against policy","Assign every internet address","Replace routers","Store all backups"],c:0},
        {q:"What is a port in transport networking?",a:["A logical identifier for services and conversations","Always a physical connector","A user account","A wireless antenna"],c:0},
        {q:"What is a strong beginner troubleshooting approach?",a:["Check the communication path in a consistent order","Change random settings until traffic works","Assume name resolution is always the problem","Replace every network device first"],c:0}
      ]
    },

    M03: {
      title: "Identity, Cryptography and Access",
      summary: "Learn how systems decide who you are, what you may do and how cryptography protects information and trust. These ideas appear throughout Security Plus and they support nearly every later PRIM3 unit.",
      reading: [
        ["Why identity belongs in the foundation", "Most modern systems depend on identity. Security is not only about keeping strangers outside. It is also about proving identity, granting appropriate access, protecting credentials and detecting misuse of valid accounts. This module is not tied to a song or episode."],
        ["Identification comes first", "Identification is the act of claiming an identity. Typing a username or presenting an account identifier tells a system who you claim to be. Identification by itself does not prove the claim is true."],
        ["Authentication verifies the claim", "Authentication checks evidence that supports an identity claim. A password, security key, biometric characteristic or other factor can be used. Strong authentication reduces the chance that someone can simply claim another person's identity and be accepted."],
        ["Authorization decides what the identity may do", "After authentication, authorization determines which resources and actions are allowed. A person can be correctly authenticated and still be denied access to a particular file, application or administrative function."],
        ["Accounting records activity", "Accounting records relevant actions associated with identities and systems. Logs can show sign ins, resource access, configuration changes and administrative actions. Accounting supports monitoring, investigation and accountability."],
        ["Authentication factors prove identity in different ways", "Common factor categories include something you know, something you have and something you are. Location and behavior can also influence access decisions. Using two passwords is not true multifactor authentication because both are the same type of factor."],
        ["Multifactor authentication combines different factors", "Multifactor authentication requires evidence from more than one factor category. For example, a password plus a security key combines something you know with something you have. This reduces the value of a stolen password by itself."],
        ["Single sign on reduces repeated authentication", "Single sign on allows one authenticated identity session to reach multiple approved services. Federation allows separate identity domains or organizations to trust defined identity assertions. Convenience does not remove the need for careful access design."],
        ["Least privilege limits access", "Least privilege gives a user or process only the permissions needed for the approved task. Broad permanent access creates more opportunity for mistakes, misuse and account compromise to cause damage."],
        ["Role based and attribute based access", "Role based access assigns permissions according to defined job or function roles. Attribute based access evaluates characteristics such as department, resource, device, location or other policy inputs. Different organizations may combine several access models."],
        ["Encryption protects readable information", "Encryption transforms readable information into a protected form using cryptographic algorithms and keys. Authorized parties use the appropriate key process to recover the original information. Encryption supports confidentiality but does not automatically prove that information is accurate or trustworthy."],
        ["Symmetric and asymmetric encryption solve different problems", "Symmetric encryption uses the same shared secret for encryption and decryption. It is efficient for protecting large amounts of data. Asymmetric encryption uses a mathematically related public key and private key pair. It supports use cases such as secure key exchange and digital signatures."],
        ["Hashing creates a one way digest", "A cryptographic hash function produces a fixed length digest from input data. Hashing is commonly used for integrity checks and safe password storage designs when combined with appropriate password protection methods. A hash is not encryption because normal use does not decrypt the digest back into the original input."],
        ["Digital signatures support integrity and authenticity", "A digital signature uses asymmetric cryptography so a verifier can check that signed data came from the holder of the relevant private key and was not altered after signing. This supports integrity, authenticity and forms of nonrepudiation."],
        ["Certificates bind identities to public keys", "A digital certificate contains identity information and a public key, with trust supported by a certificate authority and public key infrastructure. Browsers and other systems use certificate validation to decide whether they can trust a presented certificate for a defined purpose."],
        ["Key management matters as much as algorithms", "Strong cryptography can fail when keys are exposed, lost, reused carelessly or never rotated. Key management includes secure generation, storage, distribution, rotation, recovery and destruction. The secret material must be protected throughout its lifecycle."],
        ["The identity mental model", "Remember the sequence: identify, authenticate, authorize and record. Then protect sensitive information with the right cryptographic tool. Access control answers who may do what. Cryptography helps protect confidentiality, integrity, authenticity and trust while information is stored or exchanged." ]
      ],
      terms: [
        ["Identification", "Claiming an identity to a system."],
        ["Authentication", "Verifying evidence that supports an identity claim."],
        ["Authorization", "Determining what an authenticated identity is allowed to do."],
        ["Accounting", "Recording relevant activity associated with identities and systems."],
        ["Authentication factor", "A category of evidence used to verify identity."],
        ["Multifactor authentication", "Authentication that uses evidence from more than one factor category."],
        ["Single sign on", "Using one authenticated session to access multiple approved services."],
        ["Federation", "A trust arrangement that allows identity information to be accepted across separate domains or organizations."],
        ["Least privilege", "Granting only the access required for an approved task."],
        ["Role based access", "An access model that assigns permissions according to defined roles."],
        ["Attribute based access", "An access model that evaluates attributes and policy conditions."],
        ["Encryption", "Transforming readable information into a protected form using cryptographic methods and keys."],
        ["Symmetric encryption", "Encryption that uses a shared secret key for encryption and decryption."],
        ["Asymmetric encryption", "Cryptography that uses a related public key and private key pair."],
        ["Hash", "A fixed length digest produced from input data by a one way cryptographic function."],
        ["Digital signature", "A cryptographic value used to verify integrity and association with a signing private key."],
        ["Digital certificate", "A signed data structure that binds identity information to a public key."],
        ["Public key infrastructure", "The people, processes and technology used to issue, manage and validate digital certificates and keys."],
        ["Key management", "The secure generation, storage, distribution, rotation, recovery and destruction of cryptographic keys." ]
      ],
      quiz: [
        {q:"What is identification?",a:["Claiming an identity","Proving every permission","Encrypting a file","Recording network traffic"],c:0},
        {q:"What is authentication?",a:["Verifying evidence for an identity claim","Choosing what an authenticated user may access","Assigning an internet address","Creating a backup"],c:0},
        {q:"What is authorization?",a:["Determining what an authenticated identity may do","Claiming a username","Hashing a password","Resolving a domain name"],c:0},
        {q:"Why are two passwords not true multifactor authentication?",a:["Both use the same factor category","Passwords can never be used for authentication","Multifactor authentication requires three factors","One password is always enough"],c:0},
        {q:"What does least privilege mean?",a:["Grant only the access needed for the approved task","Grant every permission after sign in","Remove all user access","Give administrators permanent access to everything"],c:0},
        {q:"What is the main difference between symmetric and asymmetric encryption?",a:["Symmetric uses a shared secret while asymmetric uses a public and private key pair","Symmetric has no key","Asymmetric cannot protect data","They are identical"],c:0},
        {q:"How is hashing different from encryption?",a:["Hashing normally produces a one way digest rather than reversible protected text","Hashing always uses a public key","Encryption never uses keys","They are the same process"],c:0},
        {q:"What does a digital signature help verify?",a:["Integrity and association with the signing private key","Only confidentiality","Only network speed","Only storage capacity"],c:0},
        {q:"What does a digital certificate bind?",a:["Identity information to a public key","A password to a router port","A subnet to a firewall rule","A backup to a recovery site"],c:0},
        {q:"Why is key management important?",a:["Strong cryptography can fail when keys are exposed, lost or poorly handled","Algorithms make key handling irrelevant","Keys should never be rotated","Public keys must always remain secret"],c:0}
      ]
    },

    M04: {
      title: "Alerts, Monitoring and Triage",
      summary: "Learn the difference between an event, an alert and an incident. Then learn how monitoring creates signals, how triage ranks them and how evidence raises or lowers confidence before anyone acts.",
      reading: [
        ["What PRIM3 gives you", "High Alert repeats the idea of staying alert. The PRIM3 mission matrix turns that idea into alert state, monitoring, evidence and professional judgment. The Blip adds a story example where several records are compared before confidence in an identity is restored."],
        ["Start with three different words", "An event is something that happened. An alert is a notification that an event or condition deserves attention. An incident is an event or group of events that has been evaluated and determined to require a response. Keeping these words separate prevents panic and keeps decisions grounded in evidence."],
        ["What monitoring actually does", "Monitoring repeatedly observes systems and conditions so unusual or important activity can be noticed. It may watch login activity, network connections, application errors, device health, physical access, temperature, power or human reports. Monitoring gives you observations. It does not automatically give you the correct explanation."],
        ["Telemetry is the raw material", "Telemetry is operational data produced by systems, devices, sensors and software. A router log, an identity sign in record, a server error, a badge event and a temperature reading can all be telemetry. Each source sees a different part of reality, so every source has limits."],
        ["Baselines, thresholds and anomalies", "A baseline describes what normal activity usually looks like. A threshold is a defined point that can trigger attention. An anomaly is something that differs from expected behavior. An anomaly can be important, harmless or simply new, so it still needs analysis."],
        ["Triage asks simple questions", "Good triage asks what happened, which source observed it, how reliable that source is, what could be affected and what action is justified next. Triage is not about solving everything immediately. It is about deciding what deserves attention first and what evidence should be collected next."],
        ["Impact and confidence are different", "Impact asks how serious the outcome could be. Confidence asks how strongly the available evidence supports the current explanation. A high impact possibility with weak evidence may still deserve attention, but the responder should clearly communicate that uncertainty instead of presenting a guess as fact."],
        ["Corroboration changes confidence", "Corroboration means checking whether independent evidence supports the same conclusion. If a badge event, a camera record and an identity log all point to the same time and person, confidence rises. If the records conflict, confidence should fall and the next step should be more verification."],
        ["False positives and false negatives", "A false positive is an alert that looks like a problem but is not. A false negative is a real problem that monitoring fails to identify. Strong monitoring programs try to reduce both, but neither can be eliminated completely. That is why human judgment and multiple sources matter."],
        ["The Blip as a monitoring example", "In The Blip, Jordan is not discovered for the first time. New college enrollment data is compared with an older identity profile and the system restores confidence in a relationship that already existed. The lesson is that one new record is not the whole answer. The value comes from correlation, context and confidence."],
        ["The beginner workflow", "For this module, remember five verbs: observe, compare, prioritize, verify and warn. Observe the signal. Compare it with other evidence. Prioritize based on possible impact and confidence. Verify what can be verified. Warn the right person when the evidence justifies escalation."],
        ["PRIM3 field practice", "The Signal or Noise lab gives several weak anomalies from cameras, access logs, environmental alarms and staff reports. Only some of them support each other strongly enough to justify immediate action. Your job is to recognize the difference between activity that is merely unusual and activity that becomes meaningful when evidence connects." ]
      ],
      terms: [
        ["Event", "An observable occurrence in a system or environment."],
        ["Alert", "A notification that a monitored condition deserves attention."],
        ["Incident", "An event or group of events that has been evaluated and determined to require response."],
        ["Monitoring", "Repeated observation of systems and conditions so important changes can be noticed."],
        ["Telemetry", "Operational data produced by systems, devices, sensors or software."],
        ["Baseline", "A reference for what normal activity usually looks like."],
        ["Threshold", "A defined point that can trigger attention or an alert."],
        ["Anomaly", "Activity that differs from an expected pattern or baseline."],
        ["Indicator", "An observation that may support a conclusion about activity or risk."],
        ["Triage", "The process of deciding what deserves attention first and what should be checked next."],
        ["Corroboration", "Independent evidence that supports or challenges a conclusion."],
        ["Confidence", "How strongly the available evidence supports a conclusion."],
        ["False positive", "An alert that appears to indicate a problem when no relevant problem exists."],
        ["False negative", "A real problem that monitoring does not identify." ]
      ],
      quiz: [
        {q:"What is an event?",a:["Anything observable that happened","A confirmed security incident only","A warning that always proves compromise","A final report"],c:0},
        {q:"What is an alert?",a:["A notification that a condition deserves attention","Proof that an attacker succeeded","A completed investigation","A recovery plan"],c:0},
        {q:"When does an event become an incident in this lesson?",a:["Whenever a log exists","After evaluation shows that response is required","Whenever a device restarts","When a user complains"],c:1},
        {q:"What is telemetry?",a:["Operational data from systems, devices, sensors or software","A theory with no source","Only video footage","Only network traffic"],c:0},
        {q:"What does a baseline describe?",a:["What normal activity usually looks like","The strongest possible attack","The final incident report","An authorization form"],c:0},
        {q:"Why is an anomaly not automatically an incident?",a:["Unusual activity can have harmless or unknown explanations","Anomalies never matter","Incidents do not create anomalies","Monitoring systems cannot detect anomalies"],c:0},
        {q:"What is the main purpose of triage?",a:["Rank what deserves attention and decide what to check next","Disable every affected system immediately","Delete low priority records","Prove attribution before collecting evidence"],c:0},
        {q:"What is the difference between impact and confidence?",a:["Impact is possible seriousness while confidence is strength of evidence","They mean exactly the same thing","Impact measures time while confidence measures cost","Confidence is always high when impact is high"],c:0},
        {q:"What usually raises confidence in a conclusion?",a:["Independent evidence that supports the same explanation","Repeating one uncertain source many times","Ignoring conflicting information","Choosing the most serious explanation"],c:0},
        {q:"What does The Blip demonstrate in this module?",a:["Several records can be compared to restore confidence in an existing identity relationship","One record should always be trusted without comparison","Monitoring should reveal every detail to every user","Identity data never needs context"],c:0}
      ]
    },

    M05: {
      title: "Scope, Authorization and Evidence",
      summary: "Learn how scope sets boundaries, how authorization gives permission, how evidence is preserved and why technical access never automatically means that a responder is allowed to search or collect everything they can reach.",
      reading: [
        ["What PRIM3 gives you", "High Alert directly references the scope of work, the choice to decline searches and the use of waivers and paper evidence. The PRIM3 mission matrix turns those lines into scope, evidence trail, search policy, access policy and professional judgment."],
        ["Scope answers what is included", "Scope defines the systems, accounts, locations, time periods, people and actions that are included in approved work. Clear scope also identifies exclusions. A responder should know not only what can be touched, but what must not be touched."],
        ["Authorization answers who may act", "Authorization is permission from a person or process with the authority to grant it. A technical ability is not the same thing as authorization. Being able to open a file, query a database or enter a room does not automatically mean that the action is approved."],
        ["Technical access is not permission", "Security tools can often see more information than one task requires. Professional work uses only the access needed for the approved purpose. When authority is unclear, the correct action is to stop at the boundary, preserve what can be preserved lawfully and ask for clarification."],
        ["Search and access policy matter", "Organizations define who may search systems, review records, enter spaces and collect information. Laws and contractual duties may also affect those decisions. A beginner does not need to memorize every rule at once. The first habit is simple: know the authority for the action before taking the action."],
        ["Evidence is information used to support a conclusion", "Evidence can include logs, messages, configuration records, camera footage, device records, photographs, notes and witness reports. Evidence is useful only when its meaning and origin can be explained. A pile of data without context can create more confusion than clarity."],
        ["Provenance tells you where evidence came from", "Provenance records the source and history of information. A useful evidence record answers where the information came from, when it was collected, who collected it and what happened to it afterward. Provenance helps later reviewers judge reliability."],
        ["Integrity means the evidence stays trustworthy", "Integrity means information remains complete and protected from unauthorized alteration. Evidence handling should reduce unnecessary changes and should document actions that could affect the record. This matters even when the incident will never become a legal case."],
        ["Preserve what matters before it disappears", "Many systems rotate logs, overwrite storage or change state during normal operation. Preservation means identifying relevant information and retaining it before routine activity removes it. Preservation is not the same as collecting everything. Good judgment balances relevance, authority, privacy, storage and time."],
        ["Least privilege and need to know", "Least privilege means giving a person or process only the access required for the approved task. Need to know limits sensitive information to people whose work actually requires it. These ideas reduce unnecessary exposure during investigations and response."],
        ["Document the decision trail", "A decision trail records what was observed, what was done, why it was done, what authority supported it and what result followed. Clear records make later review, learning and accountability possible."],
        ["The Blip as an evidence example", "The Blip depends on new institutional data being compared with an older identity record. The system should not treat the newest record as magic truth. A trustworthy conclusion depends on source history, comparison and confidence. This makes provenance part of the story, not just a paperwork concept."],
        ["PRIM3 field practice", "Safe Perimeter Under Uncertainty teaches that a boundary must protect people without creating a new hazard. Preserve the One Useful Detail teaches that collecting everything can waste time while deleting too aggressively can destroy the evidence that matters. Both labs reward controlled judgment instead of maximum access." ]
      ],
      terms: [
        ["Scope", "The defined boundary of approved work."],
        ["Authorization", "Permission from an appropriate authority to perform a defined action."],
        ["Access control", "Rules and mechanisms that determine who or what may use a resource."],
        ["Least privilege", "Giving only the access required for the approved task."],
        ["Need to know", "Limiting sensitive information to people whose work requires it."],
        ["Evidence", "Information used to support or challenge a conclusion."],
        ["Provenance", "The source and history of information or evidence."],
        ["Integrity", "The condition of information remaining complete and protected from unauthorized alteration."],
        ["Retention", "How long records or information are preserved."],
        ["Preservation", "Protecting relevant information from loss, change or routine deletion."],
        ["Decision trail", "A record of what was decided, why it was decided and what authority supported the action."],
        ["Escalation", "Passing a question or issue to a person or process with greater authority or responsibility." ]
      ],
      quiz: [
        {q:"What does scope define?",a:["The approved boundary of systems, people, locations, times and actions","Only the brand of security tool","The final identity of an attacker","The speed of a network"],c:0},
        {q:"What does authorization provide?",a:["Permission to perform a defined action","Automatic access to every system","Proof that an alert is true","A backup copy"],c:0},
        {q:"A tool can open a record that is outside your approved task. What should you conclude?",a:["Technical access does not automatically create permission","The record is automatically in scope","Every reachable record must be collected","Authorization is no longer needed"],c:0},
        {q:"Why does provenance matter?",a:["It explains where information came from and how it was handled","It makes every source equally reliable","It removes the need for timestamps","It replaces authorization"],c:0},
        {q:"What does evidence integrity protect against?",a:["Unauthorized alteration or unexplained change","Every false positive","All storage limits","Every human mistake"],c:0},
        {q:"Why might evidence need early preservation?",a:["Logs and system state can change or be overwritten","Preservation increases processor speed","It automatically proves intent","It eliminates the need for review"],c:0},
        {q:"What is least privilege?",a:["Providing only the access needed for the approved task","Providing every available permission","Giving no one any access","Allowing users to choose their own authority"],c:0},
        {q:"What is the purpose of a decision trail?",a:["Show what happened, why actions were taken and what authority supported them","Hide uncertainty","Replace technical evidence","Remove accountability"],c:0},
        {q:"What should happen when the authority for an action is unclear?",a:["Stop at the boundary and escalate the question","Assume permission","Delete the evidence","Expand the scope yourself"],c:0},
        {q:"What do the Episode One labs teach about evidence and access?",a:["Good response uses controlled boundaries and preserves relevant information without collecting everything","Maximum access is always the safest choice","Evidence matters only in court","Boundaries should never change when safety changes"],c:0}
      ]
    },

    M06: {
      title: "Monitoring Infrastructure and Incident Response",
      summary: "Build the technical picture underneath High Alert. Learn where monitoring data comes from, how records move into a central monitoring system, how correlation creates useful alerts and how responders move from detection through containment and recovery.",
      reading: [
        ["What this module adds", "High Alert gives the mnemonic and PRIM3 supplies the concepts of monitoring, evidence, scope and judgment. This module adds infrastructure that the song does not attempt to teach, including endpoint records, network telemetry, identity logs, centralized monitoring, time synchronization, correlation, case management and incident response workflow."],
        ["Think of monitoring as a path", "A useful monitoring system has several stages. Something happens. A device or service records it. That record is collected. The record is moved to a place where it can be searched. Different records are normalized and compared. A rule or analyst identifies something important. An alert is created. A responder investigates and records the result."],
        ["Endpoint telemetry", "Endpoints include laptops, desktops, servers and other computing devices. Useful records can include operating system events, process activity, service activity, security software findings and device health. Endpoint detection and response tools can add deeper visibility into behavior on managed devices."],
        ["Identity telemetry", "Identity systems can record sign in attempts, authentication results, multifactor prompts, password changes, account creation, role changes and unusual access patterns. Identity records are especially important because many incidents involve valid accounts being misused rather than a device simply being broken."],
        ["Network telemetry", "Routers, switches, firewalls, virtual private network services, wireless controllers, domain name services and address assignment services can all create useful records. Network telemetry helps answer who communicated, when communication happened, which path was used and whether a connection was allowed or blocked."],
        ["Application and cloud telemetry", "Applications may record user actions, errors, database activity and service requests. Cloud platforms may record administrative actions, resource changes, access events and service health. These records help connect user behavior with what happened inside an application or cloud environment."],
        ["Physical and environmental telemetry", "Cybersecurity investigations can also use badge records, cameras, power alarms, temperature sensors and other physical observations. Episode One deliberately mixes technical and human evidence because real operations often cross both worlds."],
        ["Collection and transport", "Records have to reach the monitoring platform. Some systems use software agents. Some send records with protocols such as Syslog. Some are queried through an application programming interface. The important beginner question is whether the data reaches the collection point reliably and whether the collection method preserves useful context."],
        ["Time must make sense", "Correlation becomes difficult when devices disagree about time. Time synchronization helps records from different systems line up. A responder should know the time zone, clock source and timestamp format used by important systems. Without reliable time, a correct event can appear to happen in the wrong order."],
        ["Normalization makes different records comparable", "Different products describe similar events in different formats. Normalization converts useful fields into a consistent structure so searches and rules can work across many sources. Normalization does not prove that an event is malicious. It simply makes analysis easier."],
        ["Correlation connects weak signals", "Correlation compares events from different sources or times to find a meaningful pattern. One failed sign in may be ordinary. Repeated failures followed by a successful sign in from a new location and a privileged role change may deserve much more attention. Correlation is the technical idea underneath the restored confidence shown in The Blip."],
        ["What a SIEM does", "A security information and event management platform can centralize records, support searches, apply detection rules, correlate events and create alerts. A SIEM does not replace judgment. It helps analysts organize and inspect evidence at a scale that would be difficult to manage manually."],
        ["Alerts need case management", "Once an alert deserves investigation, the organization needs a place to record ownership, status, evidence, actions and decisions. This may be a security case system, ticket system or incident platform. Good case records stop investigations from becoming undocumented conversations that nobody can reconstruct later."],
        ["From alert to incident response", "Current NIST guidance treats incident response as part of cybersecurity risk management rather than a separate emergency activity. For a beginner, use a practical sequence: prepare, detect, analyze, contain, remove the cause, recover and improve. The exact labels can vary, but disciplined response is always better than random action."],
        ["Containment, removal and recovery are different", "Containment limits spread or impact. Removing the cause addresses the condition that allowed the incident to continue. Recovery returns systems to a trusted operational state. A responder should not confuse making a symptom disappear with proving that the underlying problem is gone."],
        ["Protect incident records", "Modern incident guidance emphasizes preserving the integrity and provenance of incident data and response records. That means the organization should know where records came from, protect them from unauthorized change and limit sensitive response information to appropriate people."],
        ["CompTIA bridge", "This module supports current Security Plus study in Security Operations and current Network Plus study in monitoring and troubleshooting. The goal is not to turn one PRIM3 module into complete exam preparation. The goal is to make sure the mnemonic is attached to the real infrastructure and operational thinking those certifications expect."],
        ["The complete Episode One mental model", "High Alert gives you the memory hook. The Blip gives you a story about correlation and confidence. Signal or Noise teaches triage. Safe Perimeter Under Uncertainty teaches controlled boundaries. Preserve the One Useful Detail teaches evidence preservation. The infrastructure layer explains how real systems produce, move, compare and protect the records that make those decisions possible." ]
      ],
      terms: [
        ["Endpoint", "A computing device such as a workstation, laptop or server that participates in an environment."],
        ["Log source", "A system, device or service that produces recorded events."],
        ["Endpoint detection and response", "Technology that monitors managed endpoints and supports investigation and response."],
        ["Identity provider", "A service that manages user identity and authentication for other systems."],
        ["Network telemetry", "Operational records describing network activity, paths, connections or device state."],
        ["Agent", "Software installed on a system to collect or send operational information."],
        ["Syslog", "A common standard for sending event messages from systems and network devices."],
        ["Application programming interface", "A defined way for software systems to request data or actions from each other."],
        ["Time synchronization", "Keeping system clocks aligned so events from different sources can be compared accurately."],
        ["Normalization", "Converting different record formats into a consistent structure for analysis."],
        ["Correlation", "Relating multiple observations to identify a meaningful pattern."],
        ["Security information and event management", "A platform that centralizes security records and supports search, detection, correlation and alerting."],
        ["Case management", "The process and system used to track investigation ownership, evidence, actions and status."],
        ["Containment", "Limiting the spread or impact of an incident."],
        ["Recovery", "Returning systems and services to a trusted operational state." ]
      ],
      quiz: [
        {q:"Which statement best describes the monitoring path taught in this module?",a:["Systems create records, records are collected and compared, meaningful activity creates alerts and responders investigate","Alerts appear without any source data","Every log goes directly to recovery","Monitoring begins only after an incident is closed"],c:0},
        {q:"Which source is most likely to record authentication results and role changes?",a:["An identity system","A temperature sensor only","A printer tray","A display cable"],c:0},
        {q:"Why is network telemetry useful?",a:["It can help show communication paths, times and allowed or blocked connections","It always proves who typed a command","It replaces endpoint records","It eliminates false positives"],c:0},
        {q:"Why is time synchronization important?",a:["It helps records from different systems line up in the correct order","It makes storage larger","It authorizes searches","It turns events into incidents automatically"],c:0},
        {q:"What is normalization?",a:["Converting different record formats into a consistent structure","Deleting unusual events","Giving every user the same permissions","Restoring a failed system"],c:0},
        {q:"What is correlation?",a:["Comparing related observations to identify a meaningful pattern","Copying one alert many times","Collecting data with no analysis","Changing timestamps"],c:0},
        {q:"What does a security information and event management platform help do?",a:["Centralize records, search them, correlate events and create alerts","Replace every responder","Grant authorization for investigations","Repair hardware automatically"],c:0},
        {q:"What is the difference between containment and recovery?",a:["Containment limits spread or impact while recovery returns trusted service","They are exactly the same action","Containment happens only after recovery","Recovery means deleting all evidence"],c:0},
        {q:"Why should incident records preserve provenance and integrity?",a:["So responders can explain where information came from and trust that it was not changed without authorization","So every alert becomes public","So retention rules no longer matter","So responders can avoid documenting actions"],c:0},
        {q:"What is the role of the CompTIA bridge in this module?",a:["Connect the PRIM3 mnemonic to monitoring, troubleshooting and security operations knowledge","Claim the song is complete exam preparation","Replace the assessment","Remove the need for technical study"],c:0}
      ]
    },

    M07: {
      title: "White Grey Black Hat",
      summary: "Learn the security hat vocabulary as a question of authorization and intent. Keep that separate from how much internal information a tester receives about a target.",
      reading: [
        ["Hat colors describe behavior and authority", "White hat security work is authorized and performed for a legitimate defensive purpose. Grey hat activity may involve incomplete or ambiguous authorization. Black hat activity is malicious or unauthorized. The important distinction is the relationship between permission, intent and action."],
        ["Skill does not decide the hat", "Two people can know the same technical methods and still operate under completely different ethical and legal conditions. Capability describes what someone can do. Authorization describes what someone is permitted to do. Intent describes why the action is being taken."],
        ["White hat work starts with permission", "Professional testing should begin with clear authorization, defined scope, contacts, timing, reporting expectations and stop conditions. Permission must come from someone who actually has authority over the systems or assets being tested."],
        ["Grey areas are still risk", "A person may believe that finding a weakness helps an organization, but good intentions do not automatically create permission. When authorization is uncertain, the professional response is to stop, document what is already known and use an approved disclosure or communication path."],
        ["Black hat describes malicious or unauthorized conduct", "Black hat activity may involve theft, disruption, extortion, fraud, unauthorized access or other harmful behavior. The technical method alone does not define the category. Context, permission and intent matter."],
        ["Rules of engagement make permission operational", "Rules of engagement explain what may be tested, what must not be tested, when activity may occur, which methods are allowed, who must be notified and what conditions require work to stop. This prevents a broad permission statement from becoming uncontrolled activity."],
        ["Do not mix hats with boxes", "Hat vocabulary describes authorization and intent. Box vocabulary describes how much knowledge a tester receives about the target. A white hat tester can perform a black box assessment. The labels describe different dimensions." ]
      ],
      terms: [
        ["White hat", "Authorized security activity performed for a legitimate defensive purpose."],
        ["Grey hat", "Security activity where authorization may be incomplete, unclear or absent even when the actor claims a helpful purpose."],
        ["Black hat", "Malicious or unauthorized security activity."],
        ["Authorization", "Permission from an appropriate authority to perform a defined action."],
        ["Intent", "The purpose behind an action."],
        ["Scope", "The defined boundary of approved work."],
        ["Rules of engagement", "Written operational constraints for an authorized assessment."],
        ["Stop condition", "A defined situation that requires testing or assessment activity to pause or end." ]
      ],
      quiz: [
        {q:"What does hat color primarily describe?",a:["Authorization and intent","How much source code is provided","Network speed","The operating system"],c:0},
        {q:"What makes white hat testing legitimate?",a:["Appropriate authorization and defensive purpose","Using advanced tools","Keeping findings secret","Testing only at night"],c:0},
        {q:"Does technical capability automatically create permission?",a:["No","Yes","Only for administrators","Only for wireless systems"],c:0},
        {q:"Why are rules of engagement important?",a:["They turn authorization into clear operational boundaries","They remove the need for scope","They guarantee no incident can occur","They replace reporting"],c:0},
        {q:"What should happen when authorization is unclear?",a:["Stop at the boundary and use an approved path for clarification or disclosure","Assume permission","Expand the scope","Delete all notes"],c:0},
        {q:"What does black hat activity describe?",a:["Malicious or unauthorized activity","Any difficult technical work","Any black box assessment","Only malware development"],c:0},
        {q:"Can a white hat tester perform a black box assessment?",a:["Yes","No","Only with no scope","Only without authorization"],c:0},
        {q:"Why should hats and boxes be taught separately?",a:["They describe different dimensions of an assessment","They are identical concepts","Box colors describe intent","Hat colors describe source code access"],c:0},
        {q:"What is a stop condition?",a:["A defined situation that requires activity to pause or end","A vulnerability scanner","A password rule","A network address"],c:0},
        {q:"Which combination best describes professional security testing?",a:["Permission, scope, rules and documentation","Maximum access with no limits","Technical skill alone","Secrecy and speed"],c:0}
      ]
    },

    M08: {
      title: "White Grey Black Box",
      summary: "Learn box vocabulary as a question of target knowledge. White box, grey box and black box describe how much information or access is provided to the tester, not whether the tester is ethical.",
      reading: [
        ["Box colors answer a knowledge question", "Box terminology describes how much internal knowledge a tester receives before or during an assessment. It does not describe whether the testing is authorized. Authorization is handled separately through scope and rules of engagement."],
        ["White box provides substantial internal knowledge", "A white box assessment can include architecture diagrams, source code, credentials, configurations, documentation, system images or direct access to developers and administrators. This can support deep coverage and efficient review."],
        ["Black box provides little internal knowledge", "A black box assessment begins from an external or minimally informed perspective. The tester must discover more of the environment before deeper assessment can occur. This can help evaluate what an outside observer or attacker might encounter."],
        ["Grey box sits between the two", "A grey box assessment provides partial knowledge or limited credentials. It can represent a normal user, partner, contractor or another limited access perspective while still giving the tester enough context to focus the work."],
        ["More knowledge can increase depth", "When testers have source code, architecture details and configuration information, they can inspect internal trust decisions and implementation details that may be difficult to discover from outside."],
        ["Less knowledge can test exposure and discovery", "When testers begin with little information, the assessment can reveal what the environment exposes to a minimally informed observer. This may better exercise discovery, external controls and public attack surface awareness."],
        ["The assessment goal chooses the model", "No box model is automatically best. The organization should select the level of knowledge that matches the objective, available time, risk and desired coverage. A mature program may use more than one model at different times." ]
      ],
      terms: [
        ["White box", "An assessment with substantial internal knowledge or access."],
        ["Grey box", "An assessment with partial internal knowledge or limited access."],
        ["Black box", "An assessment with little or no internal knowledge."],
        ["Attack surface", "The reachable components and interfaces exposed to interaction."],
        ["Architecture review", "Reviewing system design and relationships to identify risk or weakness."],
        ["Source code review", "Reviewing application code to identify defects, unsafe assumptions or security weaknesses."],
        ["External perspective", "A view of a system from outside or with minimal internal knowledge." ]
      ],
      quiz: [
        {q:"What does box color primarily describe?",a:["How much target knowledge is provided","The tester's ethics","Incident severity","Team assignment"],c:0},
        {q:"Which assessment normally provides the most internal knowledge?",a:["White box","Black box","Grey box always","No box"],c:0},
        {q:"Which assessment begins with little or no internal knowledge?",a:["Black box","White box","Grey box always","Purple box"],c:0},
        {q:"What does grey box usually provide?",a:["Partial knowledge or limited access","Unlimited internal access","No scope","Automatic administrator rights"],c:0},
        {q:"Why can white box testing improve depth?",a:["Internal details can expose design and implementation weaknesses","It removes the need for authorization","It guarantees no false positives","It prevents all downtime"],c:0},
        {q:"Why can black box testing be useful?",a:["It can evaluate exposure from a minimally informed perspective","It guarantees complete source code coverage","It removes time limits","It replaces architecture review"],c:0},
        {q:"Does black box mean malicious?",a:["No","Yes","Only in cloud environments","Only on wireless networks"],c:0},
        {q:"Can an authorized tester use a black box approach?",a:["Yes","No","Only without rules","Only on public data"],c:0},
        {q:"What should determine the box model?",a:["Assessment objective, risk, time and desired coverage","The color of the security team","The tester's favorite tool","The operating system only"],c:0},
        {q:"Why keep hat and box vocabulary separate?",a:["Hat describes authorization and intent while box describes target knowledge","Both describe ethics","Both describe network layers","Both describe malware"],c:0}
      ]
    },

    M09: {
      title: "Penetration Testing Infrastructure, Scope and Remediation",
      summary: "Connect hats and boxes to the professional machinery that makes a security assessment useful. Learn target inventory, boundaries, findings, evidence, prioritization, remediation and verification.",
      reading: [
        ["Permission must become an operational plan", "A statement that testing is allowed is not enough. The assessment needs a target inventory, approved systems, excluded systems, time windows, emergency contacts, permitted methods, reporting rules and stop conditions."],
        ["Target inventory defines what exists in the assessment", "The inventory can include network ranges, hosts, applications, cloud resources, accounts, physical locations and supporting services. Owners should be identified so findings can reach people who can act on them."],
        ["Attack surface is an infrastructure map", "Endpoints, services, ports, identity systems, applications, network paths and cloud resources create different places where interaction can occur. Understanding architecture helps explain why a weakness exists and what a fix might affect."],
        ["Assessment evidence should support findings", "A finding should be based on enough evidence to explain the affected asset, observed condition, likely impact and reason for concern. Professional reporting separates confirmed evidence from assumptions and gives enough context for another person to understand the issue."],
        ["Prioritization connects technical findings to risk", "Not every weakness deserves the same urgency. Teams consider factors such as exploitability, exposure, asset value, business impact, compensating controls and available evidence when deciding which findings should be addressed first."],
        ["Remediation is the corrective work", "Remediation can involve configuration changes, patches, architecture changes, access changes, code fixes, compensating controls or removal of unnecessary services. The best fix addresses the cause while considering operational impact."],
        ["Retesting verifies the correction", "A finding is not complete simply because someone says it was fixed. Retesting checks whether the remediation actually resolved the weakness and whether the change created another problem."],
        ["Reporting closes the assessment loop", "A useful report explains scope, methods, limitations, findings, evidence, risk, remediation recommendations and unresolved questions. Different audiences may need different levels of detail, but the technical record should remain traceable."],
        ["Certification bridge", "Security Plus expects learners to understand authorization, assessment concepts, vulnerability management, security controls, reporting and remediation. Network Plus contributes the infrastructure knowledge needed to understand the systems being assessed. This module connects those certification ideas to the song without pretending the song contains the full professional process." ]
      ],
      terms: [
        ["Target inventory", "The defined list of assets included in an assessment."],
        ["Excluded asset", "A system or resource explicitly outside the approved assessment scope."],
        ["Attack surface", "The components and interfaces exposed to interaction."],
        ["Finding", "A documented issue supported by evidence."],
        ["Vulnerability management", "The lifecycle of identifying, prioritizing, remediating and validating weaknesses."],
        ["Remediation", "Corrective work that reduces or removes a weakness."],
        ["Compensating control", "An alternative safeguard used when the preferred control is not practical or available."],
        ["Retest", "Verification that a remediation resolved the reported weakness."],
        ["Assessment report", "A record of scope, methods, limitations, findings, evidence and recommended corrective work." ]
      ],
      quiz: [
        {q:"What turns broad permission into an operational assessment boundary?",a:["A target inventory and defined scope","A fast scanner","A public website","A team color"],c:0},
        {q:"What can a target inventory contain?",a:["Systems, applications, network ranges, accounts, cloud resources and other approved assets","Only usernames","Only physical devices","Only internet addresses"],c:0},
        {q:"What is an attack surface?",a:["The components and interfaces exposed to interaction","Only open network ports","A legal contract","A backup schedule"],c:0},
        {q:"What should support a professional finding?",a:["Evidence and enough context to explain the affected asset and concern","Rumor only","A tool name only","An assumption presented as fact"],c:0},
        {q:"Why are findings prioritized?",a:["Risk and operational context differ between findings","Every weakness has identical impact","Only the oldest finding matters","Prioritization replaces remediation"],c:0},
        {q:"What is remediation?",a:["Corrective work that reduces or removes a weakness","A second assessment target","A team role","A backup type"],c:0},
        {q:"What is a compensating control?",a:["An alternative safeguard used when the preferred control is not practical","A finding with no evidence","A permanent exception to every policy","An unauthorized test"],c:0},
        {q:"What is a retest?",a:["Verification that remediation resolved the reported weakness","A new unauthorized target","A second password","A duplicate report"],c:0},
        {q:"What should an assessment report explain?",a:["Scope, methods, limitations, findings, evidence and remediation guidance","Only tool output","Only successful tests","Only the tester's opinion"],c:0},
        {q:"Why does Network Plus knowledge matter in this module?",a:["It helps learners understand the infrastructure being assessed","It replaces authorization","It removes the need for evidence","It makes every finding critical"],c:0}
      ]
    }
  };

  (function validateAuthoredLessonCopy() {
    var forbidden = /[-\u2013\u2014]/;
    function walk(value, path) {
      if (typeof value === "string" && forbidden.test(value)) throw new Error("PRIM3 lesson copy contains forbidden dash punctuation at " + path);
      if (Array.isArray(value)) value.forEach(function (item, index) { walk(item, path + "." + index); });
      else if (value && typeof value === "object") Object.keys(value).forEach(function (key) { walk(value[key], path + "." + key); });
    }
    Object.keys(window.PRIM3_LESSONS).forEach(function (id) { walk(window.PRIM3_LESSONS[id], id); });
  })();
})();