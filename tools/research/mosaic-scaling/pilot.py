"""Coarse-grain signed strain components, then validate by held-out acquisition week."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import numpy as np

from fetch import sha, select

GRID = 700.0
ORIGIN = -3314693.24
SCALES = (4, 8, 16)
SCENARIOS = {"primary": (.75, 0, False), "strict_coverage": (1., 0, False),
             "shift_8_cells": (.75, 8, False), "swap_sides": (.75, 0, True)}
KEYS = ("dudx", "dudy", "dvdx", "dvdy")
LOGX = np.log(np.array(SCALES) / 8)  # pivot at 5.6 projected km
MODELS = ("pooled", "group_levels", "group_slopes")


def rate(g):
    ux, uy, vx, vy = g
    return np.sqrt((ux + vy)**2 + (ux - vy)**2 + (uy + vx)**2)


def stereo_k(degrees):
    """WGS84 ellipsoidal polar stereographic conformal scale, true at 70 N."""
    e = np.sqrt(0.0066943799901413165)
    def tm(a):
        p = np.deg2rad(a)
        t = np.tan(np.pi / 4 - p / 2) / ((1-e*np.sin(p))/(1+e*np.sin(p)))**(e/2)
        return t / (np.cos(p) / np.sqrt(1 - (e * np.sin(p))**2))
    return tm(degrees) / tm(70.)


def matrix_tiles(a, size):
    ny, nx = a.shape[-2:]
    return a.reshape(*a.shape[:-2], ny//size, size, nx//size, size).swapaxes(-3, -2)


def aggregate(g, lat, x_index, y_index, side, split, threshold, shift, label=False):
    """Use identical big-tile support across scales. Components have common finite mask."""
    size = 16
    # Full tiles only, anchored to product grid; no clip across the separating buffer.
    cols = np.flatnonzero(x_index <= split - 8 if side == "left" else x_index >= split + 8)
    if len(cols) < size:
        raise ValueError("not enough columns")
    start = int(cols[0] + (shift - x_index[cols[0]]) % size)
    top = int((shift - y_index[0]) % size)
    end = start + (int(cols[-1]) + 1 - start) // size * size
    bottom = top + (len(y_index)-top) // size * size
    g = g[:, top:bottom, start:end]
    lat = lat[top:bottom, start:end]
    if min(g.shape[1:]) < size:
        raise ValueError("region too small")
    good = np.isfinite(g[0])
    # Relatively uniform cells in the projection, corrected for true surface area.
    weights = np.zeros_like(lat)
    weights[good] = 1. / stereo_k(lat[good])**2
    minsize = 2 if label else 4
    fraction = matrix_tiles(good, minsize).mean(axis=(-2, -1))
    eligible = np.all(matrix_tiles(fraction >= threshold, size//minsize), axis=(-2,-1))
    if eligible.sum() < 4:
        raise ValueError("fewer than four coverage-qualified 11.2 km tiles")
    kept = np.repeat(np.repeat(eligible, size, axis=0), size, axis=1)
    weights[~kept] = 0
    ng = np.nan_to_num(g, nan=0.) * weights
    values = []
    for n in ((2,) if label else SCALES):
        w = matrix_tiles(weights, n).sum(axis=(-2,-1))
        av = matrix_tiles(ng, n).sum(axis=(-2,-1))[:,w>0] / w[w>0]
        values.append(float(np.average(rate(av), weights=w[w>0]) * 86400))
    return values, int(eligible.sum())


def extract(path, rec):
    import h5py
    with h5py.File(path) as f:
        x, y = (f[k][:] for k in ("x","y"))
        if not all(np.allclose(np.diff(c), GRID) for c in (x,y)):
            raise ValueError("expected ascending 700 m grid")
        proj = f["polar_stereographic"].attrs
        if not (np.isclose(proj["standard_parallel"].item(),70.) and
                np.isclose(proj["straight_vertical_longitude_from_pole"].item(),-45.)):
            raise ValueError("unrecognized polar stereographic projection")
        if not all(f[k].attrs.get("units") == b"s-1" for k in KEYS):
            raise ValueError("unexpected gradient units")
        lat = f["latitude"][:]
        g = np.array([f[k][:] for k in KEYS])
        flag = f["sea_ice_drift_reliability_flag"][:]
        valid = np.all(np.isfinite(g),axis=0) & np.isfinite(f["valid_shape"][:]) & np.isfinite(flag) & np.isfinite(lat)
        g[:,~valid] = np.nan
        ix, iy = (np.rint((v-ORIGIN)/GRID).astype(int) for v in (x,y))
        projected = ix[np.any(valid,axis=0)]
        if not len(projected):
            raise ValueError("entire file lacks valid drift gradients")
        split = .5 * (projected.min() + projected.max())
        ks = stereo_k(lat[valid])
        out = dict(rec, observed_ground_km_per_nominal_km=[float(1/ks.max()), float(1/ks.min())], scenarios={})
        for name,(coverage,shift,swap) in SCENARIOS.items():
            left,right = ("right","left") if swap else ("left","right")
            try:
                proxy, nleft = aggregate(g,lat,ix,iy,left,split,coverage,shift,label=True)
                target,nright = aggregate(g,lat,ix,iy,right,split,coverage,shift)
                if min(proxy+target)<=0:
                    raise ValueError("cannot log zero deformation")
                out["scenarios"][name] = dict(proxy_per_day=proxy[0], target_per_day=target, proxy_tiles=nleft, target_tiles=nright)
            except ValueError as exc:
                out["scenarios"][name] = {"excluded": str(exc)}
        return out


def design(group, k):
    g = np.repeat(np.asarray(group, dtype=float),len(LOGX))
    x = np.tile(LOGX,len(group))
    return np.column_stack([[1.]*len(x), x] + ([g] if k>=1 else []) + ([g*x] if k==2 else []))


def fit(train, threshold, k):
    group = [r["proxy_per_day"] > threshold for r in train]
    a = design(group,k)
    b = np.log([r["target_per_day"] for r in train]).ravel()
    w,_,rank,_ = np.linalg.lstsq(a,b,rcond=None)
    if rank != a.shape[1]:
        raise ValueError("insufficient training variation")
    return w


def guarded(a,b):
    week_a,week_b = (dt.date.fromisoformat(r["week"]) for r in (a,b))
    if abs((week_a-week_b).days)<=7:
        return False
    sa,ea,sb,eb = (dt.datetime.fromisoformat(s) for s in (a["start"],a["end"],b["start"],b["end"]))
    return ea < sb or eb < sa  # equality shares an acquisition


def evaluate(items, scenario):
    rows = [dict(s["scenarios"][scenario],week=s["week"],start=s["start"],end=s["end"]) for s in items if "excluded" not in s["scenarios"][scenario]]
    if len(set(r["week"] for r in rows)) != len(rows):
        raise ValueError("expected one pair per week")
    folds = []
    for r in rows:
        train = [s for s in rows if guarded(r,s)]
        if len(train)<6:
            continue
        threshold = float(np.median([s["proxy_per_day"] for s in train]))
        group = r["proxy_per_day"] > threshold
        err, shape = {}, {}
        for k,m in enumerate(MODELS):
            weights = fit(train,threshold,k)
            diff = (design([group],k) @ weights) - np.log(r["target_per_day"])
            err[m] = float(np.mean(diff**2))
            shape[m] = float(np.mean(np.abs(diff[[0,2]] - diff[1])))
        folds.append(dict(week=r["week"], n_train=len(train),threshold_per_day=threshold,high=group, log_mse=err,shape_error=shape))
    if not folds:
        return {"folds":[],"status":"insufficient temporal coverage"}
    threshold = float(np.median([s["proxy_per_day"] for s in rows]))
    w = fit(rows,threshold,2)
    wins = sum(f["log_mse"]["group_slopes"]<f["log_mse"]["group_levels"] for f in folds)
    return dict(n_weeks=len(rows),n_scored=len(folds),full_sample_proxy_median_per_day=threshold,
                full_sample_signed_slopes={"lower":float(w[1]),"higher":float(w[1]+w[3])},
                mean_held_out_log_mse={m:float(np.mean([f["log_mse"][m] for f in folds])) for m in MODELS},
                median_held_out_shape_error={m:float(np.median([f["shape_error"][m] for f in folds])) for m in MODELS},
                weeks_slopes_beat_levels=wins, folds=folds)


def save(path,data):
    path.write_text(json.dumps(data,indent=2,allow_nan=False)+"\n",encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    one = p.add_mutually_exclusive_group(required=True)
    one.add_argument("--cache",type=Path,help="Directory populated by fetch.py --download")
    one.add_argument("--records",type=Path,help="Refit the small archived derived summaries offline")
    p.add_argument("--out",type=Path,required=True)
    a=p.parse_args()
    a.out.mkdir(parents=True,exist_ok=True)
    if a.cache:
        rows=json.loads((a.cache/"selection.json").read_text())
        expected=select((a.cache/"index.tsv").read_text(encoding="utf-8-sig"))
        if [{k:v for k,v in r.items() if k!="sha256"} for r in rows]!=expected:
            raise ValueError("selection does not match the prespecified manifest filter")
        data=[]
        for r in rows:
            path=a.cache/r["file"]
            if sha(path)!=r.get("sha256"):
                raise ValueError("missing or changed raw file: "+r["file"])
            data.append(extract(path,r))
            print(r["week"],flush=True)
        save(a.out/"observations.json",data)
    else:
        data=json.loads(a.records.read_text(encoding="utf-8"))
    result={k:evaluate(data,k) for k in SCENARIOS}
    save(a.out/"validation.json",result)
    for k,r in result.items():
        print(k, r.get("mean_held_out_log_mse",r.get("status")))


if __name__=="__main__":
    main()

