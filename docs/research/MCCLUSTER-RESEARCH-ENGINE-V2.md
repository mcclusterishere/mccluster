# McCluster Research Engine — Underwater Brain and DNA

**Research prototype / not production.** The immersive experience is quarantined under _unfinished/research-world/index.html and excluded from publishing. The public-facing theoretical explainer is resonance.html, with the defining resonance equation at the top.

The Music Engine remains the authoritative MCC_MUSIC transport. The Research Engine adds analysis, experimental visualization, and evidence to the existing player, not a competing player.

## 1. Mathematics and scientific scope

The founding equation is

\[
\boxed{u(x,y,t)=\sum_{k=1}^{N}A_k(t)\phi_k(x,y)}
\]

For the initial fixed-edge membrane approximation:

\[
\phi_{mn}(x,y)=\sin(m\pi x/L)\sin(n\pi y/L),\quad f_{mn}={c\over 2L}\sqrt{m^2+n^2}.
\]

The model declares L = 1 m, c = 110 m/s, damping ratio 0.085, excitation location (0.37,0.43), and 25 eigenmodes. A Hann-windowed FFT measures a recording's spectrum; a damped transfer-function approximation estimates the relative response of each mode. Responses are normalized for **display only**, not calibrated physical displacement. Mode phases are not recovered from spectrum magnitudes.

The water visual uses a slowed time domain so people can see its changing geometry:

\[
h(x,z,t)=h_0+\gamma\sum_k w_k(t)\phi_k(x,z)\cos(\omega_k^{display}t)+\eta(x,z,t)
\]

Here the wave height is a *stylized rendering* of the membrane model. It is not a calibrated Faraday-wave solver, Chladni steel plate, sonogram of DNA, fluid-pressure measurement or quantitative claim that this song shakes a person's brain. Future physical experiments must independently model tank geometry, fluid depth, viscosity, driver coupling, temperature, frequencies and boundary conditions.

## 2. Neuroscience: two separate mechanisms

**A — music perception -> physiology -> biological regulation.**
Research identifies overlapping auditory, sensorimotor and reward-related brain networks. Small blood transcriptome and microRNA experiments report biological differences after listening or performance. They do not demonstrate that a song reliably activates a named gene or changes DNA sequence. Primary source: Kanduri et al. 2015, https://doi.org/10.7717/peerj.830 .

**B — physical mechanical stimulation -> cellular processes.**
Physical forces can affect cells and their transcriptional behavior in controlled experiments. A cultured-cell study is Kumeta et al. 2018, https://doi.org/10.1371/journal.pone.0188764 . Audible music playback, ultrasound and molecular terahertz dynamics are distinct stimuli and experimental regimes. The model does not derive molecular changes from a normal listening session.

## 3. Interactive brain map (research associations, NOT activation controls)

The initial model is a procedural artistic brain with approximate markers. It is **not MRI-derived** or stereotaxically registered; pins for deep structures are explicitly symbolic.

| Selectable association | What is researched | Evidence |
| --- | --- | --- |
| Auditory cortex | Pitch, timbre and auditory feature processing | https://pubmed.ncbi.nlm.nih.gov/11458830/ |
| Supplementary motor area | Rhythm tracking and auditory-motor prediction | https://pmc.ncbi.nlm.nih.gov/articles/PMC9195154/ |
| Cerebellum | Timing and sensorimotor synchronization | https://pmc.ncbi.nlm.nih.gov/articles/PMC11592450/ |
| Putamen / basal ganglia (deep) | Beat-based perception and internal timing | https://pmc.ncbi.nlm.nih.gov/articles/PMC9195154/ |
| Inferior frontal gyrus | Harmonic expectation and musical syntax | https://pubmed.ncbi.nlm.nih.gov/27542722/ |
| Reward circuitry (deep) | Music-evoked pleasure and motivation, depending on the listener | https://www.nature.com/articles/nrn3666 |

Neither one tempo nor one named key uniquely engages a specific brain structure. The association is network-based, task-dependent and variable between participants. Display full citations in the UI and prohibit health/personal-trait conclusions.

For atlas-derived anatomy research: https://brainbrowser.cbrain.mcgill.ca/ and https://www.humanbrainproject.eu/en/science-development/focus-areas/brain-atlases/ . Replacement requires licensing and coordinate registration review.

## 4. Music as measured scientific dimensions

Do not make mood or genre the primary sorting ontology. Store versioned, method-described features:

