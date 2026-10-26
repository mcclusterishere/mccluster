/* A choice of setup guidance, not a purchase, permission grant or saved profile mutation. */
(function () {
  'use strict';
  var paths = {
    artist: { title: 'A home for your portfolio and releases.', steps: ['Make your profile recognizable.', 'Build your page with your media and links.', 'Add music, then review your selling and domain options.'], link: 'creator.html', label: 'Open music studio' },
    business: { title: 'A home for your business and customers.', steps: ['Introduce your business and what it offers.', 'Build your page with your work and contact links.', 'Review seller setup, your site plan, and domain options.'], link: 'customer-commerce.html', label: 'Review plans & seller setup' },
    project: { title: 'A home for your next project.', steps: ['Introduce the people and purpose behind your project.', 'Create a managed page with its own media and updates.', 'Build an audience through World; project backing is not yet available.'], link: 'customer-projects.html', label: 'Manage project pages' }
  };
  function select(key) {
    var path = paths[key]; if (!path) return;
    var root = document.getElementById('sitePath'); root.replaceChildren();
    var heading = document.createElement('h3'); heading.textContent = path.title; root.appendChild(heading);
    var list = document.createElement('ol');
    path.steps.forEach(function (text) { var item = document.createElement('li'); item.textContent = text; list.appendChild(item); }); root.appendChild(list);
    var link = document.getElementById('siteCompanion'); link.href = path.link; link.textContent = path.label;
    document.querySelectorAll('[data-site]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.site === key)); });
    var url = new URL(location.href); url.searchParams.set('site', key); history.replaceState(null, '', url);
  }
  document.querySelectorAll('[data-site]').forEach(function (button) { button.addEventListener('click', function () { select(button.dataset.site); }); });
  var key = new URLSearchParams(location.search).get('site'); if (paths[key]) select(key);
}());
