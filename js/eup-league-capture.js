/* Environmental Justice League · member capture (window.MCC_LEAGUE_CAPTURE).

   Recording a take, or choosing a file, for one League upload; and sending the
   bytes to the upload grant the Worker signed. Used by js/eup-league-member.js
   on action/league.html; it draws nothing itself.

   Rules this file keeps (lane member-ui, step 5 of the League map):
   - The camera and the microphone are asked for ONLY inside start(), which the
     member page calls from the Record (or Retake) button's own handler. Nothing
     here runs on load, on mount or on render.
   - A take is held in memory only: one Blob and one object URL for its preview.
     retake(), cancel() and release() stop every track, stop the recorder and
     revoke every object URL this session made. Nothing is written to storage.
   - The recorder MIME is chosen with MediaRecorder.isTypeSupported in the order
     audio mp4, webm opus, ogg; video mp4, webm. What is sent on the wire is the
     bare type ("audio/webm", never "audio/webm;codecs=opus"), as the contract's
     bareMime says.
   - A chosen file is checked before anything is sent: its type must be in the
     League media table, its kind one the mission and the policy take, its size
     within the policy cap and the bucket ceiling, and its first bytes must be a
     family that type allows. The server checks all of it again; this only
     refuses early, with a reason a person can act on.
   - The upload is one PUT of the bytes to the signed grant, with the grant's own
     headers, by XMLHttpRequest so progress can be shown and the send cancelled.
     The grant URL is never logged, stored or drawn.

   MEDIA_TYPES, HARD_MAX_BYTES and sniffFamily are COPIES of the frozen contract
   (workers/mccluster/src/eup/league-contract.js: MEDIA.types, MEDIA.hard_max_bytes,
   sniffMediaFamily). The contract is Worker source and is not published with the
   site, so the page cannot import it; scripts/test/eup-league-member-ui.test.mjs
   holds these copies equal to it. */
