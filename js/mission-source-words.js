/* THE WORDS A MISSION SOURCE'S PAGE NEVER USES (docs/control-plane/WORLD-MISSION-SOURCES.md, D1; AGENTS.md, two entities and
   the emblem rule). A source credits where a catalog of missions was written from: it is never shown as this platform's
   sponsor, partner, funder, author, operator or endorser, never as a recommendation, and never in account words.
   One list, used three ways: the World's source page (js/world-source-profile.js) refuses to draw a source whose name, role
   line or facts match it; the Control Room's card (js/control-room/mission-sources.js) says so before a save; and the pending
   SQL (supabase/pending/20261119140000_mission_catalog_sources_v1.sql, mission_catalog_sources_words_check) refuses the same
   words in the stored role line and facts. scripts/test/mission-catalog-sources-sql.test.mjs holds the SQL pattern equal to
   pgPattern() below. Entries are lower case: prefix = matched at the start of a word (sponsor, sponsored, sponsorship);
   word = the whole word only; phrase = the words in order, any spacing between them. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MCC_SOURCE_WORDS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var DENY = Object.freeze([
    ['sponsor', 'prefix'], ['partner', 'prefix'], ['benefactor', 'prefix'], ['endors', 'prefix'], ['official', 'prefix'],
    ['verified', 'prefix'], ['certified', 'prefix'], ['accredit', 'prefix'], ['recommend', 'prefix'], ['worthwhile', 'prefix'],
    ['affiliat', 'prefix'], ['collaborat', 'prefix'], ['account', 'prefix'], ['follow', 'prefix'], ['message', 'prefix'],
    ['claim', 'prefix'],
    ['paid', 'word'], ['fund', 'word'], ['funds', 'word'], ['funded', 'word'], ['funder', 'word'], ['funders', 'word'],
    ['funding', 'word'],
    ['keep watching', 'phrase'], ['in association', 'phrase'], ['on behalf', 'phrase'], ['supported by', 'phrase'],
    ['powered by', 'phrase'], ['presented by', 'phrase'], ['approved by', 'phrase'], ['authorized by', 'phrase'],
    ['authorised by', 'phrase'], ['created by', 'phrase'], ['posted by', 'phrase'], ['by project drawdown', 'phrase'],
    ['equity uprise', 'phrase'], ['human uprise', 'phrase'], ['missions from this source', 'phrase']
  ].map(function (e) { return Object.freeze(e); }));
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  /* PostgreSQL ARE: \m is the start of a word, \M its end; one or more spaces between a phrase's words */
  function pgPattern() {
    return '(' + DENY.map(function (e) {
      var w = e[0].split(' ').join('[[:space:]]+');
      return e[1] === 'word' ? '\\m' + w + '\\M' : '\\m' + w;
    }).join('|') + ')';
  }
  /* JavaScript, for any browser the World supports (no lookbehind): the same words on lower-cased text */
  var JS = new RegExp(DENY.map(function (e) {
    var w = e[0].split(' ').map(esc).join('\\s+');
    return '(?:^|[^a-z0-9_])' + w + (e[1] === 'word' ? '(?![a-z0-9_])' : '');
  }).join('|'));
  function denied(text) { return JS.test(String(text == null ? '' : text).toLowerCase()); }
  return Object.freeze({ DENY: DENY, pgPattern: pgPattern, denied: denied });
});
