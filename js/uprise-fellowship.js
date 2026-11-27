/* The fellowship landing (uprise-fellowship.html) and the 2026 cohort page
 * (equity-uprise-cohort-2026.html). Progressive enhancement only: both pages
 * are complete without this file. It (1) reveals sections as they scroll in,
 * unless the visitor prefers reduced motion; (2) re-checks the Cohort 1
 * counts against data/action/docket-516r-archive.json, so the page can never
 * print a number the archive does not stand behind; (3) paints the 2026
 * cohort from data/action/equity-uprise-2026-cohort.json, including how many
 * days are left before it forms. No network call leaves this site. */
(function () {
  'use strict';
  var doc = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    doc.classList.add('uf-js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.uf-reveal').forEach(function (el) { io.observe(el); });
  }

  function json(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function text(sel, value) {
    document.querySelectorAll(sel).forEach(function (el) { if (value != null && value !== '') el.textContent = String(value); });
  }

  json('data/action/docket-516r-archive.json').then(function (a) {
    if (!a) return;
    text('[data-uf-count="participants"]', (a.participants || []).length);
    text('[data-uf-count="works"]', (a.works || []).length);
    if (a.project && a.project.summary) text('[data-uf-summary]', a.project.summary);
    if (a.event && a.event.public_title) text('[data-uf-event-title]', a.event.public_title);
    var list = document.getElementById('ufSongs');
    if (list && Array.isArray(a.works) && a.works.length) {
      var order = (a.event && a.event.work_ids) || [];
      var works = a.works.slice().sort(function (x, y) { return order.indexOf(x.id || x.slug) - order.indexOf(y.id || y.slug); });
      list.textContent = '';
      works.forEach(function (w) { var li = document.createElement('li'); li.textContent = w.title; list.appendChild(li); });
    }
  });

  json('data/action/equity-uprise-2026-cohort.json').then(function (c) {
    if (!c || !c.cohort) return;
    var forms = c.cohort.forms_by ? new Date(c.cohort.forms_by + 'T23:59:59-05:00') : null;
    var days = forms ? Math.ceil((forms - Date.now()) / 86400000) : null;
    var el = document.querySelector('[data-uf-days]');
    if (el && days != null && days >= 0) {
      el.hidden = false;
      el.textContent = days === 0 ? 'Today' : days + (days === 1 ? ' day' : ' days');
      text('[data-uf-days-label]', 'left before the 2026 cohort forms on December 31, 2026.');
    }
    var members = Array.isArray(c.fellows) ? c.fellows : [];
    var roster = document.getElementById('ufRoster');
    if (roster) {
      roster.textContent = '';
      if (!members.length) {
        var p = document.createElement('p'); p.className = 'uf-muted';
        p.textContent = 'No fellows are announced yet. Fellows are listed here after they accept their invitation and finish onboarding.';
        roster.appendChild(p);
      } else {
        var ul = document.createElement('ul'); ul.className = 'uf-roles';
        members.forEach(function (m) { var li = document.createElement('li'); li.textContent = m.display_name; ul.appendChild(li); });
        roster.appendChild(ul);
      }
    }
  });
})();
