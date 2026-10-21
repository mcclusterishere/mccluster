/*
 * HALO VISION — the visual modes for the admin globe (CesiumJS 1.131).
 *
 * What this is: six full-screen looks for the globe, each one Cesium
 * PostProcessStage (night vision, thermal, CRT, anime, noir, snow), plus an
 * optional 3x3 unsharp-mask sharpen stage and Cesium's own built-in bloom.
 * Load it as a classic script after Cesium.js; it defines
 * window.HaloVision = { STYLES, mount }.
 *
 *   const vision = HaloVision.mount(viewer);
 *   vision.set('nvg');          // crossfades over 500 ms (instant under
 *                               // prefers-reduced-motion: reduce)
 *   vision.get();               // 'nvg'
 *   vision.setSharpen(true);    // vision.setBloom(true);
 *   vision.destroy();           // removes every stage it added, restores bloom
 *
 * A style's stage is created the first time that style is used, never before,
 * and is disabled whenever its intensity is zero, so an unused mode costs
 * nothing. While a fade runs or an animated mode is on screen the module asks
 * Cesium for a frame each animation frame (only needed, and only done, when
 * scene.requestRenderMode is on) and stops asking once the picture is still.
 * Under reduced motion the animated modes also hold still (their clock stops).
 * On small screens the night-vision and thermal blur/bloom kernels are smaller.
 * Sharpen always runs after the active style, as it did in the source.
 *
 * Credit: the shaders are adapted from God's Eye View (MIT, © 2026 Bilawal
 * Sidhu; see vendor/LICENSES/gods-eye-view-MIT.txt) via Hitman's Halo, whose
 * tuned style defaults they keep. Adaptation: Cesium 1.131 post-process
 * conventions, crossfades that fade masked edges in rather than popping them
 * to black, an arithmetic Bayer matrix in place of a 64-entry array, smaller
 * kernels on phones, a reticle sized in pixels (the original's fraction-of-
 * the-screen arms all but vanished on a portrait phone), and God's Eye
 * View's bounded snow sway.
 *
 * HONESTY — removed from the source shaders, because none of it was real:
 *   - night vision: the 7-segment HH:MM:SS clock (it counted seconds since the
 *     page loaded, not the time), the blinking REC dot (nothing records), and
 *     the "NVG / I²" and "AUTO" gain label plates;
 *   - thermal: the °C temperature digits (derived from screen brightness, not
 *     from any infrared reading), the 4-digit frame counter, the "FLIR" and
 *     WHOT/BHOT mode label plates, and the temperature scale bar.
 * What stays is the visual treatment: palettes, intensifier bloom, scanlines,
 * noise and grain, honeycomb, vignette, the lens/tube mask and the thin centre
 * reticle (it marks the point the HUD reads). "Thermal" is a palette applied
 * to the imagery's brightness; there is no infrared data anywhere in it.
 */
(function (root) {
  'use strict';

  var STYLES = Object.freeze([
    Object.freeze({ id: 'normal', label: 'Normal', key: '1' }),
    Object.freeze({ id: 'nvg', label: 'Night vision', key: '2' }),
    Object.freeze({ id: 'flir', label: 'Thermal', key: '3' }),
    Object.freeze({ id: 'crt', label: 'CRT', key: '4' }),
    Object.freeze({ id: 'anime', label: 'Anime', key: '5' }),
    Object.freeze({ id: 'noir', label: 'Noir', key: '6' }),
    Object.freeze({ id: 'snow', label: 'Snow', key: '7' })
  ]);

  var FADE_MS = 500;
  /* Wrap the shader clock so float32 keeps sub-millisecond precision in the
     noise and flicker terms however long the page stays open. */
  var TIME_WRAP_S = 1200;
  /* Phones and small tablets get the smaller blur/bloom kernels. */
  var SMALL_SCREEN_PX = 600;

  /* Values a defines block can carry into GLSL as float literals. */
  function glslFloat(n) {
    var s = String(Math.round(n * 1000) / 1000);
    return s.indexOf('.') === -1 && s.indexOf('e') === -1 ? s + '.0' : s;
  }

  function defines(map) {
    var out = '';
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) out += '#define ' + k + ' ' + map[k] + '\n';
    }
    return out;
  }

  /* ── Shared GLSL ─────────────────────────────────────────────────────── */

  var HASH_GLSL = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

  var VALUE_NOISE_GLSL = `
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

  /* ── Night vision: P43 green, intensifier bloom, tube mask ───────────── */

  function nvgShader(small) {
    var r = small ? 3 : 5;
    var scale = r / 5;
    return defines({
      NVG_R: r,
      NVG_STEP: glslFloat(20 / r),
      NVG_SIGMA2: glslFloat(18 * scale * scale)
    }) + `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float time;
