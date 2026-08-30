/* ============================================================
   THE CHAMBER — the sound system's room, rendered on the GPU.

   A fragment shader breathes behind the catalog: domain-warped silk
   in the playing track's own color, bass as mass, highs as sparkle,
   a light sweep on every track change. The audio analyser feeds the
   shader's uniforms frame by frame — the record is the renderer.

   The fall is graceful three times over:
     WebGL refused        → the 2D bloom (canvas) takes the room
     WebAudio refused     → clockwork sway, playback untouched
     reduced motion       → nothing moves, everything still works

   Also here: THE PREMIERE (the page opens like a show, once per
   session), monument type (the album name sets itself), the honest
   EQ, and the cover leaning toward the hand.
   ============================================================ */
(function () {
  "use strict";
  var CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var deck = document.getElementById("deck");
  var root = document.documentElement;

  /* ---------------- the analyser (playback never pays) ---------------- */
  var actx = null, an = null, bins = null, wired = false, clockwork = false;
  function arm() {
    if (!deck || wired || clockwork) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var src = actx.createMediaElementSource(deck);
      an = actx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.82;
      src.connect(an);
      an.connect(actx.destination); /* forget this and the deck goes silent */
      bins = new Uint8Array(an.frequencyBinCount);
      wired = true;
    } catch (e) { clockwork = true; }
  }
  function bands() {
    if (wired) {
      an.getByteFrequencyData(bins);
      var b = 0, m = 0, h = 0, i;
      for (i = 1; i < 9; i++) b += bins[i];
      for (i = 9; i < 48; i++) m += bins[i];
      for (i = 48; i < 140; i++) h += bins[i];
      return { bass: b / 8 / 255, mid: m / 39 / 255, high: h / 92 / 255 };
    }
    var t = deck ? deck.currentTime : 0;
    return { bass: 0.28 + 0.16 * Math.abs(Math.sin(t * 2.1)),
             mid: 0.22 + 0.12 * Math.abs(Math.sin(t * 3.3 + 1)),
             high: 0.16 + 0.1 * Math.abs(Math.sin(t * 5.2 + 2)) };
  }

  /* ---------------- the track's own color ---------------- */
  var hue = [0.898, 0.22, 0.231]; /* #e5383b */
  function pulseColor() {
    var li = document.querySelector(".tr li.on");
    var c = ((li && getComputedStyle(li).getPropertyValue("--pulse")) ||
             getComputedStyle(root).getPropertyValue("--pulse") || "").trim() || "#e5383b";
    var hex = c.replace("#", "");
    if (hex.length === 3) hex = hex.replace(/./g, function (x) { return x + x; });
    var n = parseInt(hex, 16);
    if (!isNaN(n)) hue = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* ---------------- the canvas ---------------- */
  var cv = null, sheetOpen = false;
  if (!CALM) {
    cv = document.createElement("canvas");
    cv.id = "signal";
    document.body.appendChild(cv);
    var nowEl = document.getElementById("now");
    if (nowEl) {
      new MutationObserver(function () {
        sheetOpen = nowEl.getAttribute("data-on") === "1";
        cv.style.zIndex = sheetOpen ? "211" : "1";
        /* the open sheet is a dark room even at noon, so the room blends
           like one: multiply belongs over the cream page, not over this */
        root.classList.toggle("sheet-open", sheetOpen);
      }).observe(nowEl, { attributes: true, attributeFilter: ["data-on"] });
    }
  }

  /* ---------------- the GPU room ---------------- */
  var gl = null, prog = null, U = {}, sweep = 0, t0 = performance.now();
  var RES = 0.6; /* the silk reads full-strength at 60% resolution, for free */
  function glBoot() {
    if (!cv) return false;
    try {
      gl = cv.getContext("webgl", { alpha: true, antialias: false, powerPreference: "low-power" });
      if (!gl) return false;
      var vs = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
      var fs = [
        "precision highp float;",
        "uniform vec2 u_res;uniform float u_time,u_amp,u_bass,u_mid,u_high,u_open,u_sweep;",
        "uniform vec3 u_hue;",
        "float h21(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}",
        "float nse(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
        " return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+1.),f.x),f.y);}",
        "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*nse(p);p*=2.03;a*=.5;}return v;}",
        "void main(){",
        " vec2 uv=(gl_FragCoord.xy-.5*u_res)/min(u_res.x,u_res.y);",
        " float t=u_time*.055;",
        " vec2 q=vec2(fbm(uv*1.6+t),fbm(uv*1.6-t*.7+3.1));",
        " vec2 r=vec2(fbm(uv*2.2+q*1.8+t*1.3+u_bass*1.1),fbm(uv*2.2+q*1.8-t+u_mid*.8));",
        " float silk=pow(fbm(uv*2.4+r*2.2),1.6);",
        " float e=silk*(.22+u_amp*1.0+u_bass*.35);",
        " vec2 c1=mix(vec2(-.42,-.34),vec2(0.,-.02),u_open);",
        " float glow=exp(-length(uv-c1)*(2.7-u_bass*1.1))*(.32+u_bass*.5);",
        " vec3 col=u_hue*(e*.95+glow);",
        " col+=u_hue*u_high*.28*pow(nse(uv*42.+u_time*2.2),3.);",
        " float sw=exp(-abs(uv.x+uv.y*.35-(1.-u_sweep)*2.6+1.3)*7.)*u_sweep;",
        " col+=vec3(1.)*sw*.45;",
        " col*=smoothstep(1.3,.32,length(uv));",
        " col+=(h21(gl_FragCoord.xy+u_time)*2.-1.)*.018;",
        " gl_FragColor=vec4(col,1.);",
        "}",
      ].join("\n");
      function sh(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s);
        return s;
      }
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw gl.getProgramInfoLog(prog);
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ["u_res", "u_time", "u_amp", "u_bass", "u_mid", "u_high", "u_open", "u_sweep", "u_hue"]
        .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      root.setAttribute("data-chamber", "gl");
      return true;
    } catch (e) { gl = null; root.setAttribute("data-chamber", "2d"); return false; }
  }
  var g2 = null;
  function fit() {
    if (!cv) return;
    /* a tired phone gets the same room at a kinder resolution */
    var res = root.getAttribute("data-power") === "low" ? 0.35 : RES;
    var d = Math.min(2, window.devicePixelRatio || 1) * (gl ? res : 1);
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    if (gl) gl.viewport(0, 0, cv.width, cv.height);
  }
  new MutationObserver(fit).observe(root, { attributes: true, attributeFilter: ["data-power"] });

  function draw(f, amp) {
    if (gl) {
      gl.uniform2f(U.u_res, cv.width, cv.height);
      gl.uniform1f(U.u_time, (performance.now() - t0) / 1000);
      gl.uniform1f(U.u_amp, amp);
      gl.uniform1f(U.u_bass, f.bass);
      gl.uniform1f(U.u_mid, f.mid);
      gl.uniform1f(U.u_high, f.high);
      gl.uniform1f(U.u_open, sheetOpen ? 1 : 0);
      gl.uniform1f(U.u_sweep, sweep);
      gl.uniform3f(U.u_hue, hue[0], hue[1], hue[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    /* the 2D room, for machines the GPU turned away */
    if (!g2) g2 = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    g2.clearRect(0, 0, W, H);
    var x1 = sheetOpen ? W * 0.5 : W * 0.18, y1 = sheetOpen ? H * 0.3 : H * 0.78;
    var r1 = H * (0.32 + f.bass * 0.4);
    var gr = g2.createRadialGradient(x1, y1, 0, x1, y1, r1);
    gr.addColorStop(0, "rgba(" + (hue[0] * 255 | 0) + "," + (hue[1] * 255 | 0) + "," + (hue[2] * 255 | 0) + "," + (0.16 + f.bass * 0.2) + ")");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g2.fillStyle = gr; g2.fillRect(0, 0, W, H);
  }

  /* ---------------- the loop ---------------- */
  var raf = 0, running = false;
  function frame() {
    if (!running) return;
    var f = bands();
    var amp = Math.min(1, f.bass * 0.55 + f.mid * 0.3 + f.high * 0.15);
    root.style.setProperty("--amp", amp.toFixed(3));
    if (sweep > 0) sweep = Math.max(0, sweep - 0.014);
    draw(f, amp);
    var eq = document.querySelectorAll(".tr li.on .eq i");
    if (eq.length === 3) {
      eq[0].style.height = (3 + f.bass * 11) + "px";
      eq[1].style.height = (3 + f.mid * 11) + "px";
      eq[2].style.height = (3 + f.high * 11) + "px";
    }
    raf = requestAnimationFrame(frame);
  }
  function up() {
    if (CALM || !cv) return;
    arm();
    if (actx && actx.state === "suspended") actx.resume().catch(function () {});
    pulseColor();
    root.classList.add("sig-live");
    if (!running) { running = true; frame(); }
  }
  function down() {
    running = false;
    cancelAnimationFrame(raf);
    root.classList.remove("sig-live");
    root.style.setProperty("--amp", "0");
  }
  if (deck && cv) {
    if (glBoot() || cv) fit();
    addEventListener("resize", fit);
    deck.addEventListener("play", up);
    deck.addEventListener("pause", down);
    deck.addEventListener("ended", down);
    deck.addEventListener("loadedmetadata", function () { pulseColor(); sweep = 1; });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (deck && !deck.paused) up();
    });
  }

  /* ---------------- monument type ---------------- */
  var h1 = document.getElementById("albName");
  function setType() {
    if (!h1 || h1.querySelector(".ch")) return;
    var words = h1.textContent.trim().split(/\s+/);
    h1.innerHTML = words.map(function (w, wi) {
      return "<span style=\"white-space:nowrap\">" + w.split("").map(function (c, ci) {
        return '<span class="ch" style="transition-delay:' + (wi * 120 + ci * 34) + 'ms">' + c + "</span>";
      }).join("") + "</span>";
    }).join(" ");
    requestAnimationFrame(function () { requestAnimationFrame(function () { h1.classList.add("set"); }); });
  }
  if (h1) {
    new MutationObserver(function (muts) {
      var external = muts.some(function (m) {
        return [].some.call(m.addedNodes, function (n) { return !n.querySelector || !n.querySelector(".ch"); });
      });
      if (external && !h1.querySelector(".ch")) { h1.classList.remove("set"); setType(); }
    }).observe(h1, { childList: true });
  }

  /* ---------------- the premiere ---------------- */
  var seen = false;
  try { seen = sessionStorage.getItem("mcc_premiere") === "1"; } catch (e) {}
  if (CALM || seen || !h1) { setType(); }
  else {
    try { sessionStorage.setItem("mcc_premiere", "1"); } catch (e) {}
    var prem = document.createElement("div");
    prem.id = "prem";
    var words = h1.textContent.trim().split(/\s+/);
    prem.innerHTML = '<div class="in">' +
      '<img src="assets/img/m-mark.png" alt="">' +
      '<p class="k">McCluster Sound</p>' +
      '<div class="t">' + words.map(function (w, i) {
        return '<span style="animation-delay:' + (0.7 + i * 0.16) + 's">' + w + "</span>";
      }).join(" ") + "</div>" +
      '<div class="seam"></div></div>';
    document.body.appendChild(prem);
    var closed = false;
    function houseLights() {
      if (closed) return;
      closed = true;
      prem.classList.add("out");
      setTimeout(function () { prem.remove(); }, 750);
      setType();
    }
    prem.addEventListener("click", houseLights);
    setTimeout(houseLights, 2600);
  }

  /* ---------------- the cover leans toward the hand ---------------- */
  var art = document.getElementById("albArt");
  if (art && matchMedia("(hover: hover) and (pointer: fine)").matches && !CALM) {
    art.addEventListener("pointermove", function (e) {
      var r = art.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      art.classList.add("tilting");
      art.style.transform = "rotateY(" + (px * 10) + "deg) rotateX(" + (-py * 10) + "deg) translateZ(14px)";
    });
    art.addEventListener("pointerleave", function () {
      art.classList.remove("tilting");
      art.style.transform = "";
    });
  }
})();
