/* The shared editor reads this routing adapter; it never rewrites the account's member-front row. */
(function () {
  var slug = new URLSearchParams(location.search).get('project') || '';
  window.__MCC_PROJECT_STUDIO_SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) ? slug : null;
  window.__MCC_PROJECT_STUDIO = true;
})();
