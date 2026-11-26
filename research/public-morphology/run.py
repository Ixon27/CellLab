#!/usr/bin/env python3
"""BBBC021 compound-disjoint MoA retrieval from public per-well morphology profiles,
scored against batch/plate nuisance baselines.

Usage: python run.py [CACHE]        (default CACHE = ~/tmp/celllab-public-morphology)

Inputs (downloaded into CACHE/raw if missing, every file must match its pinned SHA256):
  ljosa_2013.csv        per-well CellProfiler profiles, Broad Cell Painting Gallery cpg0010
  BBBC021_v1_image.csv  official BBBC021 image metadata (plate, well, compound, concentration)
  BBBC021_v1_moa.csv    official BBBC021 mechanism-of-action labels (103 treatments, 38 compounds)
Outputs: results/ next to this script. Only derived tables and one figure; no raw data.

The design is fixed in README.md and in the constants below. Nothing is tuned on the labels.
"""
import argparse
import hashlib
import json
import platform
import re
import sys
import urllib.request
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
SEED = 2026
N_BOOT = 10_000
N_PERM = 2_000
WHITEN_SHRINK = 0.5

CPG = "https://cellpainting-gallery.s3.amazonaws.com/cpg0010-caie-drugresponse/broad-az/workspace/"
BBBC = "https://data.broadinstitute.org/bbbc/BBBC021/"
SOURCES = {
    "ljosa_2013.csv": (
        CPG + "backend/ljosa_2013/analysis_batch_stable/ljosa_2013.csv",
        "d356eec41bce816e19f7a2d2768949d1d7600702af3d8fde08770e30504f646d", 6283373),
    "BBBC021_v1_image.csv": (
        BBBC + "BBBC021_v1_image.csv",
        "7fd8a9363970548736a03eba3e14bd2b737c967f0e0fdf436bc91004676f50e7", 3965784),
    "BBBC021_v1_moa.csv": (
        BBBC + "BBBC021_v1_moa.csv",
        "cddb6c6b72c043fd25f3a41d84624d4817927a1d76fe87dc829674181dd62719", 4404),
}
# Facts established by inspecting the pinned files; a mismatch means the sources changed.
EXPECT = dict(wells=632, dmso_wells=330, treated_wells=302, treatments=103, compounds=38,
              moas=12, plates=55, weeks=10)

# Image-position / object-index columns are not morphology and are dropped before anything else.
NON_MORPHOLOGY = re.compile(r"_Location_|_Center_[XY]$|ObjectNumber|_Number_|_Parent_|_Children_")
FEATURE_SETS = ("all", "dna_only", "no_dna", "density_proxy")
TRANSFORMS = ("raw_z", "plate_dmso", "plate_dmso_whiten")
PROTOCOLS = ("NSC", "NSCB_plate_group", "NSCB_week")
PRIMARY = ("plate_dmso", "all")
PROFILE = "profile"
NUISANCE = ("majority", "week_prior", "position_prior", "dmso_plate")


