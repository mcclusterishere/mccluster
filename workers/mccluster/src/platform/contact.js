/* McCluster Corp's own address, as Worker mccluster names its sender to the services it calls (the User-Agent contact
   of every outbound read, the referer the routing provider asks for, the subject of a Web Push signature).

   It is the Organization's url in the generated table (./hosts.generated.js ENTITY_URLS.organization, from
   data/seo/domain-architecture.json -> entities.mccluster_corp.url), not the platform's origin: when the platform moves
   to another origin (stage F, SPEC-PLATFORM 2.10) the company keeps its own address. */
import { ENTITY_URLS } from './hosts.generated.js';

export const CONTACT_URL = ENTITY_URLS.organization;
export const CONTACT_ORIGIN = new URL(CONTACT_URL).origin;
