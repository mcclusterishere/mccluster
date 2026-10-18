(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var project = params.get('project') || 'docket-516r-2025';
  var slug = params.get('person');
  var status = document.getElementById('profileStatus');
  async function load() {
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug) || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(project)) {
      status.textContent = 'This profile link is invalid.'; return;
    }
    var archive;
    try {
      var result = await fetch('https://api.mccluster.org/v1/action-archive/' + encodeURIComponent(project), { signal: AbortSignal.timeout(10000) });
      if (result.status === 403 || result.status === 404) { status.textContent = 'This cohort profile is unavailable.'; return; }
      if (!result.ok) throw new Error('Archive unavailable');
      archive = await result.json();
    } catch (_) {
      if (project !== 'docket-516r-2025') { status.textContent = 'This cohort profile is unavailable.'; return; }
      var fallback = await fetch('data/action/docket-516r-archive.json', { signal: AbortSignal.timeout(10000) });
      if (!fallback.ok) { status.textContent = 'This cohort profile is unavailable.'; return; }
      archive = await fallback.json();
    }
    var person = (archive.participants || []).find(function (item) { return item.slug === slug; });
    if (!person) { status.textContent = 'This cohort profile was not found.'; return; }
    document.title = person.display_name + ' · Equity Uprise';
    document.getElementById('profileName').textContent = person.display_name;
    document.getElementById('profileRoles').textContent = (person.project_roles || person.roles || []).join(' · ');
    document.getElementById('profileBio').textContent = person.bio || 'Contributed to Write the Change with the Equity Uprise cohort.';
    document.getElementById('providerPage').href = 'docket-516r-cohort.html?person=' + encodeURIComponent(slug);
    document.getElementById('providerPage').hidden = Object.prototype.hasOwnProperty.call(person, 'provider_page') && person.provider_page === null;
    var claimed = person.claim_status === 'claimed';
    document.getElementById('profileClaimState').textContent = claimed ? 'Connected to the participant’s M Account.' : 'This cohort profile is ready for its participant to claim using a private invitation.';
    if (claimed && /^[a-f0-9-]{36}$/i.test(person.owner_m_uid || '')) {
      var account = document.getElementById('accountProfile');
      account.href = 'mccluster-creator.html?id=' + encodeURIComponent(person.owner_m_uid);
      account.hidden = false;
    }
    var works = (archive.works || []).filter(function (work) { return (work.credits || []).some(function (credit) { return credit.participant_slug === slug; }); });
    var list = document.getElementById('profileWorks');
    works.forEach(function (work) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = 'docket-516r-cohort.html#' + encodeURIComponent(work.id || work.slug);
      link.textContent = work.title;
      var credit = document.createElement('span');
      credit.textContent = work.credits.filter(function (row) { return row.participant_slug === slug; }).map(function (row) { return row.role; }).join(' · ');
      item.append(link, credit); list.append(item);
    });
    if (!works.length) {
      var item = document.createElement('li');
      item.textContent = 'Cohort participation is recorded. Individual song credits will appear here as they are confirmed.';
      list.append(item);
    }
    document.getElementById('cohortProfile').hidden = false;
    status.hidden = true;
  }
  load().catch(function () { status.textContent = 'This cohort profile could not load. Please try again.'; });
})();