1. **Measured acoustic features:** RMS, spectral distribution, spectral centroid/flatness, low-band energy, and frame-by-frame drives for the declared resonator.
2. **Estimated tempo:** onset-envelope autocorrelation and ranked BPM hypotheses; permit half-time/double-time ambiguity and low-confidence results. Future production benchmarks should include Essentia RhythmExtractor2013 and librosa beat_track.
3. **Estimated musical key:** FFT-based 12-pitch-class energy profile and major/minor template correlations with confidence. One chord, atonal song, distorted audio, microtonality, percussion or key changes can defeat a single global key label. Validate against Essentia KeyExtractor.
4. **Actual trackout analysis:** estimate features per aligned original stem; reconstruct a demonstrative equal-gain sum if the artist's mixer settings are unknown.
5. **Single mixed MP3 analysis:** evaluate the mixed audio directly. Do not pretend a mix reveals its original source tracks without a machine-learning separation step.

Implementation: js/resonance/core.mjs; js/resonance/theory.mjs; scripts/music-resonance-analyze.mjs. Output names are estimates, not ground-truth tags. The batch worker is local, not a deployed production backend.

## 5. Studio MIDI and sheet-music pipeline

A complete score requires pitch and onset detection, instrument/voice identification, beat/meter estimation, rhythmic quantization, note-spelling, polyphonic voice separation, and a score engraver.

Planned chain: mixed audio -> optional model-derived stems -> estimated note events -> MIDI -> draft MusicXML -> human correction.

- Original DAW project files or true user-supplied MIDI and stems are preferred to inferred source separation.
- Demucs family (https://github.com/facebookresearch/demucs) supports broad drums/bass/vocals/other separation but the original repo is archived. Newer Audio Separator backends (https://github.com/nomadkaraoke/python-audio-separator) are candidates, pending weights licensing and performance validation.
- Spotify Basic Pitch (https://github.com/spotify/basic-pitch) generates draft MIDI and works best on isolated pitched instruments.
- Optional music21 can export a draft MusicXML score. Percussion notation and dense polyphony require specialized models and a musician's review.

The opt-in local batch adapter is scripts/research-engine/derive-stems-score.py. It requires explicit source-rights confirmation and a separate explicit model-download flag. It does not install packages, change production records or run after upload automatically.

## 6. Creator upload, metadata and activation permissions

The existing creator upload transaction uploads rights-controlled private masters and previews, writes release records and attests rights. The new non-blocking analysis hook runs **only after that process succeeds**, decodes at most 30 seconds on-device, and shows approximate tempo/key with uncertainty.

- It cannot change release review state, grants, storage or billing.
- It does not upload another copy, submit the song for model training, persist derived features, or profile a listener.
- Browser analysis errors leave the submitted release intact.
- Remote model inference, persisted versioned fingerprints and background upload jobs require a separate authenticated API, idempotent job queue, owner/creator scoped access, approved SQL migration, and privacy review.

The Research Engine observes MCC_MUSIC state and its sole Audio element. All future recording, publishing, video sync, music agents and studio surfaces should delegate playable music to it instead of creating independent transports.

## 7. Listener research and opt-in questionnaires

Do not infer personality, intelligence, genetic traits, medical condition, mental health, race, ethnicity or intimate attributes from someone's song repetitions or the brain visualization.

A listening action must carry *origin*, distinguishing user selection, explicit surprise selection, auto-advance, consented site background music and unknown legacy events. An automatically served track is an exposure, not positive preference. Analyze replays only with genuine opportunity denominators and allow users to decline personalization.

The prototype question asks what auditory feature stood out. Its answer is in-memory only, is not posted to a server, and offers matching literature rather than a diagnosis. Future durable research participation requires informed opt-in, separation from ordinary product analytics, revocation and appropriate human-study ethics controls.

## 8. Validation and release gates

- Synthetic signals confirm FFT, BPM candidates, key ambiguity and modal response against known audio.
- Validate on professionally annotated recordings across genres and instruments; report errors by group and abstention rates rather than declaring exact BPM/key for everything.
- Compare predicted nodal modes with controlled measurements on defined physical rigs. Metal plates and liquid Faraday patterns are distinct models.
- GPU/iPhone Safari QA for the underwater scene, real tap/swipe/scroll interactions and reduced-motion.
- Human neuroscience citations and descriptions must remain visible, including caveats for internal structures.
- Store future model weights' provenance, licenses, versions, checksums, creator rights and note-transcription corrections.
- Keep immersive world under _unfinished; no production deployment or release until explicit owner approval and site privacy controls.

**Data sources:** MTG-Jamendo https://github.com/MTG/mtg-jamendo-dataset; MUSDB18 https://sigsep.github.io/datasets/musdb.html; MAESTRO https://magenta.tensorflow.org/datasets/maestro. Public research availability does not necessarily grant commercial redistribution rights to the recordings.

**Science-label contract:** every displayed output must be labeled as measured, algorithmically estimated, modeled, user-reported or unknown. The system must never display a modeled brain highlight as measured neural activity.