(function (root) {
  'use strict';

  var MEDIA_TYPES = {
    'audio/mpeg': { kind: 'audio', ext: 'mp3', families: ['mpeg'] },
    'audio/mp4': { kind: 'audio', ext: 'm4a', families: ['iso_bmff'] },
    'audio/x-m4a': { kind: 'audio', ext: 'm4a', families: ['iso_bmff'] },
    'audio/wav': { kind: 'audio', ext: 'wav', families: ['riff_wave'] },
    'audio/webm': { kind: 'audio', ext: 'webm', families: ['ebml'] },
    'audio/ogg': { kind: 'audio', ext: 'ogg', families: ['ogg'] },
    'video/mp4': { kind: 'video', ext: 'mp4', families: ['iso_bmff'] },
    'video/webm': { kind: 'video', ext: 'webm', families: ['ebml'] },
    'video/quicktime': { kind: 'video', ext: 'mov', families: ['iso_bmff'] }
  };
  var HARD_MAX_BYTES = 104857600;
  var MAX_SECONDS = 3600; // the contract's duration_seconds ceiling
  /* What browsers call some of these files, mapped to the table's name for the same thing. */
  var ALIASES = { 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-mp3': 'audio/mpeg', 'audio/m4a': 'audio/mp4' };
  var RECORDER_TYPES = {
    audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'],
    video: ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  };
  var TYPE_NAMES = 'MP3, M4A, WAV, WebM or Ogg audio, or MP4, WebM or MOV video';

  function bareMime(value) { return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''; }
  function tableMime(value) { var m = bareMime(value); return Object.prototype.hasOwnProperty.call(ALIASES, m) ? ALIASES[m] : m; }
  function mediaType(mime) { return typeof mime === 'string' && Object.prototype.hasOwnProperty.call(MEDIA_TYPES, mime) ? MEDIA_TYPES[mime] : null; }

  /* The magic-byte family of the first bytes of a file, or null (a copy of the contract's sniffMediaFamily). */
  function sniffFamily(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length < 4) return null;
    var b = bytes;
    function ascii(offset, text) {
      if (b.length < offset + text.length) return false;
      for (var i = 0; i < text.length; i += 1) if (b[offset + i] !== text.charCodeAt(i)) return false;
      return true;
    }
    if (ascii(0, 'RIFF')) return ascii(8, 'WAVE') ? 'riff_wave' : null;
    if (ascii(4, 'ftyp')) return b.length >= 12 ? 'iso_bmff' : null;
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'ebml';
    if (ascii(0, 'OggS')) return 'ogg';
    if (ascii(0, 'ID3')) return b.length >= 10 && b[3] !== 0xff && b[4] !== 0xff ? 'mpeg' : null;
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x18) !== 0x08 && (b[1] & 0x06) !== 0x00 && (b[2] & 0xf0) !== 0xf0 && (b[2] & 0x0c) !== 0x0c) return 'mpeg';
    return null;
  }

  /* The first recorder type this browser supports for a kind, or null. */
  function pickMime(kind, isTypeSupported) {
    var list = RECORDER_TYPES[kind] || [];
    if (typeof isTypeSupported !== 'function') return null;
    for (var i = 0; i < list.length; i += 1) {
      try { if (isTypeSupported(list[i]) && mediaType(bareMime(list[i]))) return list[i]; } catch (e) { /* a throwing probe is a no */ }
    }
    return null;
  }
  function megabytes(bytes) { return (Math.round((bytes / 1048576) * 10) / 10) + ' MB'; }

  /* inspectFile(file, rules): { ok, mime, kind, bytes, reason }. rules = { kinds: [...], caps: { audio, video } }.
     Reads at most the first 12 bytes. Never throws: a file that cannot be read is refused with a reason. */
  function inspectFile(file, rules) {
    rules = rules || {};
    var kinds = Array.isArray(rules.kinds) ? rules.kinds : [];
    var refuse = function (reason) { return Promise.resolve({ ok: false, reason: reason }); };
    if (!file || typeof file.size !== 'number') return refuse('No file was chosen.');
    var mime = tableMime(file.type);
    var type = mediaType(mime);
    if (!type) return refuse('This file type is not accepted' + (file.type ? ' (' + bareMime(file.type) + ')' : '') + '. Choose ' + TYPE_NAMES + '.');
    if (kinds.indexOf(type.kind) < 0) return refuse('This mission does not take ' + type.kind + ' files' + (kinds.length ? '; it takes ' + kinds.join(' or ') + '.' : '.'));
    if (file.size === 0) return refuse('This file is empty.');
    var cap = rules.caps && typeof rules.caps[type.kind] === 'number' ? Math.min(rules.caps[type.kind], HARD_MAX_BYTES) : HARD_MAX_BYTES;
    if (file.size > cap) return refuse('This file is ' + megabytes(file.size) + '; the limit for ' + type.kind + ' is ' + megabytes(cap) + '.');
    var head = file.slice ? file.slice(0, 12) : null;
    var read = head && typeof head.arrayBuffer === 'function' ? head.arrayBuffer() : Promise.reject(new Error('unreadable'));
    return read.then(function (buffer) {
      var family = sniffFamily(new Uint8Array(buffer));
      if (!family || type.families.indexOf(family) < 0) return { ok: false, reason: 'This file\'s contents are not ' + mime + ' ' + type.kind + '. Choose ' + TYPE_NAMES + '.' };
      return { ok: true, mime: mime, kind: type.kind, bytes: file.size, family: family };
    }, function () { return { ok: false, reason: 'This file could not be read.' }; });
  }

  /* createSession(env): one take at a time for one assignment.
     env = { navigator, MediaRecorder, URL, Blob, setTimeout, clearTimeout, setInterval, clearInterval, now, onChange }
     every field defaults to the browser's. state: idle | requesting | recording | stopping | preview | denied | nodevice |
     unsupported | error. A session never asks for a device unless start() is called. */
  function createSession(env) {
    env = env || {};
    var nav = env.navigator || root.navigator;
    var Recorder = Object.prototype.hasOwnProperty.call(env, 'MediaRecorder') ? env.MediaRecorder : root.MediaRecorder;
    var URLs = env.URL || root.URL;
    var BlobCtor = env.Blob || root.Blob;
    var later = env.setTimeout || root.setTimeout.bind(root);
    var cancelLater = env.clearTimeout || root.clearTimeout.bind(root);
    var every = env.setInterval || root.setInterval.bind(root);
    var cancelEvery = env.clearInterval || root.clearInterval.bind(root);
    var now = env.now || function () { return Date.now(); };
    var changed = typeof env.onChange === 'function' ? env.onChange : function () {};
    var s = { state: 'idle', kind: null, mime: null, source: null, blob: null, url: null, name: null, seconds: 0, bytes: 0, error: null, stream: null, maxSeconds: null };
    var urls = [];
    var recorder = null, stopTimer = null, ticker = null, generation = 0, startedAt = 0, stoppedAt = 0;

    function supported(kind) {
      return Boolean(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function' && typeof Recorder === 'function' &&
        pickMime(kind, Recorder.isTypeSupported ? Recorder.isTypeSupported.bind(Recorder) : null));
    }
    function stopTracks() {
      var stream = s.stream;
      s.stream = null;
      if (stream && typeof stream.getTracks === 'function') stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* already stopped */ } });
    }
    function revokeAll() {
      urls.forEach(function (u) { try { URLs.revokeObjectURL(u); } catch (e) { /* already revoked */ } });
      urls = [];
      s.url = null;
    }
    function clearTimers() {
      if (stopTimer !== null) { cancelLater(stopTimer); stopTimer = null; }
      if (ticker !== null) { cancelEvery(ticker); ticker = null; }
    }
    /* Everything this session holds is let go: tracks stopped, recorder stopped without a take, URLs revoked. */
    function release() {
      generation += 1;
      clearTimers();
      if (recorder) {
        recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* inactive */ }
        recorder = null;
      }
      stopTracks();
      revokeAll();
      s.blob = null; s.mime = null; s.source = null; s.name = null; s.seconds = 0; s.bytes = 0;
    }
    function fail(state, error) { clearTimers(); recorder = null; stopTracks(); s.state = state; s.error = error; changed(s); return s; }
    function keepUrl(blob) { var u = URLs.createObjectURL(blob); urls.push(u); return u; }
    function elapsed() { return Math.max(1, Math.min(MAX_SECONDS, Math.ceil(((stoppedAt || now()) - startedAt) / 1000))); }

    /* start(kind, maxSeconds): the ONE place a device is asked for. Called from the Record or Retake handler. */
    function start(kind, maxSeconds) {
      release();
      s.kind = kind; s.error = null; s.maxSeconds = maxSeconds > 0 ? Math.min(MAX_SECONDS, Math.floor(maxSeconds)) : null;
      var mime = typeof Recorder === 'function' ? pickMime(kind, Recorder.isTypeSupported ? Recorder.isTypeSupported.bind(Recorder) : null) : null;
      if (!mime || !nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') { s.state = 'unsupported'; changed(s); return Promise.resolve(s); }
      var mine = generation;
      s.state = 'requesting'; changed(s);
      var constraints = kind === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true, video: false };
      var asked;
      try { asked = Promise.resolve(nav.mediaDevices.getUserMedia(constraints)); } catch (e) { asked = Promise.reject(e); }
      return asked.then(function (stream) {
        if (mine !== generation) { if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* stopped */ } }); return s; }
        s.stream = stream;
        var chunks = [];
        try { recorder = new Recorder(stream, { mimeType: mime }); } catch (e) { return fail('error', { name: (e && e.name) || 'Error' }); }
        recorder.ondataavailable = function (e) { if (e && e.data && e.data.size) chunks.push(e.data); };
        recorder.onerror = function (e) { if (mine === generation) fail('error', { name: (e && e.error && e.error.name) || 'Error' }); };
        recorder.onstop = function () {
          if (mine !== generation) return;
          clearTimers();
          var type = (recorder && recorder.mimeType) || mime;
          recorder = null;
          stopTracks();
          var blob = new BlobCtor(chunks, { type: type });
          if (!blob.size) { fail('error', { name: 'EmptyTake' }); return; }
          s.blob = blob; s.mime = tableMime(type); s.source = 'recording'; s.bytes = blob.size; s.seconds = elapsed();
          s.url = keepUrl(blob);
          s.state = 'preview';
          changed(s);
        };
        startedAt = now(); stoppedAt = 0;
        recorder.start(1000);
        s.state = 'recording'; s.seconds = 0;
        ticker = every(function () { if (mine === generation) { s.seconds = Math.floor((now() - startedAt) / 1000); changed(s, 'tick'); } }, 1000);
        if (s.maxSeconds) stopTimer = later(function () { if (mine === generation) stop(); }, s.maxSeconds * 1000);
        changed(s);
        return s;
      }, function (err) {
        if (mine !== generation) return s;
        var name = (err && err.name) || 'Error';
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return fail('denied', { name: name });
        if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'DevicesNotFoundError') return fail('nodevice', { name: name });
        return fail('error', { name: name });
      });
    }
    function stop() {
      if (recorder && recorder.state === 'recording') {
        stoppedAt = now();
        s.state = 'stopping'; changed(s);
        try { recorder.stop(); } catch (e) { fail('error', { name: 'Error' }); }
      }
    }
    /* A chosen file becomes the take, after inspectFile said yes. */
    function useFile(file, checked) {
      release();
      s.kind = checked.kind; s.mime = checked.mime; s.source = 'file'; s.blob = file; s.bytes = checked.bytes; s.name = typeof file.name === 'string' ? file.name : null; s.seconds = 0;
      s.url = keepUrl(file);
      s.state = 'preview'; s.error = null;
      changed(s);
      return s;
    }
    function cancel() { release(); s.state = 'idle'; s.kind = null; s.error = null; changed(s); return s; }
    function liveTracks() {
      if (!s.stream || typeof s.stream.getTracks !== 'function') return 0;
      return s.stream.getTracks().filter(function (t) { return t.readyState !== 'ended'; }).length;
    }
    return {
      state: s,
      supported: supported,
      start: start,
      retake: function (maxSeconds) { var kind = s.kind; return start(kind, maxSeconds === undefined ? s.maxSeconds : maxSeconds); },
      stop: stop,
      cancel: cancel,
      release: release,
      useFile: useFile,
      liveTracks: liveTracks,
      objectUrls: function () { return urls.slice(); }
    };
  }

  /* put(grant, blob, opts): the bytes to the signed grant. Returns { promise, abort }. The promise resolves with the HTTP
     status of a 2xx answer and rejects with { stage: 'put', status | network | aborted | timeout }. opts = { onProgress,
     timeoutMs, XMLHttpRequest }. No credentials are sent; the URL is never logged. */
  function put(grant, blob, opts) {
    opts = opts || {};
    var XHR = opts.XMLHttpRequest || root.XMLHttpRequest;
    var xhr = new XHR();
    var promise = new Promise(function (resolve, reject) {
      if (!grant || typeof grant.url !== 'string' || !/^https:\/\//.test(grant.url)) { reject({ stage: 'put', invalid: true }); return; }
      xhr.open(String(grant.method || 'PUT').toUpperCase(), grant.url, true);
      var headers = grant.headers && typeof grant.headers === 'object' ? grant.headers : {};
      Object.keys(headers).forEach(function (h) { xhr.setRequestHeader(h, String(headers[h])); });
      xhr.withCredentials = false;
      if (opts.timeoutMs > 0) xhr.timeout = opts.timeoutMs;
      if (xhr.upload && typeof opts.onProgress === 'function') {
        xhr.upload.onprogress = function (e) { if (e && e.lengthComputable) opts.onProgress(e.loaded, e.total); };
      }
      xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.status); else reject({ stage: 'put', status: xhr.status }); };
      xhr.onerror = function () { reject({ stage: 'put', network: true }); };
      xhr.onabort = function () { reject({ stage: 'put', aborted: true }); };
      xhr.ontimeout = function () { reject({ stage: 'put', timeout: true }); };
      xhr.send(blob);
    });
    return { promise: promise, abort: function () { try { xhr.abort(); } catch (e) { /* finished */ } } };
  }

  root.MCC_LEAGUE_CAPTURE = Object.freeze({
    MEDIA_TYPES: MEDIA_TYPES,
    HARD_MAX_BYTES: HARD_MAX_BYTES,
    RECORDER_TYPES: RECORDER_TYPES,
    bareMime: bareMime,
    tableMime: tableMime,
    mediaType: mediaType,
    sniffFamily: sniffFamily,
    pickMime: pickMime,
    inspectFile: inspectFile,
    createSession: createSession,
    put: put,
    megabytes: megabytes
  });
})(typeof window !== 'undefined' ? window : globalThis);
