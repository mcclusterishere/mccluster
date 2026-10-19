"""Independent tempo/key estimator, optional CPU research backend.
Not a ground-truth BPM/key label. Uses harmonic CQT chroma and beat tracking.
Requires a separately installed, version-locked librosa/numpy environment.
No model downloads, network calls, personal profiles, or user media upload.
"""
import json
import math
import sys
from pathlib import Path

MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]
NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]

def correlation(a, b):
    import numpy as np
    x = np.asarray(a, dtype=float)
    y = np.asarray(b, dtype=float)
    x = x - x.mean()
    y = y - y.mean()
    denom = np.linalg.norm(x) * np.linalg.norm(y)
    return float(x @ y / denom) if denom > 1e-9 else 0.0

def key_candidates(chroma):
    import numpy as np
    vector = np.asarray(chroma, dtype=float)
    if np.sum(vector) <= 1e-8:
        return []
    vector = vector / np.sum(vector)
    scores = []
    for tonic in range(12):
        for scale, profile in (("major",MAJOR),("minor",MINOR)):
            p = np.roll(np.asarray(profile), tonic)
            scores.append({"name":NAMES[tonic] + " " + scale,
                           "score":round(correlation(vector,p),4)})
    return sorted(scores,key=lambda x:x["score"],reverse=True)

def estimate(path, max_seconds=210):
    try:
        import numpy as np
        import librosa
    except ImportError as exc:
        raise RuntimeError("librosa and numpy must be installed in the approved CPU worker") from exc
    if not (10 <= max_seconds <= 360):
        raise ValueError("max_seconds must be in [10,360]")
    y,sr = librosa.load(str(path), sr=22050, mono=True, duration=max_seconds)
    if len(y) < sr * 4:
        raise ValueError("not enough audio to estimate tempo/key")
    hop = 512
    rms = float(np.sqrt(np.mean(y**2)))
    if rms < 1e-5:
        return {"schema":"mcc.music.tempo-key.v2","status":"abstained",
                "tempo":{"bpm":None,"reason":"near silence"},
                "key":{"name":None,"reason":"near silence"}}
    onset = librosa.onset.onset_strength(y=y,sr=sr,hop_length=hop)
    beat_bpm,beat_frames = librosa.beat.beat_track(
        onset_envelope=onset,sr=sr,hop_length=hop,trim=False)
    bpm = float(np.asarray(beat_bpm).reshape(-1)[0])
    times = librosa.frames_to_time(beat_frames,sr=sr,hop_length=hop)
    intervals = np.diff(times)
    plausible = intervals[(intervals >= .25)&(intervals <= 1.7)]
    if len(plausible) >= 5:
        med = float(np.median(plausible))
        variation = float(np.median(np.abs(plausible-med)) / max(.05,med))
        tempo_conf = max(0,min(.9,(1-variation*4)*min(1,len(plausible)/24)))
    else:
        tempo_conf = 0
    if not math.isfinite(bpm) or bpm <= 0 or tempo_conf < .18:
        tempo = {"bpm":None,"confidence":round(tempo_conf,3),
                 "reason":"weak/inconsistent beat locations"}
    else:
        candidates = sorted(set(round(b,2) for b in (bpm/2,bpm,bpm*2) if 40<=b<=240))
        tempo = {"bpm":round(bpm,2),"confidence":round(tempo_conf,3),
                 "candidates_bpm":candidates,"beats":len(beat_frames),
                 "reason":"librosa onset strength + beat_track; 1/2x and 2x remain hypotheses"}
    try:
        harmonic = librosa.effects.harmonic(y)
        chroma = librosa.feature.chroma_cqt(y=harmonic,sr=sr,hop_length=hop)
        method = "CQT harmonic pitch class"
    except (ValueError, RuntimeError, MemoryError):
        chroma = librosa.feature.chroma_stft(y=y,sr=sr,hop_length=hop)
        method = "STFT chroma fallback"
    distribution = np.median(chroma,axis=1)
    ranking = key_candidates(distribution)
    if not ranking:
        key = {"name":None,"confidence":0,"reason":"insufficient harmonic energy"}
    else:
        segments = np.array_split(chroma, min(12,max(1,chroma.shape[1]//(sr//hop*12))),axis=1)
        favorites = [key_candidates(np.median(c,axis=1)) for c in segments if c.shape[1]>=5]
        stable = sum(1 for r in favorites if r and r[0]["name"]==ranking[0]["name"])/max(1,len(favorites))
        margin = max(0,ranking[0]["score"]-ranking[1]["score"])
        harmonic_coverage = min(1,float(np.count_nonzero(distribution>np.max(distribution)*.17))/5)
        confidence = min(.92,(.45*stable+.55*min(1,margin/.18))*harmonic_coverage)
        resolved = confidence>=.38 and ranking[0]["score"]>.32
        key = {"name":ranking[0]["name"] if resolved else None,
               "confidence":round(confidence,3),"candidates":ranking[:3],
               "method":method,"reason":"estimated; key changes and ambiguous relative keys may invalidate a single label"
               if resolved else "uncertain tonality, modulation or ambiguous template correlation"}
    return {"schema":"mcc.music.tempo-key.v2","status":"estimated_not_verified",
            "sample_rate":sr,"sampled_seconds":round(len(y)/sr,3),
            "method_versions":{"librosa":librosa.__version__},
            "tempo":tempo,"key":key,
            "limitations":["not verified sheet music","not a medical/neural classification",
                           "compare on labeled data before production quality claims"]}

if __name__ == "__main__":
    if len(sys.argv)!=2:
        raise SystemExit("usage: python tempo_key.py INPUT_AUDIO")
    print(json.dumps(estimate(Path(sys.argv[1])),indent=2))
