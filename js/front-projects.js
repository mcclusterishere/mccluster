/* Repository-managed creator projects. These are page content, never accounts or permissions.
   Reuses front.html and main.js; member uploads still use the Worker's original folder policy. */
(function (w) {
  'use strict';
  var projects = {
    vaunt: {
      attribution: 'Independent creator portfolio; not an official Vaunt company account or an endorsed partnership.',
      handle: 'vaunt', name: 'Vaunt', owner: 'Matthew McCluster', ownerHref: 'matthew-mccluster.html',
      config: {
        scenes: { doors: true, vaunt: true, night: false, world: true },
        words: {
          eyebrow: 'An independent creator project by Matthew McCluster', title1: 'VAUNT', title2: '',
          sub: 'Film · 360 · Music',
          door1: { label: 'Enter the runway experience', href: '#work' },
          door2: { label: 'Listen to Vaunt EP', href: 'album.html?album=vaunt-ep' },
          gateKicker: 'Vaunt · inside the jet', gateTitle: 'Blurred until you allow it.',
          gateLede: 'Real 360 footage, shot inside the jet. It takes the page and your thumb while it plays, so it does not start until you say so.',
          cabinTag: 'Inside the jet · 360 · live footage'
        },
        links: [
          { label: 'Listen to Vaunt EP', href: 'album.html?album=vaunt-ep' },
          { label: 'Matthew’s portfolio', href: 'index.html#work' },
          { label: 'Open the standalone 360 cabin', href: 'vr-vaunt.html' }
        ],
        vr: { enabled: true, hold: true, band: [0.40, 0.50], yaw: -140, pitch: -32, spots: [
          { yaw: -77, pitch: -13, label: 'The cockpit · fly with Vaunt', href: 'https://vauntapi.flyvaunt.com/referral/nuao1K', blank: true },
          { yaw: 131, pitch: -29, label: 'Get to the bag', href: 'hire.html', urgent: true },
          { yaw: -140, pitch: -40, label: 'McCluster · the résumé', href: 'matthew-mccluster.html' }
        ] },
        media: {
          scene1: { base: 'assets/frames/', prefix: 'vauntlive_', count: 161, ext: 'webp', sm: true },
          scene2: { base: 'assets/frames/', prefix: 'vaunt_', count: 161, ext: 'webp', sm: true },
          cabin: { kind: 'video', src: 'assets/video/vaunt-360.mp4', poster: 'assets/img/vaunt-360-poster.jpg' },
          still: { src: 'assets/frames/vauntlive_0001.jpg' },
          sound: { src: 'assets/audio/who-did-the-shoot.mp3' }
        }
      }
    }
  };
  function freeze(x) { Object.keys(x).forEach(function (k) { if (x[k] && typeof x[k] === 'object') freeze(x[k]); }); return Object.freeze(x); }
  freeze(projects);
  w.MCC_FRONT_PROJECTS = Object.freeze({ get: function (slug) { return Object.prototype.hasOwnProperty.call(projects, slug) ? projects[slug] : null; } });
})(window);
