#!/usr/bin/env python3
"""Licensed, lease-fenced PGMQ music research worker (disabled until deployment approval).
One job per invocation. Run from an isolated CPU/GPU host with outgoing network
limited to your own Supabase API; no model downloads are permitted.
Never point at production until the pending migration, rights, model weights,
and worker service credentials have been explicitly approved.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
from urllib import error, parse, request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SAFE_OBJ = re.compile(r"^[A-Za-z0-9_./-]{1,500}$")
ALLOWED_INPUTS = {"creator-masters","creator-research-outputs"}
MAX_SOURCE = 104857600
LICENSES = {"first_party","approved_commercial"}
MAX_RUNTIME = 1700

def safe_object_path(value):
    if not isinstance(value,str) or not SAFE_OBJ.fullmatch(value) or \
       ".." in value or value.startswith("/"):
        raise ValueError("invalid object storage path")
    return value

def verify_profile(job,config):
    models = config.get("models",{})
    profile = models.get(job["model_id"])
    if not isinstance(profile,dict) or not profile.get("enabled") or \
       profile.get("stage") != job["stage"] or \
       profile.get("license_class") not in LICENSES or not profile.get("approval_reference"):
        raise ValueError("model is not on approved commercial inference allowlist")
    if job["stage"] in ("separate","transcribe"):
        local = pathlib.Path(profile.get("checkpoint_file",""))
        expected = profile.get("checkpoint_sha256","")
        if not local.is_file() or not re.fullmatch(r"[0-9a-f]{64}",expected):
            raise ValueError("approved model checkpoint missing or unpinned")
        with local.open("rb") as stream:
            actual = hashlib.file_digest(stream,"sha256").hexdigest()
        if actual!=expected:
            raise ValueError("model checkpoint checksum mismatch")
    return profile

class Endpoint:
    def __init__(self):
        self.base=os.environ.get("MCC_RESEARCH_SUPABASE_URL","").rstrip("/")
        self.key=os.environ.get("MCC_RESEARCH_SERVICE_ROLE_KEY","")
        if not self.base.startswith("https://") or not self.key:
            raise ValueError("dedicated HTTPS Supabase host and service key required")
    def call(self,method,path,body=None,content_type="application/json",limit=MAX_SOURCE):
        uri=self.base+path
        data=json.dumps(body).encode("utf-8") if body is not None and content_type=="application/json" else body
        headers={"Authorization":"Bearer "+self.key,"apikey":self.key,
                 "Accept":"application/json","Content-Type":content_type}
        req=request.Request(uri,data=data,headers=headers,method=method)
        try:
            with request.urlopen(req,timeout=90) as response:
                if response.status not in (200,201,204):
                    raise RuntimeError("remote API returned unexpected status")
                raw=response.read(limit+1)
                if len(raw)>limit:raise ValueError("private source exceeds size cap")
                return raw
        except error.HTTPError as exc:
            if exc.code in (429,500,502,503,504):raise ConnectionError("transient authenticated API outage") from exc
            raise RuntimeError("authorized API rejected request (%d)"%exc.code) from exc
    def rpc(self,name,body):
        raw=self.call("POST","/rest/v1/rpc/"+name,body,limit=131072)
        return json.loads(raw) if raw else None
    def download(self,blob,target):
        bucket=blob.get("bucket")
        path=safe_object_path(blob.get("path"))
        if bucket not in ALLOWED_INPUTS:
            raise ValueError("source bucket not authorized for research")
        encoded=parse.quote(path,safe="/")
        raw=self.call("GET","/storage/v1/object/authenticated/"+bucket+"/"+encoded,
                      limit=MAX_SOURCE)
        target.write_bytes(raw)
        return {"bucket":bucket,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)}
    def upload(self,file,bucket,path):
        if bucket!="creator-research-outputs":raise ValueError("output bucket must be private")
        safe_object_path(path)
        if not file.is_file() or file.stat().st_size>MAX_SOURCE:
            raise ValueError("bad result file")
        if file.suffix.lower()==".wav":kind="audio/wav"
        elif file.suffix.lower()==".mid":kind="audio/midi"
        elif file.suffix.lower() in (".xml",".musicxml"):kind="application/vnd.recordare.musicxml+xml"
        elif file.suffix.lower()==".pdf":kind="application/pdf"
        else:kind="application/json"
        data=file.read_bytes()
        url="/storage/v1/object/"+bucket+"/"+parse.quote(path,safe="/")
        self.call("POST",url,data,content_type=kind,limit=65536)
        return {"checksum_sha256":hashlib.sha256(data).hexdigest(),"byte_size":len(data),
                "object_path":path}

def run_model(command,workdir,api,job,limit=MAX_RUNTIME):
    # Use files rather than PIPE so chatty inference processes cannot block
    # indefinitely when their stdout/stderr buffers fill.
    outlog=tempfile.TemporaryFile()
    errlog=tempfile.TemporaryFile()
    task=subprocess.Popen(command,cwd=str(workdir),stdout=outlog,stderr=errlog)
    start=time.monotonic();last=start
    try:
        while task.poll() is None:
            if time.monotonic()-start>limit:
                task.kill()
                raise TimeoutError("inference timed out")
            if time.monotonic()-last>=90:
                alive=api.rpc("mcc_music_research_heartbeat",{
                    "p_job_id":job["job_id"],"p_token":job["lease_token"],"p_seconds":600})
                if alive is not True:
                    task.kill()
                    raise RuntimeError("worker lease lost")
                last=time.monotonic()
            time.sleep(.5)
        task.wait(timeout=5)
        errlog.seek(0);err=errlog.read()[-250:]
        outlog.seek(0);out=outlog.read(4*1024*1024+1)
        if len(out)>4*1024*1024:raise RuntimeError("inference emitted too much output")
        if task.returncode!=0:
            raise RuntimeError("inference failed with exit status "+str(task.returncode)+
                               " stderr="+err.decode("utf8","replace"))
        return out
    finally:
        if task.poll() is None:task.kill();task.wait(timeout=5)
        outlog.close();errlog.close()

def inference(job,profile,api,workdir):
    inputs=job.get("source_objects") or []
    if not isinstance(inputs,list) or not 1<=len(inputs)<=32:
        raise ValueError("missing or excessive authorized inputs")
    sources=[];provenance=[]
    for i,source in enumerate(inputs):
        path=safe_object_path(source.get("path"))
        ext=pathlib.Path(path).suffix.lower()
        if ext not in (".wav",".mp3",".flac",".m4a",".ogg",".mid"):
            raise ValueError("unsupported source extension")
        local=workdir/("input-%02d%s"%(i,ext))
        provenance.append(api.download(source,local))
        sources.append(local)
    stage=job["stage"];outputs=[];result={"schema":"mcc.music.research.result.v1",
        "stage":stage,"model_id":job["model_id"],"verified_input_sha256":[x["sha256"] for x in provenance],
        "is_estimate":True,"requires_creator_review":True}
    outdir=workdir/"outputs"
    outdir.mkdir()
    if stage=="analyze":
        if len(sources)!=1:raise ValueError("single master required for spectral analysis")
        raw=run_model(["node",str(ROOT/"scripts/music-resonance-analyze.mjs"),str(sources[0])],
                      ROOT,api,job,limit=500)
        baseline=json.loads(raw)
        result.update({"resonance":baseline.get("features"),"modes":baseline.get("dominantModes"),
                       "tempo_key_baseline":baseline.get("musicTheory")})
        if profile.get("enhanced_tempo_key"):
            # Optional second, independent estimator, not treated as ground truth.
            raw=run_model([sys.executable,str(ROOT/"scripts/research-engine/tempo_key.py"),str(sources[0])],
                          ROOT,api,job,limit=600)
            result["tempo_key_v2"]=json.loads(raw)
    elif stage=="separate":
        if len(sources)!=1:raise ValueError("source separation expects one mixed master")
        filename=pathlib.Path(profile["checkpoint_file"]).name
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,100}",filename):
            raise ValueError("unsafe separator checkpoint name")
        command=["audio-separator",str(sources[0]),"--model_filename",filename,
            "--model_file_dir",str(pathlib.Path(profile["checkpoint_file"]).parent),
            "--output_dir",str(outdir),"--output_format","WAV"]
        run_model(command,workdir,api,job)
        outputs=[(x,"stem") for x in sorted(outdir.glob("*.wav")) if x.is_file()]
        if not 2<=len(outputs)<=16:raise RuntimeError("expected multiple isolated stems")
        result["stems_estimated"]=len(outputs)
    elif stage=="transcribe":
        if len(sources)>16:raise ValueError("too many stems for transcription")
        for item in sources:
            if item.suffix.lower() not in (".wav",".flac",".mp3",".m4a",".ogg"):
                raise ValueError("transcription requires isolated audio")
            run_model(["basic-pitch",str(outdir),str(item),
                "--model-path",str(pathlib.Path(profile["checkpoint_file"]))],workdir,api,job)
        outputs=[(x,"midi") for x in sorted(outdir.glob("*.mid")) if x.is_file()]
        if not outputs:raise RuntimeError("transcription returned no MIDI")
        result["estimated_midi_parts"]=len(outputs)
    elif stage=="engrave":
        try:
            import defusedxml
            defusedxml.defuse_stdlib()
            from music21 import converter
        except ImportError as exc:
            raise RuntimeError("approved music21 and defusedxml environment required") from exc
        for i,source in enumerate(sources):
            if source.suffix.lower()!=".mid":raise ValueError("engraving requires MIDI")
            score=converter.parse(str(source))
            dst=outdir/("score-%02d.musicxml"%i)
            score.write("musicxml",fp=str(dst))
            outputs.append((dst,"musicxml"))
        result["draft_musicxml_parts"]=len(outputs)
    else:raise ValueError("unknown pipeline stage")
    artifacts=[]
    for idx,(file,kind) in enumerate(outputs):
        if file.stat().st_size<1:raise RuntimeError("empty derived file")
        safe_name=("derived-%02d%s"%(idx,file.suffix.lower()))
        object_path="research/"+job["creator_m_uid"]+"/"+job["job_id"]+"/"+safe_name
        uploaded=api.upload(file,"creator-research-outputs",object_path)
        artifacts.append({"kind":kind,**uploaded})
    return result,artifacts

def run_once(manifest):
    api=Endpoint()
    reply=api.rpc("mcc_music_research_claim",{"p_worker":"mcc-gpu-v1","p_lease_seconds":600})
    if not reply:return {"claimed":False}
    if not isinstance(reply,list) or len(reply)!=1:
        raise RuntimeError("unexpected queue claim")
    job=reply[0]
    token=job.get("lease_token")
    try:
        config=json.loads(pathlib.Path(manifest).read_text())
        profile=verify_profile(job,config)
        with tempfile.TemporaryDirectory(prefix="mcc-audio-") as root:
            result,artifacts=inference(job,profile,api,pathlib.Path(root))
        saved=api.rpc("mcc_music_research_finish",{
            "p_job_id":job["job_id"],"p_token":token,"p_result":result,
            "p_artifacts":artifacts})
        if saved is not True:raise RuntimeError("database did not acknowledge completion")
        return {"claimed":True,"status":"awaiting_creator_review","job_id":job["job_id"]}
    except Exception as exc:
        code="licensed_model_unavailable" if isinstance(exc,ValueError) else \
            "temporary_transport_error" if isinstance(exc,ConnectionError) else \
            "worker_execution_error"
        retryable= isinstance(exc,(ConnectionError,TimeoutError))
        try:api.rpc("mcc_music_research_fail",{"p_job_id":job["job_id"],
            "p_token":token,"p_error_code":code,"p_retryable":retryable})
        except Exception:pass
        raise RuntimeError(code+": "+str(exc).splitlines()[0][:200]) from exc

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",required=True,help="operator-approved model manifest JSON")
    parser.add_argument("--once",action="store_true",help="claim one queued job; no daemon or implied background service")
    args=parser.parse_args()
    if not args.once:parser.error("explicit --once is required to process a job")
    try:print(json.dumps(run_once(args.manifest)))
    except Exception as exc:sys.stderr.write("research worker: "+str(exc)+"\n");sys.exit(1)