uniform float gain;
uniform float bloom;
uniform float scanlineStr;
uniform float pixelation;
in vec2 v_textureCoordinates;
` + HASH_GLSL + VALUE_NOISE_GLSL + `
vec2 barrelDistort(vec2 uv, float strength) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + r2 * strength * 0.5 + r2 * r2 * strength * 0.15;
  return c * 0.5 + 0.5;
}

// Fibre-optic plate: a faint hex grid.
float honeycomb(vec2 uv) {
  vec2 dims = colorTextureDimensions;
  vec2 p = uv * dims * (min(dims.x, dims.y) * 0.008);
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float d = max(abs(gv.x), abs(gv.y * 0.577 + abs(gv.x) * 0.5));
  return smoothstep(0.4, 0.45, d);
}

// Thin centre reticle, sized in pixels so it reads the same on any aspect.
float reticle(vec2 uv) {
  vec2 c = (uv - 0.5) * colorTextureDimensions;
  float h = smoothstep(0.8, 0.32, abs(c.y)) * step(10.0, abs(c.x)) * step(abs(c.x), 26.0);
  float v = smoothstep(0.8, 0.32, abs(c.x)) * step(10.0, abs(c.y)) * step(abs(c.y), 26.0);
  return clamp(h + v, 0.0, 1.0);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 dims = colorTextureDimensions;
  vec2 texel = 1.0 / dims;
  vec3 base = texture(colorTexture, uv).rgb;

  vec2 distUV = barrelDistort(uv, 0.5 * intensity);

  // Circular tube field of view, brightest at the centre.
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= dims.x / dims.y;
  float radius = length(centered);
  float tubeMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
  float tubeShading = max(1.0 - radius * radius * 0.3, 0.0);

  if (tubeMask < 0.001 || distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
    out_FragColor = vec4(mix(base, vec3(0.0), intensity), 1.0);
    return;
  }

  float pixSize = mix(1.0, pixelation, intensity);
  vec2 snappedUV = floor(distUV * dims / pixSize) * pixSize / dims;
  distUV = mix(distUV, snappedUV, intensity);

  vec4 original = texture(colorTexture, distUV);
  float luma = dot(original.rgb, vec3(0.299, 0.587, 0.114));

  // Gain response: more gain, more amplification, noise and bloom.
  float gainLevel = mix(0.8, 2.5, gain);
  float amplified = pow(clamp(luma * gainLevel, 0.0, 1.0), mix(1.2, 0.7, gain));

  // Intensifier bloom around bright sources.
  float bloomAccum = 0.0;
  float bloomW = 0.0;
  for (int y = -NVG_R; y <= NVG_R; y++) {
    for (int x = -NVG_R; x <= NVG_R; x++) {
      vec2 offset = vec2(float(x), float(y)) * texel * NVG_STEP;
      float sLuma = dot(texture(colorTexture, distUV + offset).rgb, vec3(0.299, 0.587, 0.114));
      float bright = smoothstep(0.4, 0.9, sLuma * gainLevel);
      float w = exp(-float(x * x + y * y) / NVG_SIGMA2);
      bloomAccum += bright * w;
      bloomW += w;
    }
  }
  bloomAccum /= bloomW;
  float corona = bloomAccum * bloom * 1.5;

  vec3 phosphor = vec3(0.16, 1.0, 0.22);
  vec3 nvgColor = phosphor * (amplified + corona);

  // Scintillation: slow tube grain plus sparkle in the dark areas.
  vec2 grainCoord = uv * 120.0 + vec2(time * 0.5, time * 0.3);
  float tubeGrain = (valueNoise(grainCoord) - 0.5) * mix(0.06, 0.2, gain) * intensity;
  nvgColor += phosphor * tubeGrain;
  float darkNoise = (1.0 - amplified) * hash(uv * dims + vec2(time * 200.0, time * 300.0));
  nvgColor += phosphor * darkNoise * 0.08 * gain * intensity;

  nvgColor *= 1.0 - honeycomb(distUV) * 0.04 * intensity;

  float scanline = pow(sin(distUV.y * dims.y * 1.2 + time * 2.0) * 0.5 + 0.5, 2.5);
  nvgColor *= 1.0 - scanline * scanlineStr * 0.15 * intensity;

  nvgColor *= tubeShading;
  nvgColor *= tubeMask;

  nvgColor += phosphor * reticle(uv) * 0.4 * intensity;

  nvgColor = clamp(nvgColor, 0.0, 1.0);
  out_FragColor = vec4(mix(original.rgb, nvgColor * tubeMask, intensity), 1.0);
}
`;
  }

  /* ── Thermal look: brightness mapped to a white-hot palette ──────────── */

  function flirShader(small) {
    var blurR = small ? 1 : 2;
    var bloomR = small ? 2 : 4;
    return defines({
      HEAT_BLUR_R: blurR,
      HEAT_BLUR_STEP: glslFloat(3 / blurR),
      HEAT_BLUR_SIGMA2: glslFloat(2 * (blurR / 2) * (blurR / 2)),
      HEAT_BLOOM_R: bloomR,
      HEAT_BLOOM_STEP: glslFloat(12 / bloomR),
      HEAT_BLOOM_SIGMA2: glslFloat(8 * (bloomR / 4) * (bloomR / 4))
    }) + `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float time;
