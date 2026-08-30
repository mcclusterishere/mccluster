/* ============================================================
   THE CUTTER: the spacing math, as an engine.
   Give it a record's timed lyrics and a bag of clips (with real
   durations) and it cuts a reel the way the house cuts them:
   every scene holds long enough for one full play of its clip
   (the elastic law at playback covers the last 10%), anchors
   land on lyric begins, and the chain covers the whole record;
   intro, outro, instrumental breaks included. Deterministic:
   the same inputs always cut the same film.

   MCC_CUTTER.autoCut(lines, clips, songDur [, opts]) → scenes[]
     lines: [{begin, content}]  (Lyric Potato timed lines)
     clips: [{src, poster, duration}]  (duration in seconds)
     songDur: the record's length in seconds
     opts.minHold: fraction of a clip that must fit before a new
       scene may open on a lyric anchor (default 0.85)

   MCC_CUTTER.validate(scenes, songDur) → {ok, notes[]}
   ============================================================ */
window.MCC_CUTTER = (function () {
  "use strict";

  function autoCut(lines, clips, songDur, opts) {
    opts = opts || {};
    var minHold = opts.minHold || 0.85;
    clips = (clips || []).filter(function (c) { return c && c.src && c.duration > 0.5; });
    if (!clips.length || !songDur) return [];
    lines = (lines || []).slice().sort(function (a, b) { return a.begin - b.begin; });

    var scenes = [];
    var ci = 0; // the clip wheel: round robin, never two of the same back to back
    function nextClip() {
      var c = clips[ci % clips.length];
      ci++;
      if (clips.length > 1 && scenes.length && scenes[scenes.length - 1].src === c.src) {
        c = clips[ci % clips.length]; ci++;
      }
      return c;
    }

    /* the opener holds from zero */
    var cur = nextClip();
    scenes.push({ begin: 0, src: cur.src, poster: cur.poster || "" });
    var sceneStart = 0;

    /* walk the words: a new scene may open on a lyric begin once the
       current clip has had room for (most of) a full play */
    for (var i = 0; i < lines.length; i++) {
      var b = lines[i].begin;
      if (b <= sceneStart) continue;
      if (b - sceneStart >= cur.duration * minHold) {
        cur = nextClip();
        scenes.push({ begin: Math.round(b * 100) / 100, src: cur.src, poster: cur.poster || "" });
        sceneStart = b;
      }
    }

    /* the tail: instrumentals and outros get covered by the wheel so
       the chain never runs out of film before the record ends, but a
       scene never opens unless it can hold most of a full play */
    var t = sceneStart + cur.duration;
    while (t < songDur - 1.5) {
      var peek = clips[ci % clips.length];
      if (songDur - t < peek.duration * minHold) break; // the last frame holds the credits
      cur = nextClip();
      scenes.push({ begin: Math.round(t * 100) / 100, src: cur.src, poster: cur.poster || "" });
      t += cur.duration;
    }
    return scenes;
  }

  function validate(scenes, songDur) {
    var notes = [], ok = true;
    if (!scenes || !scenes.length) return { ok: false, notes: ["no scenes"] };
    for (var i = 0; i < scenes.length; i++) {
      if (i && scenes[i].begin <= scenes[i - 1].begin) { ok = false; notes.push("begins not ascending at #" + i); }
    }
    if (scenes[0].begin !== 0) { ok = false; notes.push("the opener must begin at 0"); }
    if (songDur && scenes[scenes.length - 1].begin > songDur) { ok = false; notes.push("a scene begins after the record ends"); }
    return { ok: ok, notes: notes };
  }

  return { autoCut: autoCut, validate: validate };
})();
