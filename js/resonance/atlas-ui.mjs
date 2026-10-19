/* Resonance Atlas: browser-only opt-in analysis, canonical MCC_MUSIC playback.
 * There is no second audio element, server upload, inferred personality, or gene claim.
 */
import { analyzePcm, analyzeTrackouts, modes } from "./core.mjs";

const $ = id => document.getElementById(id);
const status = $("rsStatus");
const canvas = $("rsField");
const ctx = canvas.getContext("2d", {alpha:false});
const engine = window.MCC_MUSIC;
const WIDTH = canvas.width, HEIGHT = canvas.height;
const MODEL_MODES = modes();
const MAX_BROWSER_SECONDS = 45;
const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
let catalogue = [], selection = null, activeAnalysis = null, currentFrame = -1;
let sourceIdentity = null, liveEngine = false, running = false;
let context = null;

function setStatus(message) { status.textContent = message; }

function makeBasis() {
  // Precompute the basis. A clear visual contour is not a measured vibration field.
  const basis = MODEL_MODES.map(mode => {
    const data = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      data[y * WIDTH + x] =
        Math.sin(Math.PI * mode.m * (x + 0.5) / WIDTH) *
        Math.sin(Math.PI * mode.n * (y + 0.5) / HEIGHT);
    }
    return data;
  });
  return basis;
}
const BASIS = makeBasis();

function draw(weights) {
  if (!ctx) return;
  const w = Array.isArray(weights) && weights.length === MODEL_MODES.length
    ? weights : MODEL_MODES.map((_, i) => i === 0 ? 1 : 0);
  const image = ctx.createImageData(WIDTH, HEIGHT);
  const norm = Math.max(1, Math.sqrt(w.reduce((s, n) => s + Number(n || 0), 0)));
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
    let elevation = 0;
    for (let j = 0; j < w.length; j++) {
      if (w[j] > 0.001) elevation += BASIS[j][pixel] * w[j];
    }
    elevation /= norm;
    const nodal = Math.max(0, 1 - Math.abs(elevation) / 0.055);
    const movement = Math.min(1, Math.abs(elevation));
    const k = pixel * 4;
    image.data[k] = Math.round(33 + 112 * nodal + 66 * movement);
    image.data[k+1] = Math.round(36 + 99 * nodal + 46 * movement);
    image.data[k+2] = Math.round(33 + 74 * nodal + 31 * movement);
    image.data[k+3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function metrics(frame) {
  $("rsPeak").textContent = frame.peakHz ? String(Math.round(frame.peakHz)) : "—";
  $("rsCentroid").textContent = frame.centroidHz ? String(Math.round(frame.centroidHz)) : "—";
  $("rsLow").textContent = (100 * frame.lowBandFraction).toFixed(1) + "%";
  $("rsFlatness").textContent = frame.spectralFlatness.toFixed(2);
}

function paintModes(weights) {
  const target = $("rsModeList");
  target.replaceChildren();
  const ranked = MODEL_MODES.map((m, i) => ({...m, weight: weights[i] || 0}))
    .sort((a,b) => b.weight - a.weight || a.hz - b.hz).slice(0,6);
  for (const mode of ranked) {
    const row = document.createElement("div"); row.className = "rs-mode";
    const label = document.createElement("span"); label.textContent = "(" + mode.m + "," + mode.n + ")";
    const meter = document.createElement("meter"); meter.min=0; meter.max=1; meter.value=mode.weight;
    meter.setAttribute("aria-label", "Relative modal drive");
    const freq = document.createElement("small"); freq.textContent = Math.round(mode.hz) + " Hz";
    row.append(label,meter,freq);target.append(row);
  }
}

function frameIndex(result, seconds) {
  const f = result.frames;
  if (!f?.length) return 0;
  let match = 0, closest = Infinity;
  for (let i = 0; i < f.length; i++) {
    const delta = Math.abs(f[i].atSeconds - seconds);
    if (delta < closest) {closest=delta;match=i;}
  }
  return match;
}

function renderAt(seconds) {
  if (!activeAnalysis?.frames?.length) return;
  const i = frameIndex(activeAnalysis, seconds);
  if (i === currentFrame) return;
  currentFrame = i;
  const frame = activeAnalysis.frames[i];
  draw(frame.weights);
  metrics(frame);
  paintModes(frame.weights);
  const label = document.querySelector(".rs-visual-overlay span");
  if (label) label.textContent = frame.atSeconds.toFixed(1) + " s / SIMULATED";
}

function setAnalysis(analysis, identity, tiedToEngine) {
  activeAnalysis = analysis; sourceIdentity = identity; liveEngine = tiedToEngine;
  currentFrame = -1;
  renderAt(0);
}

function chooseContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw Error("Web Audio decoding is not supported in this browser");
  if (!context) context = new AudioContext();
  return context;
}

function mono(buffer) {
  const rate = buffer.sampleRate;
  const length = Math.min(buffer.length, Math.floor(rate * MAX_BROWSER_SECONDS));
  if (length < 256) throw Error("Audio shorter than the analysis window");
  const samples = new Float32Array(length);
  const channels = Math.min(8, buffer.numberOfChannels);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) samples[i] += data[i] / channels;
  }
  return {samples,sampleRate:rate};
}