uniform float sensitivity;
uniform float bloom;
uniform float mode;
uniform float pixelation;
uniform float palette;
in vec2 v_textureCoordinates;

// Ironbow ramp: black, purple, magenta, red, orange, yellow, white.
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.0, 0.0, 0.0);
  const vec3 c1 = vec3(0.13, 0.0, 0.30);
  const vec3 c2 = vec3(0.49, 0.0, 0.45);
  const vec3 c3 = vec3(0.86, 0.10, 0.18);
  const vec3 c4 = vec3(1.0, 0.55, 0.0);
  const vec3 c5 = vec3(1.0, 0.91, 0.32);
  const vec3 c6 = vec3(1.0, 1.0, 1.0);
  float s = t * 6.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  if (s < 4.0) return mix(c3, c4, s - 3.0);
  if (s < 5.0) return mix(c4, c5, s - 4.0);
  return mix(c5, c6, s - 5.0);
}
` + HASH_GLSL + VALUE_NOISE_GLSL + `
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p = p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

// Centre reticle, sized in pixels so it reads the same on any aspect.
float reticle(vec2 uv) {
  vec2 c = (uv - 0.5) * colorTextureDimensions;
  float h = smoothstep(1.2, 0.4, abs(c.y)) * step(15.0, abs(c.x)) * step(abs(c.x), 40.0);
  float v = smoothstep(1.2, 0.4, abs(c.x)) * step(15.0, abs(c.y)) * step(abs(c.y), 40.0);
  return clamp(h + v, 0.0, 1.0);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 dims = colorTextureDimensions;
  vec2 texel = 1.0 / dims;
  vec2 screenUV = uv;
  vec3 base = texture(colorTexture, uv).rgb;

  // Circular lens field of view.
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= dims.x / dims.y;
  float radius = length(centered);
  float lensMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
  float lensShading = max(1.0 - radius * radius * 0.25, 0.0);

  if (lensMask < 0.001) {
    out_FragColor = vec4(mix(base, vec3(0.0), intensity), 1.0);
    return;
  }

  float pixSize = mix(1.0, pixelation, intensity);
  vec2 snappedUV = floor(uv * dims / pixSize) * pixSize / dims;
  uv = mix(uv, snappedUV, intensity);

  // Soft, low-resolution blur.
  vec3 blurred = vec3(0.0);
  float totalWeight = 0.0;
  for (int y = -HEAT_BLUR_R; y <= HEAT_BLUR_R; y++) {
    for (int x = -HEAT_BLUR_R; x <= HEAT_BLUR_R; x++) {
      float w = exp(-0.5 * float(x * x + y * y) / HEAT_BLUR_SIGMA2);
      blurred += texture(colorTexture, uv + vec2(float(x), float(y)) * texel * HEAT_BLUR_STEP).rgb * w;
      totalWeight += w;
    }
  }
  blurred /= totalWeight;
  vec4 original = texture(colorTexture, uv);
  vec3 src = mix(original.rgb, blurred, 0.6 * intensity);

  // Brightness to palette position (the picture's brightness, not heat).
  float luma = dot(src, vec3(0.299, 0.587, 0.114));
  float sens = mix(0.25, 1.0, sensitivity);
  float level = clamp((luma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);

  // Contour banding.
  float bandLine = abs(fract(level * 12.0) - 0.5);
  float contour = smoothstep(0.04, 0.06, bandLine);
  level *= mix(1.0, contour * 0.85 + 0.15, 0.3 * intensity);

  float isBlackHot = step(0.5, mode);
  float mono = mix(level, 1.0 - level, isBlackHot);
  vec3 heatColor = mix(vec3(mono), ironbow(level), palette);

  // Bloom on the brightest palette values.
  float bloomSample = 0.0;
  float bloomWeight = 0.0;
  for (int y = -HEAT_BLOOM_R; y <= HEAT_BLOOM_R; y++) {
    for (int x = -HEAT_BLOOM_R; x <= HEAT_BLOOM_R; x++) {
      vec2 offset = vec2(float(x), float(y)) * texel * HEAT_BLOOM_STEP;
      float sLuma = dot(texture(colorTexture, uv + offset).rgb, vec3(0.299, 0.587, 0.114));
      float sMapped = clamp((sLuma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);
      float sFinal = mix(sMapped, 1.0 - sMapped, isBlackHot);
      float w = exp(-0.5 * float(x * x + y * y) / HEAT_BLOOM_SIGMA2);
      bloomSample += smoothstep(0.6, 1.0, sFinal) * w;
      bloomWeight += w;
    }
  }
  heatColor += (bloomSample / bloomWeight) * bloom * 0.8;

  // Slowly drifting, cloud-like noise.
  float noise = fbm(uv * 80.0 + vec2(time * 0.3, time * 0.2));
  heatColor += (noise - 0.5) * 0.08 * intensity;

  heatColor += reticle(screenUV) * 0.42 * intensity;

  heatColor *= lensShading;
  heatColor *= lensMask;
  heatColor = clamp(heatColor, 0.0, 1.0);

  vec3 finalColor = mix(original.rgb, heatColor, intensity);
  finalColor *= mix(1.0, lensMask, intensity);
  out_FragColor = vec4(finalColor, 1.0);
}
`;
  }

  /* ── CRT: pixel grid, dithering, scanlines, jitter, phosphor tint ────── */

  var CRT_SHADER = `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float time;
uniform float pixelation;
uniform float distortion;
uniform float instability;
in vec2 v_textureCoordinates;
` + HASH_GLSL + `
// 8x8 ordered (Bayer) dither, computed rather than looked up: the same
// matrix as the 64-entry table, with no array for a phone GPU to index.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec2 barrelDistort(vec2 uv, float strength) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  centered *= 1.0 + r2 * strength * 0.4;
  return centered * 0.5 + 0.5;
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 dims = colorTextureDimensions;
  vec2 texel = 1.0 / dims;
  vec3 base = texture(colorTexture, uv).rgb;

  vec2 distUV = barrelDistort(uv, distortion * intensity);
  if (distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
    out_FragColor = vec4(mix(base, vec3(0.0), intensity), 1.0);
    return;
  }

  // Sparse horizontal line jitter.
  float lineY = floor(distUV.y * dims.y);
  float jitterSeed = hash(vec2(lineY, floor(time * 8.0)));
  float jitterActive = step(0.97 - instability * 0.04, jitterSeed);
  float jitterAmount = (hash(vec2(lineY * 7.0, floor(time * 12.0))) - 0.5) * 0.008 * instability * jitterActive * intensity;
  vec2 jitteredUV = distUV + vec2(jitterAmount, 0.0);

  // Chromatic aberration.
  vec2 centered = jitteredUV - 0.5;
  float caStrength = length(centered) * 0.008 * intensity;
  float r = texture(colorTexture, jitteredUV + centered * caStrength).r;
  float g = texture(colorTexture, jitteredUV).g;
  float b = texture(colorTexture, jitteredUV - centered * caStrength).b;
  vec4 color = vec4(r, g, b, 1.0);

  float pixSize = mix(1.0, pixelation, intensity);
  vec2 pixelUV = floor(jitteredUV * dims / pixSize) * pixSize / dims;
  vec4 pixelColor = texture(colorTexture, mix(jitteredUV, pixelUV, intensity));
  color = mix(color, pixelColor, 0.7 * intensity);

  float dither = bayer8(jitteredUV * dims / pixSize) - 0.5;
  vec3 dithered = color.rgb + dither * 0.12 * intensity;

  float levels = mix(256.0, 10.0, intensity);
  vec3 posterized = floor(dithered * levels + 0.5) / levels;

  float gray = dot(posterized, vec3(0.299, 0.587, 0.114));
  vec3 saturated = mix(vec3(gray), posterized, 1.0 + 0.3 * intensity);

  // RGB shadow-mask stripes, visible once the pixels are large.
  float subpixelX = mod(distUV.x * dims.x, 3.0);
  vec3 subpixelMask = vec3(
    smoothstep(0.0, 0.8, 1.0 - abs(subpixelX - 0.5)),
    smoothstep(0.0, 0.8, 1.0 - abs(subpixelX - 1.5)),
    smoothstep(0.0, 0.8, 1.0 - abs(subpixelX - 2.5))
  );
  float subpixelStrength = smoothstep(2.0, 6.0, pixSize) * 0.3 * intensity;
  vec3 withSubpixels = mix(saturated, saturated * (subpixelMask * 0.7 + 0.3), subpixelStrength);

  vec2 pixelCenter = fract(distUV * dims / pixSize);
  float blockEdge = smoothstep(0.0, 0.08, min(min(pixelCenter.x, 1.0 - pixelCenter.x), min(pixelCenter.y, 1.0 - pixelCenter.y)));
  vec3 result = withSubpixels * mix(1.0, blockEdge * 0.15 + 0.85, intensity);

  // Rolling scanlines.
  float scanline = pow(sin(distUV.y * dims.y + time * 2.5) * 0.5 + 0.5, 1.5);
  float scanFade = 0.35 * intensity;
  result *= mix(1.0, scanline * scanFade + (1.0 - scanFade), intensity);

  // Phosphor persistence: a dim trailing ghost.
  vec3 ghost = texture(colorTexture, jitteredUV - vec2(texel.x * 2.0, 0.0)).rgb;
  float ghostGray = dot(ghost, vec3(0.299, 0.587, 0.114));
  result = mix(result, result + vec3(ghostGray) * 0.08, instability * intensity);

  // Very slight flicker.
  float flicker = sin(time * 188.5) * 0.5 + 0.5;
  result *= 1.0 - flicker * 0.03 * instability * intensity;

  // Rare bright glitch line.
  float glitchSeed = hash(vec2(floor(time * 2.0), 0.0));
  if (step(0.92 - instability * 0.08, glitchSeed) > 0.0) {
    float glitchY = hash(vec2(floor(time * 2.0), 1.0));
    float glitchHit = 1.0 - smoothstep(0.0, 0.003, abs(distUV.y - glitchY));
    result += glitchHit * 0.3 * instability * intensity;
  }

  // Warm phosphor tint and curved-glass vignette.
  result = mix(result, result * vec3(1.02, 1.0, 0.94), 0.4 * intensity);
  vec2 vigUV = distUV * (1.0 - distUV);
  float vig = clamp(pow(vigUV.x * vigUV.y * 20.0, 0.25 + 0.15 * intensity), 0.0, 1.0);
  result *= mix(1.0, vig, 0.6 * intensity);

  out_FragColor = vec4(mix(base, result, intensity), 1.0);
}
`;

  /* ── Anime: cel bands, saturation, soft outlines, warm shift ─────────── */

  var ANIME_SHADER = `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float saturation;
uniform float edgeThick;
in vec2 v_textureCoordinates;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 texel = 1.0 / colorTextureDimensions;
  vec4 color = texture(colorTexture, uv);

  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float bands = mix(256.0, 4.0, intensity);
  float celLuma = floor(luma * bands + 0.5) / bands;
  float lumaScale = (luma > 0.001) ? celLuma / luma : 1.0;
  vec3 celColor = color.rgb * lumaScale;

  vec3 hsv = rgb2hsv(celColor);
  hsv.y = min(hsv.y * (1.0 + 0.6 * intensity * saturation), 1.0);
  hsv.z = min(hsv.z * (1.0 + 0.1 * intensity), 1.0);
  vec3 saturated = hsv2rgb(hsv);

  vec4 left = texture(colorTexture, uv + vec2(-texel.x, 0.0));
  vec4 right = texture(colorTexture, uv + vec2(texel.x, 0.0));
  vec4 up = texture(colorTexture, uv + vec2(0.0, texel.y));
  vec4 down = texture(colorTexture, uv + vec2(0.0, -texel.y));
  float edgeH = length(right.rgb - left.rgb);
  float edgeV = length(up.rgb - down.rgb);
  float edge = sqrt(edgeH * edgeH + edgeV * edgeV);
  float outline = 1.0 - smoothstep(0.05, mix(0.35, 0.1, edgeThick), edge) * 0.6 * intensity;

  vec3 result = saturated * vec3(1.02, 1.0, 0.95) * outline;
  out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
}
`;

  /* ── Noir: desaturated, contrasty, grain, vignette, a touch of sepia ─── */

  var NOIR_SHADER = `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float contrastAmt;
