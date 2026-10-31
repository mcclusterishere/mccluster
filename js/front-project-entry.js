/* Presentation only: reuse the first film and existing title/links, without a
   preceding static stage. No identity, publishing or media permissions here. */
(function (w, d) {
  'use strict';
  var intro = null;
  w.MCC_PROJECT_ENTRY = Object.freeze({
    mount: function (project) {
      var profile = { name: project.name, home: project.home, logo: project.logo };
      w.MCC_PAGE_PROFILE = profile;
      if (w.MCC_BAR && w.MCC_BAR.pageProfile) w.MCC_BAR.pageProfile(profile);
      if (project.entry !== 'scene') return;
      var hero = d.getElementById('hero'), stage = d.querySelector('#work .command__sticky');
      intro = d.querySelector('.hero__content');
      if (!hero || !stage || !intro) return;
      d.documentElement.setAttribute('data-front-entry', 'scene');
      intro.classList.add('scene-intro');
      intro.removeAttribute('data-drift');
      stage.appendChild(intro);
      hero.hidden = true;
      // #hero remains a compatible name for the opening scene, not a hidden target.
      hero.removeAttribute('id');
      var anchor = d.createElement('span'); anchor.id = 'hero'; anchor.className = 'scene-entry-anchor';
      d.getElementById('work').prepend(anchor);
    },
    update: function (progress) {
      if (!intro) return;
      // Clear the runway before its takeoff rail and cabin; Back restores it.
      intro.hidden = progress >= 0.14;
    }
  });
})(window, document);
