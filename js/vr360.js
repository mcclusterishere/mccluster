/* ============================================================
   VR360: the look-around engine.
   Wraps equirectangular media (photo or video) on the inside of
   a sphere via a single fullscreen WebGL shader: every pixel
   casts a ray from the center and samples the panorama.

   Controls: drag / swipe to look (with inertia), pinch or wheel
   to zoom, optional gyroscope on phones (iOS asks permission).
   Zero dependencies, self-hosted like everything else here.

   Usage:
     VR360.mount(canvasEl, { src: "path.jpg" | "path.mp4", video: bool })
   ============================================================ */
(function () {
  "use strict";

  var VERT =
    "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FRAG =
    "precision highp float;" +
    "uniform sampler2D uTex;uniform float uYaw,uPitch,uFov,uAspect;uniform vec2 uRes;" +
    "void main(){" +
    "vec2 ndc=(gl_FragCoord.xy/uRes)*2.-1.;" +
    "float t=tan(uFov*.5);" +
    "vec3 d=normalize(vec3(ndc.x*t*uAspect,ndc.y*t,-1.));" +
    "float cp=cos(uPitch),sp=sin(uPitch);" +
    "d=vec3(d.x,d.y*cp-d.z*sp,d.y*sp+d.z*cp);" +
    "float cy=cos(uYaw),sy=sin(uYaw);" +
    "d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);" +
    "float u=atan(d.x,-d.z)/6.2831853+.5;" +
    "float v=.5-asin(clamp(d.y,-1.,1.))/3.1415927;" +
    "gl_FragColor=texture2D(uTex,vec2(u,v));}";

  function mount(canvas, opts) {
    // no MSAA (the shader is one texture lookup, so antialias just costs),
    // no alpha compositing, and ask for the fast GPU + desynchronized paints
    var gl = canvas.getContext("webgl", {
      antialias: false, alpha: false, preserveDrawingBuffer: false,
      powerPreference: "high-performance", desynchronized: true,
    });
    if (!gl) return null;

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ["uYaw","uPitch","uFov","uAspect","uRes"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    var TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    // portrait phones open wider: 75° vertical in a tall window leaves a
    // keyhole of horizontal view, and ~97° restores the sense of a cabin
    var PORTRAIT = canvas.clientHeight > canvas.clientWidth;
    var state = {
      yaw: (opts.yaw || 0) * Math.PI / 180, pitch: (opts.pitch || 0) * Math.PI / 180,
      fov: (PORTRAIT ? 97 : 75) * Math.PI / 180,
      vyaw: 0, vpitch: 0, dragging: false,
      src: null, isVideo: !!opts.video, ready: false,
      gyro: false, gyawBase: null,
      touchThrottle: TOUCH, frameN: 0,
    };

    // a still poster fills the sphere the moment it decodes, so the
    // look-around works instantly while the film is still buffering
    if (opts.poster) {
      var poster = new Image();
      poster.crossOrigin = "anonymous";
      poster.onload = function () {
        if (state.ready) return; // the film beat us to it
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, poster);
        state.poster = true;
      };
      poster.src = opts.poster;
    }

    var media;
    if (state.isVideo) {
      media = document.createElement("video");
      media.muted = true; media.loop = true; media.playsInline = true;
      media.setAttribute("playsinline", ""); media.crossOrigin = "anonymous";
      media.preload = "auto";
      media.src = opts.src;
      media.addEventListener("canplay", function () {
        state.ready = true;
        if (opts.autoplay !== false) media.play().catch(function(){});
      });
      // only mark a new frame when the browser actually presents one: the
      // render loop re-uploads to the GPU on new frames only, not every rAF.
      // (Re-uploading a whole equirect frame 60×/s was the source of the chop.)
      if (media.requestVideoFrameCallback) {
        var onVF = function () { state.newFrame = true; media.requestVideoFrameCallback(onVF); };
        media.requestVideoFrameCallback(onVF);
      }
      media.load();
    } else {
      media = new Image();
      media.crossOrigin = "anonymous";
      media.onload = function () {
        state.ready = true;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, media);
      };
      media.src = opts.src;
    }

    // reading clientWidth forces a layout, so we only do it when something
    // actually changed (resize / orientation), not on every animation frame.
    state.needResize = true;
    function size() {
      state.needResize = false;
      // touch devices run the sphere at ~1×: the equirect shader is
      // per-pixel work, and a retina framebuffer quadruples it for detail
      // nobody sees mid-pan
      var dpr = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.15 : 2);
      var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    // resizes are DEBOUNCED: portrait Safari fires a continuous resize storm
    // while its toolbar animates, and reallocating the framebuffer on every
    // tick of that storm was the stutter. One reallocation, once it settles.
    var resizeT = null;
    function markResize() {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        state.needResize = true;
        // a reallocation clears the canvas, so pull the next video frame
        // immediately so the film never blinks black
        state.newFrame = true;
        state.lastUpload = 0;
      }, 180);
    }
    window.addEventListener("resize", markResize);
    window.addEventListener("orientationchange", markResize);

    /* ---- drag with inertia ---- */
    /* ---- input: ONE pointer owns the drag ----
       iOS fires pointer events for every touch. The old handler fed all of
       them through one shared start point, so a second thumb or a resting
       palm made the view leap between fingers: the uncontrollable spin.
       Now the first pointer down owns the camera until it lifts; everyone
       else is ignored, and two fingers means pinch, never pan. */
    var px = 0, py = 0, pinch0 = 0, fov0 = 0;
    var ownerId = null, lastMoveT = 0;
    var VMAX = 0.055; // rad/frame: no flick may spin faster than this
    canvas.style.touchAction = opts.touchAction || "none";
    canvas.addEventListener("pointerdown", function (e) {
      if (ownerId !== null) return;           // a finger already owns the view
      ownerId = e.pointerId;
      state.touched = true;                    // the welcome drift retires for good
      state.dragging = true; px = e.clientX; py = e.clientY;
      state.vyaw = 0; state.vpitch = 0;
      lastMoveT = performance.now();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!state.dragging || e.pointerId !== ownerId) return;
      var now = performance.now();
      var dt = Math.max(1, now - lastMoveT);
      lastMoveT = now;
      var k = state.fov / canvas.clientHeight;
      var dx = (e.clientX - px) * k, dy = (e.clientY - py) * k;
      // both axes ride the SAME convention: a thumb stroke moves the view
      // the same way horizontally as it does vertically
      state.yaw += dx; state.pitch += dy;
      // momentum is normalized to REAL time. iOS delivers coalesced events
      // with big deltas at low frequency, and per-event velocity made every
      // flick a runaway. Per-frame velocity, hard-capped.
      var scale = Math.min(2, 16.7 / dt);
      state.vyaw = Math.max(-VMAX, Math.min(VMAX, dx * scale * 0.85));
      state.vpitch = Math.max(-VMAX, Math.min(VMAX, dy * scale * 0.85));
      px = e.clientX; py = e.clientY;
      clampPitch();
    });
    function end(e) {
      if (e && e.pointerId !== ownerId) return;
      ownerId = null;
      state.dragging = false;
      // thumb rested before lifting = the visitor STOPPED. Honor it, no coast
      if (performance.now() - lastMoveT > 90) { state.vyaw = 0; state.vpitch = 0; }
    }
    function forceRelease() {
      ownerId = null; state.dragging = false; state.vyaw = 0; state.vpitch = 0;
    }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    // iOS system gestures (edge swipes, notification pulls) can hijack a
    // touch and never deliver its release, and the owner would hold the camera
    // forever and every new finger would be ignored. Releases are therefore
    // also caught at the window, and lost fingers are force-released.
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", forceRelease);
    document.addEventListener("visibilitychange", forceRelease);
    canvas.addEventListener("touchend", function (e) { if (e.touches.length === 0 && ownerId !== null) forceRelease(); }, { passive: true });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      setFov(state.fov + e.deltaY * 0.002);
    }, { passive: false });
    canvas.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        pinch0 = dist(e.touches); fov0 = state.fov;
        // two fingers = zoom, never pan: release the drag entirely
        ownerId = null; state.dragging = false; state.vyaw = 0; state.vpitch = 0;
      }
    }, { passive: true });
    canvas.addEventListener("touchmove", function (e) {
      if (e.touches.length === 2 && pinch0) {
        setFov(fov0 * pinch0 / dist(e.touches));
      }
    }, { passive: true });
    canvas.addEventListener("touchend", function () { pinch0 = 0; }, { passive: true });
    function dist(t) { var a = t[0], b = t[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    function setFov(f) { state.fov = Math.max(0.5, Math.min(1.9, f)); }
    function clampPitch() { state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch)); }

    /* ---- gyroscope (opt-in) ---- */
    var gyroPrev = null;
    function onGyro(e) {
      if (e.alpha == null) return;
      var a = e.alpha * Math.PI / 180, b = e.beta * Math.PI / 180;
      if (gyroPrev) {
        var da = a - gyroPrev.a, db = b - gyroPrev.b;
        if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        state.yaw += da; state.pitch += db; clampPitch();
      }
      gyroPrev = { a: a, b: b };
    }
    /* Answers with a promise for whether the cabin actually got the phone's
       motion, because it used to answer "true" the instant it was asked and
       the caller had no way to know a permission prompt was still open, or
       had been refused. Callers announce motion only on a real yes.

       iOS gates deviceorientation behind requestPermission(), and that call
       is only honored from inside a user gesture — so arming on scroll-entry
       succeeds everywhere else and, on iOS, has to ride the visitor's first
       tap instead. */
    function enableGyro() {
      if (state.gyro) return Promise.resolve(true);
      function arm() {
        state.gyro = true;
        window.addEventListener("deviceorientation", onGyro);
        return true;
      }
      if (!window.DeviceOrientationEvent) return Promise.resolve(false);
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        return DeviceOrientationEvent.requestPermission()
          .then(function (r) { return r === "granted" ? arm() : false; })
          .catch(function () { return false; });
      }
      return Promise.resolve(arm());
    }
    /* whether asking will pop a system prompt — the caller needs to know
       whether it may ask on entry or must wait for a gesture */
    enableGyro.needsGesture = !!(window.DeviceOrientationEvent
      && typeof DeviceOrientationEvent.requestPermission === "function");

    /* ---- hotspots: tags pinned to things in the scene ----
       spot = { yaw, pitch (degrees), label, href, from, to (seconds, optional) } */
    var spots = [];
    var spotLayer = document.createElement("div");
    spotLayer.className = "vr360-spots";
    canvas.parentNode.insertBefore(spotLayer, canvas.nextSibling);

    function setSpots(list) {
      spots = (list || []).map(function (s) {
        var el = document.createElement("a");
        // urgent spots are the ones the scene is actually selling; they flash
        // instead of sitting politely with the rest
        el.className = "vr360-spot" + (s.urgent ? " is-urgent" : "");
        el.href = s.href || "#";
        if (s.blank) { el.target = "_blank"; el.rel = "noopener"; }
        el.innerHTML = "<i></i><span>" + s.label + "</span>";
        el.addEventListener("click", function () {
          if (window.MCC_TRACK) window.MCC_TRACK("vr_spot_click", { label: s.label });
        });
        spotLayer.appendChild(el);
        // its edge chip: when the tag is off-screen, an arrow at the border
        // points the way to it so nothing pinned in the scene goes unfound
        var edge = document.createElement("span");
        edge.className = "vr360-edge";
        edge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
        spotLayer.appendChild(edge);
        return { cfg: s, el: el, edge: edge, yaw: s.yaw * Math.PI / 180, pitch: s.pitch * Math.PI / 180 };
      });
    }
    if (opts.spots) setSpots(opts.spots);

    // world direction the camera at (yaw,pitch) looks toward, same math as the shader
    function dirOf(yaw, pitch) {
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      return [-cp * Math.sin(yaw), sp, -cp * Math.cos(yaw)];
    }
    function placeSpots() {
      if (!spots.length) return;
      var t = Math.tan(state.fov / 2);
      var aspect = canvas.width / canvas.height;
      // inverse of the shader's world-from-camera (Ry(yaw) then Rx(pitch)):
      // cam = Rx(-pitch) · Ry(-yaw) · world, which, with the shader's
      // rotation convention, works out to these positive-angle terms
      var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      var cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      var now = state.isVideo ? media.currentTime : null;
      spots.forEach(function (s) {
        if (now != null && s.cfg.from != null && (now < s.cfg.from || now > (s.cfg.to || 1e9))) {
          s.el.style.display = "none"; s.edge.style.display = "none"; return;
        }
        var w = dirOf(s.yaw, s.pitch);
        // rotate world into camera space: Ry(-yaw) then Rx(-pitch)
        var x1 = w[0] * cy - w[2] * sy, z1 = w[0] * sy + w[2] * cy, y1 = w[1];
        var y2 = y1 * cp + z1 * sp, z2 = -y1 * sp + z1 * cp;
        var off = z2 > -0.05; // behind you
        var nx = 0, ny = 0;
        if (!off) {
          nx = (x1 / -z2) / (t * aspect); ny = (y2 / -z2) / t;
          off = nx < -1.05 || nx > 1.05 || ny < -1.05 || ny > 1.05;
        }
        if (!off) {
          s.el.style.display = "";
          s.edge.style.display = "none";
          s.el.style.left = ((nx * 0.5 + 0.5) * 100) + "%";
          s.el.style.top = ((0.5 - ny * 0.5) * 100) + "%";
          return;
        }
        // off-screen: park an arrow at the border, aimed at where the tag lives
        s.el.style.display = "none";
        var dx = x1, dy = y2;
        if (z2 > 0) { dx = dx || 0.0001; } // straight behind still needs a direction
        var len = Math.hypot(dx, dy) || 1;
        var px = dx / len, py = dy / len;
        s.edge.style.display = "";
        s.edge.style.left = (50 + px * 44) + "%";
        s.edge.style.top = (50 - py * 44) + "%";
        s.edge.style.transform =
          "translate(-50%, -50%) rotate(" + (Math.atan2(-py, px) * 180 / Math.PI) + "deg)";
      });
    }

    /* ---- authoring: tap the scene, get its yaw/pitch/time to paste into the config ---- */
    function pick(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var t = Math.tan(state.fov / 2), aspect = canvas.width / canvas.height;
      var nx = ((clientX - r.left) / r.width * 2 - 1) * t * aspect;
      var ny = (1 - (clientY - r.top) / r.height * 2) * t;
      var d = [nx, ny, -1];
      // rotate view ray into the world: Rx(pitch) then Ry(yaw), the shader's order
      var cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      var y1 = d[1] * cp - d[2] * sp, z1 = d[1] * sp + d[2] * cp, x1 = d[0];
      var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      var x2 = x1 * cy + z1 * sy, z2 = -x1 * sy + z1 * cy;
      var len = Math.hypot(x2, y1, z2);
      var yaw = Math.atan2(-x2 / len, -z2 / len) * 180 / Math.PI;
      var pitch = Math.asin(y1 / len) * 180 / Math.PI;
      return { yaw: +yaw.toFixed(1), pitch: +pitch.toFixed(1), t: state.isVideo ? +media.currentTime.toFixed(1) : 0 };
    }

    /* ---- render loop ---- */
    function frame() {
      if (state.needResize) size();
      // upload a video frame to the GPU only when a fresh one exists. First
      // upload allocates (texImage2D); the rest update in place (texSubImage2D),
      // which is far cheaper than reallocating a full equirect every frame.
      // On touch devices uploads are additionally capped at ~15/sec, because iOS
      // converts every upload on the CPU, and the pan stays 60fps regardless
      // because drawing reuses the last texture.
      var wantFrame = media.requestVideoFrameCallback ? state.newFrame : true;
      var nowMs = performance.now();
      if (wantFrame && state.touchThrottle && nowMs - (state.lastUpload || 0) < 66) wantFrame = false;
      if (state.ready && state.isVideo && media.readyState >= 2 && wantFrame) {
        state.newFrame = false;
        state.lastUpload = nowMs;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (state.texW === media.videoWidth && state.texH === media.videoHeight) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, media);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, media);
          state.texW = media.videoWidth; state.texH = media.videoHeight;
        }
      }
      if (!state.dragging) {
        state.yaw += state.vyaw; state.pitch += state.vpitch; clampPitch();
        state.vyaw *= 0.93; state.vpitch *= 0.93;
        // sub-perceptible momentum snaps to zero: a "stopped" view must be STOPPED
        if (Math.abs(state.vyaw) < 0.00012) state.vyaw = 0;
        if (Math.abs(state.vpitch) < 0.00012) state.vpitch = 0;
        // the idle drift only welcomes: once a thumb has taken the wheel,
        // the camera never moves on its own again
        if (!state.gyro && !state.touched && !state.vyaw && !state.vpitch) state.yaw += 0.0006;
      }
      gl.uniform1f(U.uYaw, state.yaw);
      gl.uniform1f(U.uPitch, state.pitch);
      gl.uniform1f(U.uFov, state.fov);
      gl.uniform1f(U.uAspect, canvas.width / canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // the watchdog: a real drag moves or ends. A "drag" frozen for 1.2s
      // is a finger the system stole, so release it so the next touch works.
      if (state.dragging && performance.now() - lastMoveT > 1200) forceRelease();
      // the pin overlay re-projects every OTHER frame on touch: 30fps DOM
      // writes are invisible on labels, and the pan keeps its full budget
      state.frameN++;
      if (!state.touchThrottle || (state.frameN & 1)) placeSpots();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      state: state,
      media: media,
      enableGyro: enableGyro,
      setSpots: setSpots,
      pick: pick,
      play: function () { if (state.isVideo) media.play().catch(function(){}); },
      pause: function () { if (state.isVideo) media.pause(); },
    };
  }

  window.VR360 = { mount: mount };
})();
