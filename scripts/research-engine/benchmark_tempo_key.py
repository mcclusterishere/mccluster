#!/usr/bin/env python3
"""Labeled BPM/key benchmark with abstention and tempo-octave diagnostics.

Usage:
  python scripts/research-engine/benchmark_tempo_key.py --labels /private/benchmarks/labels.csv --run-estimator --report /tmp/bpm-key-v2.json
  python scripts/research-engine/benchmark_tempo_key.py --labels labels.csv --predictions predictions.json --report evaluation.json
CSV: id,file,reference_bpm,reference_key,style
Predictions JSON: {"id": {"tempo":{"bpm":120}, "key":{"name":"C major"}}}
Audio/data are never uploaded. Dataset reuse must comply with rights and licensing.
"""
import argparse
import csv
import json
import math
from pathlib import Path
from collections import defaultdict

NOTES = {"C":0,"B#":0,"C#":1,"DB":1,"D":2,"D#":3,"EB":3,"E":4,"FB":4,
         "E#":5,"F":5,"F#":6,"GB":6,"G":7,"G#":8,"AB":8,"A":9,
         "A#":10,"BB":10,"B":11,"CB":11}

def parse_key(value):
    if not value or value.strip().lower() in ("unknown","none","atonal"):
        return None
    bits=value.strip().replace("♯","#").replace("♭","b").split()
    if len(bits)!=2 or bits[1].lower() not in ("major","minor"):return None
    name=bits[0].upper()
    if name not in NOTES:return None
    return (NOTES[name],bits[1].lower())

def bpm_metrics(prediction,reference,tolerance=.04):
    if prediction is None:return {"strict":False,"octave":False,"abs_error":None,"abstained":True}
    try:
        bpm=float(prediction)
        target=float(reference)
    except (TypeError,ValueError):
        return {"strict":False,"octave":False,"abs_error":None,"abstained":True}
    if not math.isfinite(bpm) or bpm<=0 or not math.isfinite(target) or target<=0:
        return {"strict":False,"octave":False,"abs_error":None,"abstained":True}
    strict=abs(bpm-target)/target<=tolerance
    octave=min(abs(bpm/ratio-target)/target for ratio in (.5,1,2))<=tolerance
    return {"strict":strict,"octave":octave,"abs_error":round(abs(bpm-target),3),"abstained":False}

def key_score(predicted,reference):
    p=parse_key(predicted)
    r=parse_key(reference)
    if not p or not r:return None
    if p==r:return 1.
    tonic_p,mode_p=p
    tonic_r,mode_r=r
    if mode_p==mode_r and (tonic_p-tonic_r)%12 in (5,7):return .5
    if mode_p!=mode_r and tonic_p==tonic_r:return .2
    if mode_p!=mode_r:
        if mode_p=="minor" and tonic_p==(tonic_r+9)%12:return .3
        if mode_p=="major" and tonic_p==(tonic_r+3)%12:return .3
    return 0.

def aggregate(rows):
    out={"schema":"mcc.music.benchmark-tempo-key.v1","evaluation":"reference-annotated, no fabricated truth",
         "total":len(rows),"bpm":{"evaluated":0,"covered":0,"strict_4pct":None,"octave_aware_4pct":None,"mae":None},
         "key":{"evaluated":0,"covered":0,"exact":None,"mirex_weighted":None},
         "styles":{}}
    valid_bpm=[r for r in rows if r["bpm_reference_valid"]]
    covered=[r["bpm"] for r in valid_bpm if not r["bpm"]["abstained"]]
    all_key=[r for r in rows if r["key_reference_valid"]]
    key_results=[r["key_score"] for r in all_key if r["key_score"] is not None]
    out["bpm"].update({"evaluated":len(valid_bpm),"covered":len(covered),
       "strict_4pct":round(sum(x["strict"] for x in covered)/len(covered),4) if covered else None,
       "octave_aware_4pct":round(sum(x["octave"] for x in covered)/len(covered),4) if covered else None,
       "mae":round(sum(x["abs_error"] for x in covered)/len(covered),3) if covered else None})
    out["key"].update({"evaluated":len(all_key),"covered":len(key_results),
       "exact":round(sum(x==1 for x in key_results)/len(key_results),4) if key_results else None,
       "mirex_weighted":round(sum(key_results)/len(key_results),4) if key_results else None})
    # Dataset/style stratification is a diagnostic, not a genre-to-brain mapping.
    grouped=defaultdict(list)
    for r in rows:grouped[r["style"] or "unspecified"].append(r)
    for name,subset in sorted(grouped.items()):
        b=[x for x in subset if x["bpm_reference_valid"] and not x["bpm"]["abstained"]]
        k=[x["key_score"] for x in subset if x["key_score"] is not None]
        out["styles"][name]={"n":len(subset),"bpm_covered":len(b),
          "octave_aware_4pct":round(sum(x["bpm"]["octave"] for x in b)/len(b),4) if b else None,
          "key_covered":len(k),"key_exact":round(sum(x==1 for x in k)/len(k),4) if k else None}
    out["caveats"]=[
      "Report coverage and abstention; 100% accuracy on a filtered subset is misleading.",
      "Annotated key is ambiguous under modulation and atonality.",
      "This benchmark cannot validate or predict brain activation or listener traits.",
      "Predictions are not MIDI transcription or complete sheet music."
    ]
    return out

