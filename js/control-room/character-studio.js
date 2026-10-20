/* Character Studio is a native Control -> Create view.
   It neither exposes private character data to guests nor generates media,
   spends model credits, activates agents or publishes social posts. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var A = {
    request: null, rerender: null, getState: null, loading: false, loaded: false,
    busy: false, error: '', message: '', accounts: [], preview: null,
    previewInput: '',
    form: {
      display_name: '', handle: '', story_world: '', source_ip: '',
      story_country: '', editorial_mission: '', voice: '', desire: '',
      fear: '', contradiction: '', appearance_direction: '', content_pillars: ''
    }
  };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
  }); }
  function rerender() { if (A.rerender) A.rerender(); }
  function input(name, label, hint, type, required) {
    var val = A.form[name] || '', id = 'ccs-' + name;
    var attr = ' id="' + esc(id) + '" data-ccs-field="' + esc(name) + '"' +
      (required ? ' required' : '') + ' autocomplete="off" spellcheck="true"';
    var control = type === 'textarea'
      ? '<textarea class="ccs-textarea" rows="3"' + attr + '>' + esc(val) + '</textarea>'
      : '<input class="ccs-input" type="text" value="' + esc(val) + '"' + attr + '>';
    return '<label class="ccs-field" for="' + esc(id) + '"><span>' + esc(label) +
      (required ? ' <b aria-label="required">*</b>' : '') + '</span>' +
      control + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }
  function section(name, desc, inner) {
    return '<fieldset class="ccs-section"><legend>' + esc(name) + '</legend><p>' + esc(desc) + '</p>' + inner + '</fieldset>';
  }
  function preview() {
    var b = A.preview && A.preview.blueprint;
    if (!b) return '<div class="ccs-preview-empty"><strong>No compilation yet</strong><p>Describe the character and select Compile preview. This builds a consistent character bible without placing anything on the public network.</p></div>';
    var p = b.preview || {};
    return '<div class="ccs-preview-card"><div class="ccs-preview-kicker">DIGITAL PERFORMER · PRIVATE DRAFT</div>' +
      '<h3>' + esc(b.display_name) + '</h3><span class="ccs-handle">@' + esc(b.handle) + '</span>' +
      '<p>' + esc(p.social_bio) + '</p><div class="ccs-divider"></div>' +
      '<h4>Character tension</h4><p>' + esc(p.character_hook) + '</p>' +
      '<h4>Appearance direction</h4><p>' + esc(p.visual_brief) + '</p>' +
      '<h4>Voice</h4><p>' + esc(p.voice_direction) + '</p>' +
      '<h4>Content series</h4><ul>' + (p.content_series || []).map(function (x) { return '<li>' + esc(x.title) + '</li>'; }).join('') + '</ul>' +
      '<h4>Proposed first post</h4><p>' + esc(p.introductory_draft) + '</p>' +
      '<div class="ccs-guard"><strong>Locked at creation</strong><span> Fictional disclosure · Private · No agent runs · No spending · No synthetic voice or likeness · No publication</span></div></div>';
  }
  function roster() {
    if (A.loading || !A.loaded) return '<p class="ccs-muted">Reading private character workspace…</p>';
    if (A.error) return '<p class="ccs-error" role="status">' + esc(A.error) + '</p>';
    if (!A.accounts.length) return '<p class="ccs-muted">No saved characters. The first save will create a private record after the pending migration is applied.</p>';
    return '<ul class="ccs-roster">' + A.accounts.slice(0, 35).map(function (c) {
      return '<li><span><strong>' + esc(c.display_name) + '</strong><small>@' + esc(c.handle) +
        '</small></span><em>' + esc(c.account_status || 'draft') + '</em></li>';
    }).join('') + '</ul>';
  }
  function render() {
    var context = A.getState ? A.getState() : null;
    if (!context || !context.workspace || context.workspace.role !== 'owner' ||
        (context.org && context.org.slug && context.org.slug !== 'mccluster')) {
      return '<div class="cr-canvas ccs"><section class="ccs-preview"><h2>Character Studio is private</h2><p>Sign into the McCluster house owner workspace to design or inspect fictional digital performers.</p></section></div>';
    }
    return '<div class="cr-canvas ccs" id="ccsRoot">' +
      '<header class="ccs-intro"><div><span class="ccs-overline">CHARACTER STUDIO · PRIVATE ALPHA</span>' +
      '<h2>Build a character that stays in character.</h2>' +
      '<p>One identity across stories, performances and future social channels. Create the fictional persona first; likeness, agent execution and publication require their own approval.</p></div>' +
      '<div class="ccs-pipeline" aria-label="Creation stages"><span class="is-on">01 / Identity</span><span>02 / Psychology</span><span>03 / Production</span><span>04 / Review</span></div></header>' +
      '<div class="ccs-layout"><form id="ccsForm" class="ccs-form" novalidate>' +
      section('01 — Identity & world', 'A distinct story character, not a fabricated real member.',
        '<div class="ccs-grid">' +
        input('display_name','Character name','Original fictional name.', 'text', true) +
        input('handle','Character handle','3–32 characters. Saved handles are unique per studio.', 'text', true) +
        input('story_world','Story world','Original IP or the universe this studio controls.', 'text', true) +
        input('source_ip','Source IP / project','Claimed project only; licensing remains unverified.', 'text', false) +
        input('story_country','Story distribution country','Two-letter code, e.g. US. Not a residence or GPS location.', 'text', true) + '</div>') +
      section('02 — Narrative engine', 'The psychological rules that give the character continuity.',
        input('editorial_mission','Creative mission','What stories should this character explore?', 'textarea', true) +
        '<div class="ccs-grid">' +
        input('voice','Voice & manner','Distinctive speaking style and tone.', 'textarea', true) +
        input('desire','Core desire','What does the character pursue?', 'textarea', true) +
        input('fear','Core fear','What threatens them?', 'textarea', true) +
        input('contradiction','Internal contradiction','What makes their decisions unpredictable?', 'textarea', true) + '</div>') +
      section('03 — Art direction & programming', 'Text design only in v1; no image, voice or video is generated.',
        input('appearance_direction','Appearance & wardrobe','Describe original visual cues. Do not upload unlicensed likenesses.', 'textarea', false) +
        input('content_pillars','Content series','Separate one to four content topics with commas.', 'text', false)) +
      '<div class="ccs-actions"><button type="button" class="cr-btn cr-btn--primary" data-ccs-preview' + (A.busy ? ' disabled' : '') + '>Compile private preview</button>' +
      '<button type="button" class="cr-btn cr-btn--ghost" data-ccs-save' +
      (A.busy || !A.preview || A.previewInput !== JSON.stringify(A.form) ? ' disabled' : '') + '>Save as draft</button></div>' +
      '<p class="ccs-result" role="status" aria-live="polite">' + esc(A.message || 'Nothing is published, billed, or activated.') + '</p></form>' +
      '<aside class="ccs-aside"><section class="ccs-preview"><header><h2>Character bible</h2><span>VERSION 1</span></header>' + preview() + '</section>' +
      '<section class="ccs-library"><header><h2>House characters</h2><span>' + esc(A.accounts.length) + ' saved</span></header>' +
      roster() + '</section></aside></div></div>';
  }
  function readBrief() {
    var b = {};
    Object.keys(A.form).forEach(function (key) {
      if (key === 'content_pillars') {
        var entries = A.form[key].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (entries.length) b.content_pillars = entries;
      } else {
        b[key] = A.form[key];
      }
    });
    return b;
  }
  function load() {
    if (A.loading || A.loaded || !A.request) return;
    A.loading = true;
    return A.request('/v1/house-agents/owner').then(function (data) {
      A.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      A.error = '';
    }).catch(function (e) {
      A.error = (e.status === 503)
        ? 'Character storage is still pending staging migration. Preview is available to owners; saving is not yet operational.'
        : (e.message || 'Private roster unavailable');
    }).finally(function () { A.loading = false; A.loaded = true; rerender(); });
  }
  function run(button, path, onSuccess) {
    if (A.busy || !A.request) return;
    A.busy = true;
    A.message = 'Validating private character…';
    button.disabled = true;
    A.request(path, { method:'POST', body: readBrief() }).then(function (data) {
      onSuccess(data);
    }).catch(function (e) {
      A.message = e.message || 'Character operation failed';
    }).finally(function () { A.busy = false; rerender(); });
  }
  function bind(root) {
    var form = root && root.querySelector('#ccsForm');
    if (!form) return;
    if (!A.loaded && !A.loading) Promise.resolve().then(load);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.querySelectorAll('[data-ccs-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        A.form[input.dataset.ccsField] = input.value;
        A.preview = null; A.previewInput = '';
        var save = form.querySelector('[data-ccs-save]');
        if (save) save.disabled = true;
      });
    });
    var compile = form.querySelector('[data-ccs-preview]');
    if (compile) compile.onclick = function () {
      var briefFingerprint = JSON.stringify(A.form);
      run(compile, '/v1/house-agents/owner/characters/preview', function (data) {
        if (JSON.stringify(A.form) !== briefFingerprint) {
          A.message = 'The brief changed during compilation; compile again.';
          return;
        }
        A.preview = data; A.previewInput = briefFingerprint;
        A.message = 'Private blueprint compiled. Review it, then save as a draft.';
      });
    };
    var save = form.querySelector('[data-ccs-save]');
    if (save) save.onclick = function () {
      if (!A.preview || A.previewInput !== JSON.stringify(A.form)) return;
      run(save, '/v1/house-agents/owner/characters', function (data) {
        A.message = 'Draft saved as version 1. No public character, agent or social post has been activated.';
        A.preview = null; A.previewInput = '';
        A.loaded = false; load();
      });
    };
  }
  window.CR.characterStudio = {
    init: function (opts) { A.request = opts.request; A.rerender = opts.render; A.getState = opts.getState; },
    render: render, bind: bind, load: load, state: A
  };
})();