# ----------------------------------------------------------------------------- data
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(raw):
    raw.mkdir(parents=True, exist_ok=True)
    for name, (url, digest, size) in SOURCES.items():
        path = raw / name
        if not path.exists():
            print(f"download {url}", file=sys.stderr)
            tmp = path.with_suffix(path.suffix + ".part")
            req = urllib.request.Request(url, headers={"User-Agent": "celllab-public-morphology"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.replace(path)
        got = sha256(path)
        if got != digest or path.stat().st_size != size:
            sys.exit(f"{name}: sha256/size mismatch (got {got}); refusing to continue")


def load(raw):
    prof = pd.read_csv(raw / "ljosa_2013.csv")
    image = pd.read_csv(raw / "BBBC021_v1_image.csv")
    moa = pd.read_csv(raw / "BBBC021_v1_moa.csv")

    wells = image.drop_duplicates(["Image_Metadata_Plate_DAPI", "Image_Metadata_Well_DAPI"])
    chk = image.groupby(["Image_Metadata_Plate_DAPI", "Image_Metadata_Well_DAPI"])
    assert (chk[["Image_Metadata_Compound", "Image_Metadata_Concentration", "Replicate"]]
            .nunique() == 1).all().all(), "a well maps to several treatments"
    wells = wells.rename(columns={
        "Image_Metadata_Plate_DAPI": "plate", "Image_Metadata_Well_DAPI": "well",
        "Image_Metadata_Compound": "compound", "Image_Metadata_Concentration": "conc",
        "Replicate": "replicate"})[["plate", "well", "compound", "conc", "replicate"]]
    wells["key"] = wells.compound + "|" + wells.conc.round(6).astype(str)
    moa["key"] = moa.compound + "|" + moa.concentration.round(6).astype(str)
    assert moa.key.is_unique and len(moa) == 104

    prof = prof.rename(columns={"Image_Metadata_Plate": "plate", "Image_Metadata_Well": "well"})
    d = prof.merge(wells, on=["plate", "well"], how="left", validate="1:1").copy()
    assert d.compound.notna().all(), "profile well missing from official metadata"
    d = d.merge(moa[["key", "moa"]], on="key", how="left")
    assert d.moa.notna().all(), "profile well without an MoA label row"
    d["week"] = d.plate.str.extract(r"^Week(\d+)_", expand=False).astype(int)
    d["dmso"] = d.compound == "DMSO"
    d["pos"] = d.well

    cols = [c for c in prof.columns if c.split("_")[0] in ("Cells", "Cytoplasm", "Nuclei")
            and not NON_MORPHOLOGY.search(c)]
    X = d[cols].to_numpy(float)
    assert np.isfinite(X).all()
    keep = X.std(0) > 0
    cols = [c for c, k in zip(cols, keep) if k]
    return d.reset_index(drop=True), cols, wells, moa


def plate_groups(d):
    """Plates joined when they hold the same treated compound-concentration: the
    replicate plates of one plate map. Compounds never cross weeks in this file."""
    parent = {p: p for p in d.plate.unique()}

    def find(p):
        while parent[p] != p:
            parent[p] = parent[parent[p]]
            p = parent[p]
        return p

    for _, g in d[~d.dmso].groupby("key"):
        ps = g.plate.unique()
        for p in ps[1:]:
            parent[find(p)] = find(ps[0])
    roots = {p: find(p) for p in parent}
    ids = {r: i for i, r in enumerate(sorted(set(roots.values())))}
    return d.plate.map(lambda p: ids[roots[p]]).to_numpy()


def feature_mask(cols, name):
    def ch(n):
        return ("tub" if "CorrTub" in n else "actin" if "CorrActin" in n
                else "dapi" if "CorrDAPI" in n else "none")
    dna = np.array([c.startswith("Nuclei_") and ch(c) in ("none", "dapi") for c in cols])
    if name == "all":
        return np.ones(len(cols), bool)
    if name == "dna_only":
        return dna
    if name == "no_dna":
        return ~dna
    if name == "density_proxy":
        return np.array([c.startswith("Nuclei_Neighbors_") for c in cols])
    raise KeyError(name)


# ------------------------------------------------------------------------ transforms
def plate_dmso(X, plate, dmso):
    """Subtract each plate's DMSO median; divide by the pooled DMSO residual MAD."""
    Z = np.empty_like(X)
    for p in np.unique(plate):
        m = plate == p
        Z[m] = X[m] - np.median(X[m & dmso], axis=0)
    res = Z[dmso]
    mad = 1.4826 * np.median(np.abs(res - np.median(res, axis=0)), axis=0)
    sd = res.std(0, ddof=1)
    scale = np.where(mad > 0, mad, sd)
    assert (scale > 0).all()
    return Z / scale


def transform(X, kind, plate, dmso):
    if kind == "raw_z":
        return (X - X.mean(0)) / X.std(0)
    Z = plate_dmso(X, plate, dmso)
    if kind == "plate_dmso":
        return Z
    R = Z[dmso]
    C = np.cov(R, rowvar=False)
    C = (1 - WHITEN_SHRINK) * C + WHITEN_SHRINK * np.trace(C) / C.shape[0] * np.eye(C.shape[0])
    w, V = np.linalg.eigh(C)
    return Z @ (V / np.sqrt(w)) @ V.T


# --------------------------------------------------------------------------- units
def units(d, Z, Nz, level):
    """Rows scored as queries/candidates: treatments (replicate-wells averaged) or wells."""
    t = ~d.dmso.to_numpy()
    sel = d[t].reset_index(drop=True)
    P, N = Z[t], Nz[t]
    if level == "well":
        u = sel[["key", "compound", "moa", "week", "group", "pos"]].copy()
        return u, P, N
    rows = []
    keys = sel.groupby("key", sort=True).indices
    Pm, Nm = [], []
    for k, idx in keys.items():
        g = sel.iloc[idx]
        assert g.week.nunique() == 1 and g.group.nunique() == 1 and g.compound.nunique() == 1
        rows.append(dict(key=k, compound=g.compound.iloc[0], moa=g.moa.iloc[0],
                         week=int(g.week.iloc[0]), group=int(g.group.iloc[0]),
                         pos="", n_wells=len(idx)))
        Pm.append(P[idx].mean(0))
        Nm.append(N[idx].mean(0))
    return pd.DataFrame(rows), np.array(Pm), np.array(Nm)


def allowed_mask(u, protocol):
    comp = u.compound.to_numpy()
    a = comp[:, None] != comp[None, :]
    if protocol == "NSCB_week":
        w = u.week.to_numpy()
        a &= w[:, None] != w[None, :]
    elif protocol == "NSCB_plate_group":
        g = u.group.to_numpy()
        a &= g[:, None] != g[None, :]
    return a


def cosine_nn(P, allowed):
    Pn = P / np.linalg.norm(P, axis=1, keepdims=True)
    S = np.where(allowed, Pn @ Pn.T, -np.inf)
    return S.argmax(1)


def prior_prediction(allowed, same, Y):
    """Most common class (lowest class index on ties) among allowed candidates in `same`;
    falls back to all allowed candidates when none qualify."""
    c = (allowed & same).astype(float) @ Y
    fall = allowed.astype(float) @ Y
    c = np.where(c.sum(1, keepdims=True) > 0, c, fall)
    return c.argmax(1)


# -------------------------------------------------------------------------- scoring
def comp_counts(correct, elig, comp_idx, K):
    return (np.bincount(comp_idx, weights=(correct & elig).astype(float), minlength=K),
            np.bincount(comp_idx, weights=elig, minlength=K))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cache", nargs="?", default=str(Path.home() / "tmp" / "celllab-public-morphology"))
    cache = Path(ap.parse_args().cache).expanduser()
    raw = cache / "raw"
    fetch(raw)
    OUT.mkdir(exist_ok=True)

    d, cols, _, moa = load(raw)
    d["group"] = plate_groups(d)
    facts = dict(wells=len(d), dmso_wells=int(d.dmso.sum()), treated_wells=int((~d.dmso).sum()),
                 treatments=int(d[~d.dmso].key.nunique()), compounds=int(d[~d.dmso].compound.nunique()),
                 moas=int(d[~d.dmso].moa.nunique()), plates=int(d.plate.nunique()),
                 weeks=int(d.week.nunique()))
    assert facts == EXPECT, (facts, EXPECT)
    assert d[d.dmso].groupby("plate").size().min() >= 3
    X_all = d[cols].to_numpy(float)
    plate = d.plate.to_numpy()
    dmso = d.dmso.to_numpy()
    print(f"{facts}; {len(cols)} usable features; {d.group.nunique()} plate groups", file=sys.stderr)

    # Nuisance profile: each plate's own DMSO median (treatment-independent plate state).
    Xz = (X_all - X_all.mean(0)) / X_all.std(0)
    pm = {p: np.median(Xz[(plate == p) & dmso], axis=0) for p in np.unique(plate)}
    Nz = np.array([pm[p] for p in plate])
    Nz = Nz - np.mean(list(pm.values()), axis=0)

    classes = sorted(d[~d.dmso].moa.unique())
    compounds = sorted(d[~d.dmso].compound.unique())
    K = len(compounds)

    # transformed profiles, per feature set
    Zs = {}
    for fs in FEATURE_SETS:
        m = feature_mask(cols, fs)
        for tr in TRANSFORMS:
            Zs[tr, fs] = transform(X_all[:, m], tr, plate, dmso)

    rng = np.random.default_rng(SEED)
    boot = rng.integers(0, K, size=(N_BOOT, K))
    perm_rng = np.random.default_rng(SEED + 1)

    def acc_boot(c, n):
        return c[boot].sum(1) / n[boot].sum(1)

    records, preds, results = [], [], {}
    store, meta = {}, {}
    for level in ("treatment", "well"):
        u0, _, _ = units(d, Zs["plate_dmso", "all"], Nz, level)
        y = u0.moa.map({c: i for i, c in enumerate(classes)}).to_numpy()
        Y = np.eye(len(classes))[y]
        comp_idx = u0.compound.map({c: i for i, c in enumerate(compounds)}).to_numpy()
        week, grp, pos = u0.week.to_numpy(), u0.group.to_numpy(), u0.pos.to_numpy()
        same_week = week[:, None] == week[None, :]
        same_pos = (pos[:, None] == pos[None, :]) if level == "well" else None
        comp_y = np.array([y[comp_idx == k][0] for k in range(K)])

        for protocol in PROTOCOLS:
            allowed = allowed_mask(u0, protocol)
            elig = (allowed.astype(float) @ Y)[np.arange(len(y)), y] > 0
            meta[level, protocol] = (elig, y, comp_idx)

            methods = {}   # (method, transform, features) -> predicted class index
            nn_of = {}
            for (tr, fs), Z in Zs.items():
                u, P, _ = units(d, Z, Nz, level)
                assert u.key.equals(u0.key)
                nn = cosine_nn(P, allowed)
                nn_of[tr, fs] = nn
                methods[PROFILE, tr, fs] = y[nn]
            _, _, N = units(d, Zs["plate_dmso", "all"], Nz, level)
            methods["dmso_plate", "NA", "NA"] = y[cosine_nn(N, allowed)]
            methods["majority", "NA", "NA"] = prior_prediction(allowed, np.ones_like(allowed), Y)
            methods["week_prior", "NA", "NA"] = prior_prediction(allowed, same_week, Y)
            if level == "well":
                methods["position_prior", "NA", "NA"] = prior_prediction(allowed, same_pos, Y)

            for (m, tr, fs), pred in methods.items():
                c, n = comp_counts(pred == y, elig, comp_idx, K)
                recall = [((pred == y) & elig & (y == i)).sum() / max((elig & (y == i)).sum(), 1)
                          for i in range(len(classes)) if (elig & (y == i)).any()]
                acc = c.sum() / n.sum()
                lo, hi = np.nanpercentile(acc_boot(c, n), [2.5, 97.5])
                p = np.nan
                if m == PROFILE:
                    nn = nn_of[tr, fs]
                    hits = 0
                    for _ in range(N_PERM):
                        yc = perm_rng.permutation(comp_y)
                        yp = yc[comp_idx]
                        e = (allowed & (yp[:, None] == yp[None, :])).any(1)
                        hits += (yp[nn][e] == yp[e]).mean() >= acc - 1e-12
                    p = (1 + hits) / (1 + N_PERM)
                results[level, protocol, m, tr, fs] = (c, n)
                store[level, protocol, m, tr, fs] = pred
                records.append(dict(
                    level=level, protocol=protocol, method=m, transform=tr, features=fs,
                    n_units=len(y), n_eligible=int(elig.sum()), eligible_fraction=elig.mean(),
                    n_compounds_eligible=int((n > 0).sum()), n_correct=int(c.sum()),
                    accuracy=acc, ci_lo=lo, ci_hi=hi, macro_recall=float(np.mean(recall)),
                    perm_p=p))

            if level == "treatment":
                prim = methods[PROFILE, *PRIMARY]
                nn = nn_of[PRIMARY]
                for i in range(len(y)):
                    preds.append(dict(
                        protocol=protocol, key=u0.key[i], compound=u0.compound[i], week=int(week[i]),
                        plate_group=int(grp[i]), true_moa=classes[y[i]], eligible=bool(elig[i]),
                        pred_profile=classes[prim[i]],
                        nearest_compound=u0.compound[nn[i]] if allowed[i].any() else "",
                        pred_majority=classes[methods["majority", "NA", "NA"][i]],
                        pred_week_prior=classes[methods["week_prior", "NA", "NA"][i]],
                        pred_dmso_plate=classes[methods["dmso_plate", "NA", "NA"][i]]))

    summary = pd.DataFrame(records)
    summary.to_csv(OUT / "summary.csv", index=False, float_format="%.6g")

    # paired compound-cluster contrasts
    def contrast(level, protocol, a, b, label):
        ca, na = results[(level, protocol, *a)]
        cb, nb = results[(level, protocol, *b)]
        assert (na == nb).all()
        d_pt = ca.sum() / na.sum() - cb.sum() / nb.sum()
        db = acc_boot(ca, na) - acc_boot(cb, nb)
        lo, hi = np.nanpercentile(db, [2.5, 97.5])
        return dict(level=level, protocol=protocol, contrast=label, difference=d_pt,
                    ci_lo=lo, ci_hi=hi, ci_lo_above_zero=bool(lo > 0))

    rows = []
    ref = (PROFILE, *PRIMARY)
    for level in ("treatment", "well"):
        for protocol in PROTOCOLS:
            for nuis in NUISANCE:
                if (level, protocol, nuis, "NA", "NA") in results:
                    rows.append(contrast(level, protocol, ref, (nuis, "NA", "NA"),
                                         f"profile[plate_dmso,all] - {nuis}"))
            rows.append(contrast(level, protocol, ref, (PROFILE, "raw_z", "all"),
                                 "plate_dmso - raw_z (all features)"))
            rows.append(contrast(level, protocol, ref, (PROFILE, "plate_dmso_whiten", "all"),
                                 "plate_dmso - plate_dmso_whiten (all features)"))
            for fs in ("dna_only", "density_proxy", "no_dna"):
                rows.append(contrast(level, protocol, ref, (PROFILE, "plate_dmso", fs),
                                     f"all features - {fs} (plate_dmso)"))
    def matched(level, protocol, key, label):
        """Same queries for both: NSC accuracy restricted to the queries eligible under `protocol`,
        minus the accuracy under `protocol`. Positive = the NSC score was inflated by shortcuts."""
        elig, y, ci_ = meta[level, protocol]
        p0 = store[(level, "NSC", *key)]
        c1, n = results[(level, protocol, *key)]
        c0 = np.bincount(ci_, weights=((p0 == y) & elig).astype(float), minlength=K)
        db = (c0[boot].sum(1) - c1[boot].sum(1)) / n[boot].sum(1)
        lo, hi = np.nanpercentile(db, [2.5, 97.5])
        return dict(level=level, protocol=protocol, contrast=label,
                    difference=(c0.sum() - c1.sum()) / n.sum(), ci_lo=lo, ci_hi=hi,
                    ci_lo_above_zero=bool(lo > 0), n_queries=int(n.sum()),
                    acc_nsc_same_queries=c0.sum() / n.sum(), acc_protocol=c1.sum() / n.sum())

    for level in ("treatment", "well"):
        for protocol in ("NSCB_plate_group", "NSCB_week"):
            for key, name in [((PROFILE, "plate_dmso", "all"), "profile[plate_dmso,all]"),
                              ((PROFILE, "plate_dmso", "dna_only"), "profile[plate_dmso,dna_only]"),
                              ((PROFILE, "plate_dmso", "density_proxy"), "profile[plate_dmso,density_proxy]"),
                              (("dmso_plate", "NA", "NA"), "dmso_plate")]:
                rows.append(matched(level, protocol, key,
                                    f"matched queries: NSC - {protocol}, {name}"))
    con = pd.DataFrame(rows)
    con.to_csv(OUT / "contrasts.csv", index=False, float_format="%.6g")

    # primary-configuration per-class recall, confusion, per-compound scores, predictions
    P = pd.DataFrame(preds)
    P.to_csv(OUT / "predictions.csv", index=False)
    recs, conf, comp_rows = [], [], []
    for protocol in PROTOCOLS:
        q = P[(P.protocol == protocol)]
        e = q[q.eligible]
        for m in ("profile", "majority", "week_prior", "dmso_plate"):
            for moa_name in classes:
                s = q[q.true_moa == moa_name]
                se = s[s.eligible]
                recs.append(dict(protocol=protocol, method=m, moa=moa_name, n_units=len(s),
                                 n_eligible=len(se), n_correct=int((se[f"pred_{m}"] == moa_name).sum()),
                                 recall=(se[f"pred_{m}"] == moa_name).mean() if len(se) else np.nan))
        for (t, p), n in e.groupby(["true_moa", "pred_profile"]).size().items():
            conf.append(dict(protocol=protocol, true_moa=t, pred_profile=p, n=int(n)))
        for comp, g in q.groupby("compound"):
            ge = g[g.eligible]
            comp_rows.append(dict(protocol=protocol, compound=comp, true_moa=g.true_moa.iloc[0],
                                  week=int(g.week.iloc[0]), n_treatments=len(g), n_eligible=len(ge),
                                  n_correct=int((ge.pred_profile == ge.true_moa).sum())))
    pd.DataFrame(recs).to_csv(OUT / "per_moa.csv", index=False, float_format="%.6g")
    pd.DataFrame(conf).to_csv(OUT / "confusion.csv", index=False)
    pd.DataFrame(comp_rows).to_csv(OUT / "compound_scores.csv", index=False)

    figure(summary)
    report(summary, con, pd.DataFrame(recs), facts, len(cols), int(d.group.nunique()))

    prov = dict(
        sources={n: dict(url=u, sha256=h, bytes=s) for n, (u, h, s) in SOURCES.items()},
        facts=facts, usable_features=len(cols), plate_groups=int(d.group.nunique()),
        feature_sets={fs: int(feature_mask(cols, fs).sum()) for fs in FEATURE_SETS},
        design=dict(seed=SEED, n_boot=N_BOOT, n_perm=N_PERM, whiten_shrink=WHITEN_SHRINK,
                    primary=dict(level="treatment", transform=PRIMARY[0], features=PRIMARY[1]),
                    protocols=list(PROTOCOLS)),
        taxol_0p3_wells_in_profile_file=int((d.key == "taxol|0.3").sum()),
        python=platform.python_version(), numpy=np.__version__, pandas=pd.__version__,
        matplotlib=matplotlib.__version__)
    (OUT / "provenance.json").write_text(json.dumps(prov, indent=2) + "\n")
    print(summary[(summary.level == "treatment") & (summary["transform"].isin(["NA", "plate_dmso"]))
                  & (summary.features.isin(["NA", "all"]))]
          [["protocol", "method", "n_eligible", "accuracy", "ci_lo", "ci_hi", "perm_p"]]
          .to_string(index=False, float_format=lambda v: f"{v:.3f}"))


def figure(summary):
    s = summary[(summary.level == "treatment")]
    items = [("profile, all features", (PROFILE, "plate_dmso", "all")),
             ("profile, DNA channel only", (PROFILE, "plate_dmso", "dna_only")),
             ("profile, neighbour density only", (PROFILE, "plate_dmso", "density_proxy")),
             ("plate DMSO profile (nuisance)", ("dmso_plate", "NA", "NA")),
             ("same-week prior (nuisance)", ("week_prior", "NA", "NA")),
             ("majority class (nuisance)", ("majority", "NA", "NA"))]
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6), sharex=True)
    for ax, protocol in zip(axes, PROTOCOLS):
        for i, (label, (m, tr, fs)) in enumerate(items):
            r = s[(s.protocol == protocol) & (s.method == m) & (s["transform"] == tr)
                  & (s.features == fs)].iloc[0]
            col = "#1b6ca8" if m == PROFILE else "#999999"
            ax.barh(i, r.accuracy, color=col)
            ax.errorbar(r.accuracy, i, xerr=[[max(r.accuracy - r.ci_lo, 0)], [max(r.ci_hi - r.accuracy, 0)]],
                        color="black", capsize=2, lw=1)
        ax.set_yticks(range(len(items)))
        ax.set_yticklabels([i[0] for i in items] if protocol == PROTOCOLS[0] else [])
        ax.invert_yaxis()
        r0 = s[(s.protocol == protocol) & (s.method == PROFILE)].iloc[0]
        ax.set_title(f"{protocol}\n{r0.n_eligible}/{r0.n_units} treatments eligible", fontsize=9)
        ax.set_xlim(0, 1)
    fig.supxlabel("1-NN MoA accuracy (compound-bootstrap 95% CI)")
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(OUT / "primary.png", dpi=150)
    plt.close(fig)


