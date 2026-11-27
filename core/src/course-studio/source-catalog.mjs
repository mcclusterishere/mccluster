// Shared public catalog. All other course data stays private. Keep this module
// free of Node or Worker dependencies so both releases can consume it.
export const COURSE_STUDIO_SOURCES = Object.freeze([
  Object.freeze({
    topic: 'algebra',
    title: 'Active Prelude to Calculus, §1.4: Linear Functions',
    url: 'https://activecalculus.org/prelude/sec-changing-linear.html',
    attribution: 'Matthew Boelkins with Christina Safranski · Active Calculus',
    license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  }),
  Object.freeze({
    topic: 'calculus',
    title: 'Active Calculus, §2.1: Elementary Derivative Rules',
    url: 'https://activecalculus.org/single/sec-2-1-elem-rules.html',
    attribution: 'Matthew Boelkins with David Austin, Christina Safranski and Steven Schlicker · Active Calculus',
    license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  }),
  Object.freeze({
    topic: 'chemistry',
    title: 'Isotopes: Composition of an Atom',
    url: 'https://gml.noaa.gov/outreach/isotopes/chemistry.html',
    attribution: 'National Oceanic and Atmospheric Administration · Global Monitoring Laboratory',
    license: 'U.S. public domain (NOAA text)', license_url: 'https://gml.noaa.gov/about/disclaimer.html',
  }),
]);
