/* Explicit, revocable coarse World-region sharing for account.html.
   This is intentionally separate from private profile/contact data and from mission-eligibility region records. */
(function (root) {
  'use strict';
  var opened = false, countries = null;
  var $ = function (id) { return document.getElementById(id); };
  function supa() {
    if (!root.MCC_SUPA || !MCC_SUPA.url || !MCC_SUPA.key || !MCC_SUPA.token) throw new Error('Account session is unavailable.');
    return MCC_SUPA;
  }
  function rpc(name, args) {
    var s = supa();
    return s.token().then(function (token) {
      if (!token) throw new Error('Sign in again to change this setting.');
      return fetch(s.url + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: { apikey: s.key, authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(args || {})
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
          if (!res.ok) throw new Error(data && data.message || 'That setting did not save.');
          return data;
        });
      });
    });
  }
  function setMessage(text) { if ($('worldRegionMsg')) $('worldRegionMsg').textContent = text || ''; }
  function setEnabled(on) {
    var fields = $('worldRegionFields');
    if (fields) fields.hidden = !on;
    if ($('worldRegionCountry')) $('worldRegionCountry').disabled = !on;
    if ($('worldRegionSubdivision')) $('worldRegionSubdivision').disabled = !on;
  }
  function fillCountries() {
    if (countries) return Promise.resolve(countries);
    return fetch('data/geo/country-label-points.json', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('Country list is unavailable.');
      return r.json();
    }).then(function (data) {
      countries = Object.keys(data && data.points || {}).map(function (code) {
        var row = data.points[code]; return { code: code, name: row && row[2] || code };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var select = $('worldRegionCountry'), current = select.value;
      select.innerHTML = '<option value="">Choose a country</option>' + countries.map(function (c) {
        return '<option value="' + c.code + '">' + String(c.name).replace(/[&<>"]/g, function (x) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[x]; }) + '</option>';
      }).join('');
      select.value = current;
      return countries;
    });
  }
  function fillSubdivisions(country, selected) {
    var select = $('worldRegionSubdivision');
    select.innerHTML = '<option value="">Whole country</option>';
    if (!country) { select.disabled = true; return Promise.resolve(); }
    return fetch('data/geo/world-state-areas/' + country + '.json', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      var states = data && Array.isArray(data.states) ? data.states : [];
      states.sort(function (a, b) { return String(a.properties && a.properties.name || '').localeCompare(String(b.properties && b.properties.name || '')); });
      states.forEach(function (state) {
        var p = state.properties || {}, opt = document.createElement('option');
        opt.value = p.key || ''; opt.textContent = p.name || p.key || ''; select.appendChild(opt);
      });
      select.disabled = !$('worldRegionShare').checked;
      select.value = selected && Array.from(select.options).some(function (o) { return o.value === selected; }) ? selected : '';
    }).catch(function () { select.disabled = !$('worldRegionShare').checked; });
  }
  function paint(row) {
    row = Array.isArray(row) ? row[0] : row;
    var on = !!(row && row.country_code);
    $('worldRegionShare').checked = on; setEnabled(on);
    return fillCountries().then(function () {
      $('worldRegionCountry').value = on ? row.country_code : '';
      return fillSubdivisions(on ? row.country_code : '', on ? row.subdivision_code : '');
    });
  }
  function load() {
    setMessage('Loading…');
    return rpc('world_region_sharing_get', {}).then(function (row) {
      setMessage(''); return paint(row);
    }).catch(function (e) { setMessage(e.message || 'Could not load this setting.'); });
  }
  function save() {
    var button = $('worldRegionSave'), on = $('worldRegionShare').checked;
    button.disabled = true; setMessage(on ? 'Saving…' : 'Withdrawing…');
    var work;
    if (!on) work = rpc('world_region_sharing_clear', {});
    else {
      var country = $('worldRegionCountry').value, subdivision = $('worldRegionSubdivision').value || null;
      if (!/^[A-Z]{2}$/.test(country)) { button.disabled = false; setMessage('Choose a country first.'); return; }
      work = rpc('world_region_sharing_set', { p_country_code: country, p_subdivision_code: subdivision });
    }
    work.then(function () { setMessage(on ? 'Shared. Only this coarse region can contribute to public counts.' : 'Region sharing is off. You are no longer included in World member counts.'); return load(); })
      .catch(function (e) { setMessage(e.message || 'That setting did not save.'); })
      .then(function () { button.disabled = false; });
  }
  function open() {
    if (!$('worldRegionCard')) return;
    $('worldRegionCard').hidden = false;
    if (!opened) {
      opened = true;
      $('worldRegionShare').addEventListener('change', function () {
        setEnabled(this.checked);
        if (this.checked) fillCountries().then(function () { return fillSubdivisions($('worldRegionCountry').value, ''); });
      });
      $('worldRegionCountry').addEventListener('change', function () { fillSubdivisions(this.value, ''); });
      $('worldRegionSave').addEventListener('click', save);
    }
    load();
  }
  root.MCC_WORLD_REGION = { open: open };
})(window);