def evaluate(labels,predictions):
    out=[]
    for label in labels:
        ident=label["id"]
        if ident not in predictions:prediction={}
        else:prediction=predictions[ident]
        key=prediction.get("key") or {}
        tempo=prediction.get("tempo") or {}
        pkey=key.get("name") if isinstance(key,dict) else str(key)
        pbpm=tempo.get("bpm") if isinstance(tempo,dict) else tempo
        rbpm=None
        try:rbpm=float(label.get("reference_bpm",""))
        except (ValueError,TypeError):pass
        if rbpm is not None and (not math.isfinite(rbpm) or rbpm<=0):rbpm=None
        rkey=label.get("reference_key","")
        out.append({"id":ident,"style":label.get("style",""),
            "bpm_reference_valid":rbpm is not None,
            "key_reference_valid":parse_key(rkey) is not None,
            "bpm":bpm_metrics(pbpm,rbpm) if rbpm is not None else {"abstained":True},
            "key_score":key_score(pkey,rkey)})
    return aggregate(out)

def load_labels(path):
    with path.open(newline="",encoding="utf8") as f:
        reader=csv.DictReader(f)
        if not set(("id","file","reference_bpm","reference_key")).issubset(reader.fieldnames or []):
            raise ValueError("CSV requires id,file,reference_bpm,reference_key")
        rows=list(reader)
    if not 1<=len(rows)<=5000:raise ValueError("1–5000 labels per benchmark")
    ids=[x["id"] for x in rows]
    if len(ids)!=len(set(ids)) or any(not i or len(i)>130 for i in ids):
        raise ValueError("bad or duplicate ID")
    return rows

def run_estimator(labels,folder,max_tracks=500):
    from tempo_key import estimate
    predictions={}
    root=folder.resolve(strict=True)
    if not 1<=len(labels)<=max_tracks:raise ValueError("too many tracks for estimator run")
    for label in labels:
        file=(root/label["file"]).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file() or file.stat().st_size>100*1024*1024:
            raise ValueError("unsafe or excessive benchmark audio path")
        try:
            res=estimate(file)
            predictions[label["id"]]={"tempo":res.get("tempo"),"key":res.get("key")}
        except Exception:
            predictions[label["id"]]={"tempo":{"bpm":None},"key":{"name":None}}
    return predictions

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--labels",required=True,type=Path)
    p.add_argument("--predictions",type=Path)
    p.add_argument("--run-estimator",action="store_true")
    p.add_argument("--report",required=True,type=Path)
    p.add_argument("--audio-root",type=Path)
    args=p.parse_args()
    if args.run_estimator==bool(args.predictions):
        p.error("Choose exactly one of --predictions or --run-estimator")
    labels=load_labels(args.labels)
    if args.run_estimator:
        predictions=run_estimator(labels,args.audio_root or args.labels.resolve().parent)
    else:
        predictions=json.loads(args.predictions.read_text(encoding="utf8"))
    summary=evaluate(labels,predictions)
    args.report.open("x",encoding="utf8").write(json.dumps(summary,indent=2)+"\n")
    print(json.dumps({"evaluated":summary["total"],"bpm_covered":summary["bpm"]["covered"],"key_covered":summary["key"]["covered"]}))

if __name__=="__main__":main()