uniform float grainAmt;
uniform float vignetteAmt;
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);

  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 desaturated = mix(color.rgb, vec3(luma), intensity);

  float contrast = 1.0 + contrastAmt * intensity;
  vec3 contrasted = clamp((desaturated - 0.5) * contrast + 0.5, 0.0, 1.0);

  float grain = fract(sin(dot(uv * colorTextureDimensions, vec2(12.9898, 78.233))) * 43758.5453);
  contrasted += (grain - 0.5) * 0.08 * grainAmt * intensity;

  vec2 vigUV = uv * (1.0 - uv);
  float vig = pow(vigUV.x * vigUV.y * 16.0, 0.3 + 0.4 * vignetteAmt * intensity);

  vec3 sepia = vec3(
    dot(contrasted, vec3(0.393, 0.769, 0.189)),
    dot(contrasted, vec3(0.349, 0.686, 0.168)),
    dot(contrasted, vec3(0.272, 0.534, 0.131))
  );
  vec3 result = mix(contrasted, sepia, 0.15 * intensity) * vig;
  out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
}
`;

  /* ── Snow: cool grade, frost, layered falling flakes, low fog ────────── */

  var SNOW_SHADER = `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float intensity;
uniform float time;
uniform float density;
uniform float wind;
in vec2 v_textureCoordinates;

float flakeHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float snowLayer(vec2 uv, float layer) {
  float depth = 0.5 + layer * 0.5;
  float speed = 0.4 + layer * 0.3;
  float size = mix(0.01, 0.025, layer);
  float windForce = 0.05 + wind * 0.2;

  vec2 snowUV = uv * vec2(1.0, 0.5) * (4.0 + layer * 4.0);
  snowUV.y += time * speed;
  // The integral of a swaying velocity, so the sway stays bounded over time.
  snowUV.x -= 2.0 * cos(time * 0.5 + layer * 3.14) * windForce;

  vec2 cell = floor(snowUV);
  vec2 f = fract(snowUV);
  float snow = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 point = vec2(flakeHash(cell + neighbor), flakeHash(cell + neighbor + 100.0));
      point = 0.5 + 0.4 * sin(time * 0.3 + 6.2831 * point);
      float d = length(f - neighbor - point);
      snow += smoothstep(size, 0.0, d) * depth;
    }
  }
  return snow;
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);

  vec3 cool = color.rgb * vec3(0.85, 0.9, 1.1);
  float luma = dot(cool, vec3(0.299, 0.587, 0.114));
  vec3 desaturated = mix(cool, vec3(luma), 0.4 * intensity);
  vec3 brightened = mix(desaturated, vec3(1.0), 0.15 * intensity);
  float frostMask = smoothstep(0.3, 0.8, luma);
  vec3 frosted = mix(brightened, vec3(0.95, 0.97, 1.0), frostMask * 0.25 * intensity);

  float snow = 0.0;
  snow += snowLayer(uv, 0.0) * 0.5;
  snow += snowLayer(uv, 0.25) * 0.6;
  snow += snowLayer(uv, 0.5) * 0.7;
  snow += snowLayer(uv, 0.75) * 0.8;
  snow += snowLayer(uv, 1.0) * 1.0;
  snow = clamp(snow * (0.4 + density * 1.2), 0.0, 1.0);

  vec3 result = frosted + snow * 0.8 * intensity;
  float fog = smoothstep(0.0, 0.4, 1.0 - uv.y) * 0.1 * intensity;
  result = mix(result, vec3(0.85, 0.88, 0.95), fog);

  out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
}
`;

  /* ── Sharpen: 3x3 unsharp mask (God's Eye View visualPresets) ────────── */

  var SHARPEN_SHADER = `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float amount;
