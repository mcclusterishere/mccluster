/* ============================================================
   request.cf, without Cloudflare.

   src/entry.js reads request.cf for country, city, region, postal,
   lat/lon and ASN, and feeds them into /v1/collect. On Cloudflare that
   arrives free with the request. Here it is a MaxMind GeoLite2 lookup --
   a database file on our own disk, which is strictly more independent
   than an edge field we were handed.

   IT DEGRADES RATHER THAN GUESSES. With no database present every field
   is null. That is deliberate: null reads as "we do not know" downstream,
   whereas a plausible-looking wrong country silently poisons the
   analytics and nobody notices, because there is nothing to notice.

   Get the free database (no cost, account required):
     https://dev.maxmind.com/geoip/geolite2-free-geolocation-data
   then point GEOIP_CITY_DB at the .mmdb and restart.
   ============================================================ */
import { existsSync } from 'node:fs';

const CITY_DB = process.env.GEOIP_CITY_DB || '/var/lib/mccluster/geoip/GeoLite2-City.mmdb';
const ASN_DB  = process.env.GEOIP_ASN_DB  || '/var/lib/mccluster/geoip/GeoLite2-ASN.mmdb';

const EMPTY = {
  country: null, city: null, region: null, regionCode: null, postalCode: null,
  latitude: null, longitude: null, timezone: null, asn: null, asOrganization: null,
  colo: null, httpProtocol: null,
};

let city = null, asn = null, warned = false;
try {
  // Optional dependency on purpose: the API must boot and serve without
  // it, just without geo. A hard import would make a nice-to-have fatal.
  const { Reader } = await import('maxmind');
  if (existsSync(CITY_DB)) city = await Reader.open(CITY_DB);
  if (existsSync(ASN_DB))  asn  = await Reader.open(ASN_DB);
} catch {
  /* maxmind not installed -- handled by the warning below */
}

if (!city && !warned) {
  warned = true;
  console.warn('geo: no GeoLite2 database loaded; request.cf fields will be null. '
             + 'Set GEOIP_CITY_DB and install the `maxmind` package to enable.');
}

export function lookupGeo(ip) {
  if (!ip || !city) return { ...EMPTY };
  try {
    const c = city.get(ip);
    const a = asn ? asn.get(ip) : null;
    if (!c) return { ...EMPTY };
    const sub = c.subdivisions?.[0];
    return {
      ...EMPTY,
      country: c.country?.iso_code ?? null,
      city: c.city?.names?.en ?? null,
      region: sub?.names?.en ?? null,
      regionCode: sub?.iso_code ?? null,
      postalCode: c.postal?.code ?? null,
      latitude: c.location?.latitude != null ? String(c.location.latitude) : null,
      longitude: c.location?.longitude != null ? String(c.location.longitude) : null,
      timezone: c.location?.time_zone ?? null,
      asn: a?.autonomous_system_number ?? null,
      asOrganization: a?.autonomous_system_organization ?? null,
    };
  } catch { return { ...EMPTY }; }
}