async function decode(blob) {
  const a = chooseContext();
  const audio = await blob.arrayBuffer();
  const decoded = await a.decodeAudioData(audio.slice(0));
  return mono(decoded);
}

async function fileAnalysis(files, stems) {
  if (!files.length || files.length > MAX_FILES || files.some(f => !f.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(f.name))) {
    throw Error("Select between 1 and 8 supported audio files");
  }
  if (!stems && files.length !== 1) throw Error("Choose one complete mix");
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
    throw Error("The selected files exceed the local 40 MiB browser limit");
  }
  const results = [];
  for (const file of files) {
    setStatus("Locally decoding " + file.name + " (nothing is uploaded)…");
    results.push({name:file.name, ...(await decode(file))});
  }
  const grouped = stems ? analyzeTrackouts(results,{maxSeconds:MAX_BROWSER_SECONDS})
    : null;
  setAnalysis(stems ? grouped.combined : analyzePcm(results[0].samples, results[0].sampleRate,
    {maxSeconds:MAX_BROWSER_SECONDS}), "local", false);
  if (grouped) {
    const named = grouped.stems.map(s => s.name).join(", ");
    $("rsStemSummary").textContent = results.length + " aligned input(s), equal gain: " + named +
      ". Phase and alignment are retained for the estimated sum, but original mixer gains and processing are unknown.";
  } else $("rsStemSummary").textContent = "One complete audio mix; no stem separation is inferred.";
  setStatus("Analyzed first " + Math.min(MAX_BROWSER_SECONDS,
    results[0].samples.length/results[0].sampleRate).toFixed(1) +
    " seconds locally. The field is a mathematical response of an ideal membrane, not a recorded cymatic experiment.");
}

async function publicTrackAnalysis(entry) {
  if (!entry || entry.track.gated) throw Error("Gated recordings cannot be independently decoded here");
  const audioUrl = new URL(entry.track.src || "", location.href);
  if (audioUrl.origin !== location.origin || !/^\/assets\/audio\/[^?]+$/i.test(audioUrl.pathname)) {
    throw Error("Only published same-origin catalogue audio can be independently analyzed");
  }
  const response = await fetch(audioUrl.href, {credentials:"same-origin",cache:"force-cache"});
  if (!response.ok) throw Error("Published audio unavailable (" + response.status + ")");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_TOTAL_BYTES) throw Error("This audio exceeds the on-device analysis cap");
  const blob = await response.blob();
  if (blob.size > MAX_TOTAL_BYTES) throw Error("This audio exceeds the on-device analysis cap");
  const pcm = await decode(blob);
  const analysis = analyzePcm(pcm.samples, pcm.sampleRate,{maxSeconds:MAX_BROWSER_SECONDS});
  setAnalysis(analysis, entry.album.slug + ":" + entry.track.title, true);
  $("rsStemSummary").textContent = "Published McCluster catalogue · complete mix. No separate audio player or gated master was loaded.";
  setStatus("Audio decoded locally from the published file. Pattern moves with the canonical Music playhead. Only the first 45 seconds are modeled in this prototype.");
}