in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 texel = 1.0 / colorTextureDimensions;
  vec4 center = texture(colorTexture, uv);
  vec4 blur = (
    texture(colorTexture, uv + vec2(-texel.x, -texel.y)) +
    texture(colorTexture, uv + vec2(0.0, -texel.y)) +
    texture(colorTexture, uv + vec2(texel.x, -texel.y)) +
    texture(colorTexture, uv + vec2(-texel.x, 0.0)) +
    center +
    texture(colorTexture, uv + vec2(texel.x, 0.0)) +
    texture(colorTexture, uv + vec2(-texel.x, texel.y)) +
    texture(colorTexture, uv + vec2(0.0, texel.y)) +
    texture(colorTexture, uv + vec2(texel.x, texel.y))
  ) / 9.0;
  vec4 sharpened = center + (center - blur) * amount;
  out_FragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), center.a);
}
`;

  /* Each style: its shader (small-screen aware where it matters), whether it
     animates (gets a `time` uniform), and the tuned defaults Hitman's Halo
     applied when the style was picked. */
  var STYLE_DEFS = {
    nvg: { shader: nvgShader, animated: true, uniforms: { gain: 0.18, bloom: 0.22, scanlineStr: 0.96, pixelation: 1.0 } },
    flir: { shader: flirShader, animated: true, uniforms: { sensitivity: 0.85, bloom: 0.2, mode: 0.0, pixelation: 1.0, palette: 0.0 } },
    crt: { shader: function () { return CRT_SHADER; }, animated: true, uniforms: { pixelation: 1.0, distortion: 0.0, instability: 0.42 } },
    anime: { shader: function () { return ANIME_SHADER; }, animated: false, uniforms: { saturation: 1.0, edgeThick: 0.5 } },
    noir: { shader: function () { return NOIR_SHADER; }, animated: false, uniforms: { contrastAmt: 1.2, grainAmt: 0.5, vignetteAmt: 0.5 } },
    snow: { shader: function () { return SNOW_SHADER; }, animated: true, uniforms: { density: 0.6, wind: 0.5 } }
  };

  /* Sharpen at Hitman's Halo's default 49 %: amount = 0.1 + 0.49 × 2. */
  var SHARPEN_AMOUNT = 1.08;
  /* Cesium bloom, tuned like Hitman's Halo's slider at its midpoint (100 of
     200): only the brightest highlights glow, with a soft, wide halo. */
  var BLOOM_UNIFORMS = { glowOnly: false, contrast: 179, brightness: -0.34, delta: 1.2, sigma: 3.1, stepSize: 1.5 };
  var BLOOM_KEYS = ['glowOnly', 'contrast', 'brightness', 'delta', 'sigma', 'stepSize'];

  var mountCount = 0;

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function isStyle(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return true;
    return false;
  }

  function mount(viewer) {
    if (!viewer || !viewer.scene || !viewer.scene.postProcessStages) {
      throw new TypeError('HaloVision.mount needs a Cesium Viewer');
    }
    var scene = viewer.scene;
    var collection = scene.postProcessStages;
    var seq = ++mountCount;
    var stages = {};        // style id -> PostProcessStage (created on first use)
    var order = [];         // style ids in creation order
    var fades = {};         // style id -> { start, from, to }
    var active = 'normal';
    var sharpenOn = false;
    var sharpenStage = null;
    var sharpenSerial = 0;
    var bloomSaved = null;  // the host's bloom state, captured on first touch
    var frame = null;
    var frameByTimer = false;
    var destroyed = false;
    var clockBase = now();
    var clockHeldAt = null; // set while reduced motion holds the clock still

    function now() {
      var perf = root.performance;
      return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
    }

    function reducedMotion() {
      try {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) {
        return false;
      }
    }

    function smallScreen() {
      var canvas = scene.canvas || {};
      var w = canvas.clientWidth || canvas.width || 0;
      var h = canvas.clientHeight || canvas.height || 0;
      return w > 0 && h > 0 && Math.min(w, h) < SMALL_SCREEN_PX;
    }

    function cesium() {
      var C = root.Cesium;
      if (!C || typeof C.PostProcessStage !== 'function') throw new Error('HaloVision needs the Cesium global');
      return C;
    }

    function requestRender() {
      if (scene.requestRenderMode && typeof scene.requestRender === 'function') scene.requestRender();
    }

    function shaderSeconds() {
      var t = clockHeldAt !== null ? clockHeldAt : now();
      return ((t - clockBase) / 1000) % TIME_WRAP_S;
    }

    function createSharpen() {
      var C = cesium();
      var stage = new C.PostProcessStage({
        name: 'halo_vision_sharpen_' + seq + '_' + (++sharpenSerial),
        fragmentShader: SHARPEN_SHADER,
        uniforms: { amount: SHARPEN_AMOUNT }
      });
      stage.enabled = sharpenOn;
      collection.add(stage);
      sharpenStage = stage;
    }

    function ensureStage(id) {
      if (stages[id]) return stages[id];
      var C = cesium();
      var def = STYLE_DEFS[id];
      var uniforms = { intensity: 0.0 };
      if (def.animated) uniforms.time = shaderSeconds();
      for (var k in def.uniforms) uniforms[k] = def.uniforms[k];
      var stage = new C.PostProcessStage({
        name: 'halo_vision_' + id + '_' + seq,
        fragmentShader: def.shader(smallScreen()),
        uniforms: uniforms
      });
      stage.enabled = false;
      collection.add(stage);
      stages[id] = stage;
      order.push(id);
      // Sharpen runs after the style, as in the source: a stage cannot be
      // moved, so a live sharpen stage is rebuilt behind the new one.
      if (sharpenStage) {
        collection.remove(sharpenStage);
        sharpenStage = null;
        createSharpen();
      }
      return stage;
    }

    function setIntensity(id, value) {
      var stage = stages[id];
      if (!stage) return;
      stage.uniforms.intensity = value;
      stage.enabled = value > 0.001;
    }

    function fading() {
      for (var k in fades) if (Object.prototype.hasOwnProperty.call(fades, k)) return true;
      return false;
    }

    function animatedVisible() {
      for (var i = 0; i < order.length; i++) {
        var id = order[i];
        if (STYLE_DEFS[id].animated && stages[id].enabled) return true;
      }
      return false;
    }

    function tick() {
      frame = null;
      if (destroyed) return;
      var t = now();
      for (var id in fades) {
        if (!Object.prototype.hasOwnProperty.call(fades, id)) continue;
        var f = fades[id];
        var p = Math.min((t - f.start) / FADE_MS, 1);
        setIntensity(id, f.from + (f.to - f.from) * easeInOut(p));
        if (p >= 1) {
          setIntensity(id, f.to);
          delete fades[id];
        }
      }
      var seconds = shaderSeconds();
      for (var i = 0; i < order.length; i++) {
        var s = stages[order[i]];
        if (STYLE_DEFS[order[i]].animated && s.enabled) s.uniforms.time = seconds;
      }
      requestRender();
      schedule();
    }

    function schedule() {
      if (destroyed || frame !== null) return;
      var moving = clockHeldAt === null && animatedVisible();
      if (!fading() && !moving) return; // still picture: stop asking for frames
      if (typeof root.requestAnimationFrame === 'function') {
        frameByTimer = false;
        frame = root.requestAnimationFrame(tick);
      } else {
        frameByTimer = true;
        frame = setTimeout(tick, 16);
      }
    }

    /* Reduced motion holds the animated styles' clock still; letting go of
       it resumes the clock where it stopped. */
    function holdClock(hold) {
      if (hold && clockHeldAt === null) {
        clockHeldAt = now();
      } else if (!hold && clockHeldAt !== null) {
        clockBase += now() - clockHeldAt;
        clockHeldAt = null;
      }
    }

    var motionQuery = null;
    function onMotionChange() {
      if (destroyed) return;
      holdClock(reducedMotion());
      schedule();
    }
    try {
      motionQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (motionQuery && typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotionChange);
      else if (motionQuery && typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotionChange);
    } catch (e) {
      motionQuery = null;
    }

    function set(id) {
      if (destroyed || !isStyle(id)) return false;
      var reduce = reducedMotion();
      holdClock(reduce);
      active = id;
      if (id !== 'normal') ensureStage(id);
      var t = now();
      for (var i = 0; i < order.length; i++) {
        var sid = order[i];
        var target = sid === id ? 1 : 0;
        var current = stages[sid].uniforms.intensity;
        if (reduce) {
          delete fades[sid];
          setIntensity(sid, target);
        } else if (fades[sid] && fades[sid].to === target) {
          // already on its way there
        } else if (current !== target) {
          fades[sid] = { start: t, from: current, to: target };
        } else {
          delete fades[sid];
        }
      }
      if (reduce) {
        var seconds = shaderSeconds();
        for (var j = 0; j < order.length; j++) {
          if (STYLE_DEFS[order[j]].animated) stages[order[j]].uniforms.time = seconds;
        }
      }
      requestRender();
      schedule();
      return true;
    }

    function get() {
      return active;
    }

    function setSharpen(on) {
      if (destroyed) return;
      sharpenOn = !!on;
      if (sharpenOn && !sharpenStage) createSharpen();
      if (sharpenStage) sharpenStage.enabled = sharpenOn;
      requestRender();
    }

    function setBloom(on) {
      if (destroyed) return;
      var bloom = collection.bloom;
      if (!bloom) return;
      if (!bloomSaved) {
        bloomSaved = { enabled: bloom.enabled, uniforms: {} };
        for (var i = 0; i < BLOOM_KEYS.length; i++) bloomSaved.uniforms[BLOOM_KEYS[i]] = bloom.uniforms[BLOOM_KEYS[i]];
      }
      if (on) {
        for (var k in BLOOM_UNIFORMS) bloom.uniforms[k] = BLOOM_UNIFORMS[k];
      }
      bloom.enabled = !!on;
      requestRender();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) {
        if (frameByTimer) clearTimeout(frame);
        else if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(frame);
      }
      frame = null;
      if (motionQuery) {
        try {
          if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', onMotionChange);
          else if (typeof motionQuery.removeListener === 'function') motionQuery.removeListener(onMotionChange);
        } catch (e) { /* nothing to undo */ }
      }
      fades = {};
      for (var i = 0; i < order.length; i++) collection.remove(stages[order[i]]);
      if (sharpenStage) collection.remove(sharpenStage);
      stages = {};
      order = [];
      sharpenStage = null;
      if (bloomSaved && collection.bloom) {
        for (var k in bloomSaved.uniforms) collection.bloom.uniforms[k] = bloomSaved.uniforms[k];
        collection.bloom.enabled = bloomSaved.enabled;
      }
      bloomSaved = null;
      active = 'normal';
      requestRender();
    }

    return { set: set, get: get, setSharpen: setSharpen, setBloom: setBloom, destroy: destroy };
  }

  root.HaloVision = { STYLES: STYLES, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
