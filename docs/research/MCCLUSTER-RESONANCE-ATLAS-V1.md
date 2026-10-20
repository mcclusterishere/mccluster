# McCluster Resonance Atlas · research and system contract v1

**Status:** prototype / physics simulation + reproducible acoustic measurements. Not yet a calibrated Chladni experiment, medically validated DNA response, music-personality classifier, or general sitewide audio rollout.

**Public explainer:** /resonance.html. **Canonical player:** \`MCC_MUSIC\` in \`js/music-engine.js\`. **Batch analysis:** \`scripts/music-resonance-analyze.mjs\`. **Shared pure model:** \`js/resonance/core.mjs\`.

## The defining equation

\[
\boxed{u(x,y,t)=\sum_{k=1}^{N} A_k(t)\,\phi_k(x,y)}
\]

Here \(u\) is the modelled displacement field, \(\phi_k\) is a resonator eigenmode (a standing-wave shape), and \(A_k(t)\) its time-dependent contribution. The equation describes a **physical resonator model**, not DNA activation, a genre identity or personality traits.

We start with an **ideal fixed-boundary square membrane**, side \(L=1\) m, wave speed \(c=110\) m/s, damping ratio \(\zeta=0.085\), and off-centre excitation at normalized coordinates (0.37,0.43). These values are explicit demonstration parameters rather than measurements of a specific drum or physical apparatus.

\[
\phi_{mn}(x,y)=\sin\left(\frac{m\pi x}{L}\right)\sin\left(\frac{n\pi y}{L}\right),
\qquad f_{mn}=\frac{c}{2L}\sqrt{m^2+n^2}.
\]

The first ideal mode (1,1) is approximately **77.8 Hz** for these chosen parameters. We evaluate modes \(m,n \in [1,5]\). For each audio frame, apply a Hann window, a radix-2 FFT (default 2048 samples), power \(P(f,t)=|X(f,t)|^2\), and a damped mode response:

\[
H_{mn}(f)=\left[(1-(f/f_{mn})^2)^2+
(2\zeta f/f_{mn})^2\right]^{-1/2}.
\]

Each idealized mode receives a magnitude-only spectral projection proportional to
\(\left[\sum_{f} P(f,t)H_{mn}^2(f)\right]^{1/2}\), modulated by a fixed excitation-position coupling factor. For visualization, amplitudes are normalized **within the frame**. The implementation assigns zero unknown phase to each mode to display a reproducible spatial snapshot, NOT measured displacement or recovered phase. Display contrast is artistic and has no unit of millimeters or nanometers. Changing the membrane, edge conditions, damping, excitation, or exact audio spectrum can change the nodal pattern.

A **Chladni metal plate** obeys bending-plate physics and has different modes from this membrane. **Faraday patterns** are nonlinear surface waves in fluids and likewise are not represented by our initial model. Do not label this screen as a literal photograph or measured result of either. See references 1–2.

## Two research pathways, not an invented bridge

**Path A: auditory/cognitive/physiological → biological regulation.** Human music listening and performance can correlate with peripheral-blood transcriptomic and microRNA changes in small studies [3–4]. Studied populations, musical proficiency, exercises and confounders vary. These studies do not show that a song changes a DNA sequence, universally "activates genes," heals disease, or supplies a deterministic brain/genetic profile of the listener.

**Path B: physical mechanical input → cellular response.** Experimental sound/force stimulation can affect gene-expression responses in certain cultured-cell systems [5]. Ultrasound, cellular mechanotransduction, molecular vibrations, and audible music are distinct frequency/energy-coupling regimes. The membrane visualization does not calculate a force on a DNA molecule or a genome-level outcome.

**Scientific language policy:** say "audio measurement", "simulated modal drive", "research association", and "unsupported hypothesis" when appropriate. Never label genre X = DNA gene Y, frequency X = cure, or "personal genome matched to song."

## Music analysis without mood or genre as the primary ontology

A track's **acoustic signature** is stored independently of musical genre. Candidate dimensions:
- Sample rate and analyzed duration (sampling provenance).
- RMS (short-window amplitude; not calibrated sound-pressure level).
- Dominant **spectral** peak in Hz (not necessarily the musical fundamental or note).
- Spectral centroid / flatness / low-band share (20–250 Hz).
- Frame-wise modal drive for the declared resonator; dominant modal indices and modeled eigenfrequencies.
- Planned: onsets, rhythmic periodicity, pitch confidence, tuning and harmonics, stereo/spatial energy, perceptual loudness, dynamic change, and models trained under valid audio-data licenses.

A versioned physics-first class is emitted as `membrane-m<n>n<n>/<tonal|mixed|broadband>/<low|mid|high>`. This is a *technical bin* of the specified resonator and its measured audio signature. `signatureSimilarity` compares the top modeled modes and spectral centroids; it is not proof of a matching genre, user preference, or biological response. Class boundaries are heuristics to be validated and calibrated, not discovered universal natural kinds.

**The spectral center is not a genre. A genre is not a unique cymatic pattern.** A change in apparatus or sound design can outweigh between-genre differences. Future genre associations are statistical summaries under a fixed apparatus and reported with uncertainty, sample sizes, and confounder checks—not a prescriptive sorting law.

### Three intake modes

1. **Published full mix**: choose a public catalogue record through \`MCC_MUSIC.play\`. The UI reads the same *public*, same-origin audio file into a local decoder and maps its resulting analysis frames to the canonical audio element's \`currentTime\`. This does **not** create another player. Gated masters are explicitly excluded from independent decoding. The visual result is a time-sampled profile, not a continuous measured plate.
2. **Local full mix**: an artist selects one MP3/WAV etc in their browser. Files are decoded locally via Web Audio; there is no upload and no playback outside the existing engine. The browser currently analyzes up to 45 seconds, eight selected files maximum, 40 MiB total. Browser audio-codec support varies.
3. **Trackouts**: select multiple stems beginning at the same timeline origin. Each aligned PCM stream receives independent analysis, and an equal-gain *reconstructed* sum receives a further separate analysis. This preserves sample-level phase in the reconstruction but assumes equal gains and alignment, so it is **not the original mastered mix**. Server-side CLI analyzes PCM WAV directly or uses FFmpeg for MP3 and other formats. All stems must share a sample rate (no silent assumption of alignment or resampling).

The offline script is the first real server-side **analysis worker**, callable by a future queued audio-ingestion service. It does not itself watch production storage or serve a public API. Use:

\`\`\`bash
node scripts/music-resonance-analyze.mjs track.wav --output resonance-result.json
node scripts/music-resonance-analyze.mjs track.mp3 --output resonance-result.json
node scripts/music-resonance-analyze.mjs --trackouts drums.wav bass.wav vocals.wav --output stem-result.json
node --test scripts/test/music-resonance.test.mjs
\`\`\`

WAV requires no dependency; MP3/other compressed formats need a local \`ffmpeg\` executable. Output contains derived feature frames and modes only, no raw PCM. Do not run it on material without permission.

## One canonical Music and Media engine: integration contract

**Music engine authority:** \`MCC_MUSIC\` exclusively owns playlist and actual playback, gated claims, preview limits, audio transport, lock-screen metadata, and listen-ledger calls. This work MUST NOT bypass \`MCC_GATED\`, directly stream private masters or count an audio decode as an authorized play. The new Atlas page reuses that engine and adds an optional analysis projection.

**Media graph authority (next phase):** Creator Studio, clipping, editing, recording, video/image generation and agent content must attach approved media assets to one immutable media registry by object ID. Each media record declares:
- \`media_id\`, parent project/creator, rights/consent/license provenance, storage class (public/creator-private/gated), and transformation lineage.
- \`audio_relation\`: canonical music track ID or \`none\` with a reason (silent photos do NOT play music automatically).
- Multi-stem fields: \`stem_id\`, \`mix_id\`, alignment origin, sample rate, channel layout, fader state, lineage, codec, analysis version.
- \`resonance_analysis_id\`, model version, source checksum, window parameters, confidence/limitations and physical apparatus ID.
- A creation source category including \`human\` or \`agent\`; an AI agent has no permission to manufacture listen events, rights or genetic evidence.

Existing media stores and access checks should be adapted **incrementally** and tested before any universal enforcement. Nothing here secretly changes current upload routes or storage policies.

### Music serving, consent and measurement bias

Music may accompany other surfaces **only after a deliberate listening opt-in and an allowable browser gesture**. iOS/Safari may reject programmatic autoplay. Users must always have a visible pause/mute/stop, accessible reduced-motion mode and volume control. There must not be background playback during sensitive forms, recording, or an unexpected visit.

The new catalogue "Surprise me · opt in" chooses a public, ungated recording after an explicit tap. The choice is tagged \`selection_origin: system_opt_in\`; ordinary selections carry \`selection_origin: user\`. Existing canonical listen accounting still measures qualified playback; **algorithm-selected exposure never equals listener preference**. Plays attributed to autoplay must be excluded from affinity/ranking features until the listener performs a distinct intentional action (save, replay, complete after voluntary choice), with transparent choice provenance and an opt-out.

Do not infer health, genes, emotions, race, intelligence, politics or other sensitive characteristics from repeat listening. A replay may reflect autoplay, workout timing, background use, work tasks, a parent sharing a device, or accidental re-entry.

**No secret listener profiling or gene matching.** Any longitudinal research or personal adaptation needs affirmative consent, purpose limitation, opt-out and data minimization. The Atlas local-file prototype stores no raw audio or listening identity.

### Future sitewide sequencing

- Stage 1 (this PR): public research explainer, local and server-side feature extractors, owner-auditable metadata and canonical player-selection source.
- Stage 2: signed, queued feature extraction on approved published media; immutable versioned signatures + controlled stem lineage; no migrations without explicit approval.
- Stage 3: one optional user-enabled sound engine across pages with continuity through existing music components; media registry association for all creator and agent tools.
- Stage 4: validated calibrated resonators/physical Chladni experiments with independent audio and camera measurements, preregistered comparisons and uncertainty ranges.
- Stage 5: separated voluntary research with proper protocols and biological collaborators. Never imply listening-history data measures DNA without samples and approval.

## Scientific validation protocol

1. Hold membrane or real apparatus, mounting, drive position, amplifier and input SPL consistent.
2. Create fixed training/validation/test splits by **artist and recording**, not by near-duplicate track segments.
3. Measure audio spectral/onset attributes first; then predict modal drive with calibrated settings.
4. Compare modal-space clusters and shapes to production/genre metadata as exploratory variables, controlling for low-frequency content, dynamics and loudness.
5. Collect a controlled high-resolution camera measurement from an actual physical apparatus for falsifiable validation; report residuals and uncertainty.
6. Reproduce independent negative controls: silence, noise, sine sweeps, repeated mix at varied gain, reordering stems and deliberate stem misalignment.
7. Treat results as claims about **that apparatus and recording**; never generalize to tissue, DNA or listeners.

## Reproducibility and data / licensing

- RCSB PDB 1BNA: experimentally determined B-DNA coordinates: https://www.rcsb.org/structure/1BNA . Biological structure visualization is a *separate* module from our membrane field.
- Human gene and expression references can be studied through ENCODE, GTEx, GEO, NCBI, with participant privacy and cohort access requirements independently honored.
- MTG-Jamendo dataset: https://github.com/MTG/mtg-jamendo-dataset — marked **non-commercial research and academic use only** by its maintainers; individual audio licenses also vary. No automatic commercial ingestion without explicit authorization.
- Music-listening transcriptomics data GSE48624 was withdrawn from public GEO at the submitter's request (participant privacy); do not fetch or attempt to restore withdrawn individual-level data.
- The public figure/equation is our idealized model and not copied experimental imagery.

## Bibliography

1. University of Colorado Boulder, Physics Demonstrations. *Chladni Figures*. https://physicslabs.colorado.edu/demos/oscillations-and-waves/instruments/resonance-in-plates-bars-solids/chladni-figures/ . Physical mode geometry and boundary conditions.
2. Kumar, K. & Bajaj, K. (1995). *Competing patterns in the Faraday experiment*. Physical Review E 52, R4606. https://doi.org/10.1103/PhysRevE.52.R4606 . Fluid patterns depend on driving conditions.
3. Kanduri, C. et al. (2015). *The effect of listening to music on human transcriptome*. PeerJ 3:e830. https://doi.org/10.7717/peerj.830 . Peripheral-blood listening experiment, not direct DNA activation.
4. Nair, P. S. et al. (2019). *Music-performance regulates microRNAs in professional musicians*. PeerJ 7:e6660. https://doi.org/10.7717/peerj.6660 . Peripheral-blood microRNA response to music performance, not genre fingerprinting.
5. Kumeta, M. et al. (2018). *Cell type-specific suppression of mechanosensitive genes by audible sound stimulation*. PLOS ONE. https://doi.org/10.1371/journal.pone.0188764 . Cell-culture response under controlled stimulation; not evidence of acoustic DNA "reprogramming."
6. MDN Web Docs. *AnalyserNode.getFloatFrequencyData()* https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatFrequencyData . Frequency bins and decibel conventions.
7. Bogdanov, D. et al. (2019). *The MTG-Jamendo Dataset for Automatic Music Tagging*. https://github.com/MTG/mtg-jamendo-dataset . Genre/metadata methodology and license limitations.

**Research policy:** citations support carefully bounded statements; they do not grant a claim that the implemented visual simulation measures tissue or DNA.