def report(summary, con, per_moa, facts, n_features, n_groups):
    """Numbers only (results/report.md). The verdict applies the rule stated in README.md."""
    def ci(r):
        return f"{r.accuracy:.3f} [{r.ci_lo:.3f}, {r.ci_hi:.3f}]"

    t = summary[summary.level == "treatment"]
    L = ["# Generated by run.py: numbers and the pre-specified rule only; interpretation is in README.md", "",
         f"Cohort: {facts['treated_wells']} treated + {facts['dmso_wells']} DMSO wells, {facts['plates']} plates, "
         f"{facts['weeks']} weeks, {n_groups} plate groups, {facts['treatments']} treatments of "
         f"{facts['compounds']} compounds in {facts['moas']} MoA classes; {n_features} usable features.", "",
         "## Treatment-level 1-NN MoA accuracy (compound-bootstrap 95% CI); queries restricted to eligible treatments", "",
         "| protocol | method | eligible / total | accuracy [95% CI] | permutation p |", "|---|---|---:|---|---:|"]
    for protocol in PROTOCOLS:
        for m, tr, fs, label in [(PROFILE, "plate_dmso", "all", "profile (plate-DMSO, all features)"),
                                 ("dmso_plate", "NA", "NA", "nuisance: plate DMSO profile"),
                                 ("week_prior", "NA", "NA", "nuisance: same-week prior"),
                                 ("majority", "NA", "NA", "nuisance: majority class")]:
            r = t[(t.protocol == protocol) & (t.method == m) & (t["transform"] == tr) & (t.features == fs)].iloc[0]
            p = "" if np.isnan(r.perm_p) else f"{r.perm_p:.4f}"
            L.append(f"| {protocol} | {label} | {r.n_eligible} / {r.n_units} | {ci(r)} | {p} |")
    L += ["", "## Pre-specified rule: profile advantage over each nuisance baseline (treatment level)", "",
          "Supported in a protocol only if the lower 95% compound-bootstrap bound of the paired accuracy "
          "difference is above 0 against all three nuisance baselines.", "",
          "| protocol | vs majority | vs same-week prior | vs plate DMSO profile | rule |", "|---|---|---|---|---|"]
    c = con[con.level == "treatment"]
    for protocol in PROTOCOLS:
        cells, ok = [], True
        for nuis in ("majority", "week_prior", "dmso_plate"):
            r = c[(c.protocol == protocol) & (c.contrast == f"profile[plate_dmso,all] - {nuis}")].iloc[0]
            cells.append(f"{r.difference:+.3f} [{r.ci_lo:+.3f}, {r.ci_hi:+.3f}]")
            ok &= bool(r.ci_lo_above_zero)
        L.append(f"| {protocol} | " + " | ".join(cells) + f" | {'supported' if ok else 'not supported'} |")
    L += ["", "## Matched queries: NSC score on exactly the queries that survive the stricter exclusion",
          "", "Difference = NSC accuracy on those queries minus the stricter-protocol accuracy (paired "
          "compound bootstrap). Positive = the plain compound-disjoint score was higher on identical queries.", "",
          "| level | stricter protocol | method | queries | NSC, same queries | stricter | difference [95% CI] |",
          "|---|---|---|---:|---:|---:|---|"]
    for _, r in con[con.contrast.str.startswith("matched queries")].iterrows():
        L.append(f"| {r.level} | {r.protocol} | {r.contrast.split(', ')[-1]} | {int(r.n_queries)} | "
                 f"{r.acc_nsc_same_queries:.3f} | {r.acc_protocol:.3f} | "
                 f"{r.difference:+.3f} [{r.ci_lo:+.3f}, {r.ci_hi:+.3f}] |")
    L += ["", "## Sensitivity: treatment-level accuracy by transform and feature set", "",
          "| protocol | transform | features | accuracy [95% CI] |", "|---|---|---|---|"]
    for protocol in PROTOCOLS:
        for _, r in t[(t.protocol == protocol) & (t.method == PROFILE)].iterrows():
            L.append(f"| {protocol} | {r['transform']} | {r.features} | {ci(r)} |")
    L += ["", "## MoA coverage under batch-disjoint protocols (profile method; eligible = a same-MoA candidate "
          "from another compound survives the exclusion)", "",
          "| MoA | " + " | ".join(f"{p}: eligible/total, recall" for p in PROTOCOLS) + " |",
          "|---|" + "---|" * len(PROTOCOLS)]
    pm = per_moa[per_moa.method == PROFILE]
    for moa_name in sorted(pm.moa.unique()):
        cells = []
        for protocol in PROTOCOLS:
            r = pm[(pm.protocol == protocol) & (pm.moa == moa_name)].iloc[0]
            rec = "n/a" if r.n_eligible == 0 else f"{r.recall:.2f}"
            cells.append(f"{r.n_eligible}/{r.n_units}, {rec}")
        L.append(f"| {moa_name} | " + " | ".join(cells) + " |")
    L += ["", "## Well-level accuracy (profile vs nuisance, same protocols)", "",
          "| protocol | method | eligible / total | accuracy [95% CI] |", "|---|---|---:|---|"]
    w = summary[(summary.level == "well")]
    for protocol in PROTOCOLS:
        for m, tr, fs in [(PROFILE, "plate_dmso", "all")] + [(n, "NA", "NA") for n in NUISANCE]:
            r = w[(w.protocol == protocol) & (w.method == m) & (w["transform"] == tr) & (w.features == fs)].iloc[0]
            L.append(f"| {protocol} | {m} | {r.n_eligible} / {r.n_units} | {ci(r)} |")
    (OUT / "report.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