async function beginTrack(entry, origin) {
  if (!engine?.play) throw Error("The canonical Music engine is unavailable");
  if (!entry) throw Error("Pick a published track first");
  selection = entry;
  const identity = entry.album.slug + ":" + entry.track.title;
  sourceIdentity = identity;
  liveEngine = false;
  // Do not start a second player. The canonical transport handles access checks,
  // progress, media session, and play accounting.
  const play = engine.play(entry.album.slug, entry.track.title, false, origin);
  setStatus("Playing through McCluster Music; preparing local resonance analysis…");
  try { await Promise.all([play, publicTrackAnalysis(entry)]); }
  catch (error) {setStatus("Playback or visual analysis unavailable: " + error.message);}
}

function selectEntries(data) {
  catalogue = [];
  for (const album of Array.isArray(data?.albums)?data.albums:[]) {
    for (const track of Array.isArray(album.tracks)?album.tracks:[]) {
      if (track.gated || !track.src || !/^assets\/audio\/[a-z0-9_.-]+\.(mp3|wav|ogg)$/i.test(track.src)) continue;
      catalogue.push({album,track});
    }
  }
  const select = $("rsTrack");
  select.replaceChildren();
  for (let i = 0; i < catalogue.length; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = catalogue[i].album.name + " / " + catalogue[i].track.title;
    select.appendChild(option);
  }
  $("rsPlay").disabled = !catalogue.length;
  $("rsSurprise").disabled = !catalogue.length;
}

async function init() {
  draw();
  paintModes(MODEL_MODES.map((_,i)=>i===0?1:0));
  try {
    const response = await fetch("data/albums.json",{cache:"no-cache"});
    if (!response.ok) throw Error("Catalogue unavailable");
    selectEntries(await response.json());
  } catch(error) {
    $("rsPlay").disabled=true;$("rsSurprise").disabled=true;
    setStatus("Catalogue unavailable: you can still analyze local audio files.");
  }
}

$("rsPlay").addEventListener("click",()=>beginTrack(catalogue[Number($("rsTrack").value)],"user"));
$("rsSurprise").addEventListener("click",()=>{
  if (!catalogue.length) return;
  const sample = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(sample);
  else sample[0] = Math.floor(Math.random()*4294967295);
  const i = sample[0] % catalogue.length;
  $("rsTrack").value = String(i);
  // A single explicit click is consent for THIS random selection, not sitewide
  // autoplay, continuous tracking, profiling, or a persistent personalization flag.
  beginTrack(catalogue[i],"system_opt_in");
});
$("rsMix").addEventListener("change",async event=>{
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  $("rsStems").value="";
  try { await fileAnalysis(files,false); }
  catch(error) {setStatus("Could not analyze the chosen mix: "+error.message);}
});
$("rsStems").addEventListener("change",async event=>{
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  $("rsMix").value="";
  try { await fileAnalysis(files,true); }
  catch(error) {setStatus("Could not analyze these stems: "+error.message);}
});

function syncPlayback() {
  if (!liveEngine || !engine?.audio || !sourceIdentity) return;
  const playing = engine.current?.();
  if (!playing || sourceIdentity !== playing.albumSlug + ":" + playing.title) return;
  renderAt(Math.min(MAX_BROWSER_SECONDS,Math.max(0,Number(engine.audio.currentTime)||0)));
}
window.addEventListener("mcc:music-state",syncPlayback);
window.addEventListener("mcc:music-selected",syncPlayback);
if (engine?.audio) {
  engine.audio.addEventListener("timeupdate",syncPlayback);
  engine.audio.addEventListener("seeked",syncPlayback);
}
init();
