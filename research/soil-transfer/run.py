#!/usr/bin/env python3
"""Site-held-out soil pH prediction from 16S OTU tables (Lauber et al. 2009, Qiita study 103).

Joins real per-sample OTU counts with measured soil pH, then compares a train-mean baseline
with microbiome models under leave-site-out CV. All numbers are written to results/.
Usage: python run.py [--cache DIR]   (needs numpy pandas scipy scikit-learn h5py)
"""
import argparse, glob, hashlib, io, json, os, re, urllib.request, zipfile
import h5py, numpy as np, pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut

HERE = os.path.dirname(os.path.abspath(__file__))
META_URL = "https://qiita.ucsd.edu/public_download/?data=sample_information&study_id=103"
BIOM_URL = "https://qiita.ucsd.edu/public_download/?data=biom&study_id=103&data_type=16S"
BIOM_MEMBER = "processed_data/238_otu_table.biom"   # one QIIME 1.9 closed-ref table, 89 samples
SEED = 0
MIN_READS = 200   # Post-hoc depth QC; excludes only BB1 (one read); see README.


def fetch(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "cell-lab-research"})
        with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
            f.write(r.read())
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def load(cache):
    prov = {}
    mz, bz = os.path.join(cache, "q103_meta.zip"), os.path.join(cache, "q103_biom.zip")
    prov["meta_sha256"], prov["biom_zip_sha256"] = fetch(META_URL, mz), fetch(BIOM_URL, bz)
    with zipfile.ZipFile(mz) as z:
        name = [n for n in z.namelist() if n.endswith(".txt")][0]
        meta = pd.read_csv(io.BytesIO(z.read(name)), sep="\t", dtype=str)
    with zipfile.ZipFile(bz) as z:
        raw = z.read(BIOM_MEMBER)
    prov["biom_member_sha256"] = hashlib.sha256(raw).hexdigest()
    with h5py.File(io.BytesIO(raw), "r") as h:
        samples = h["sample/ids"][:].astype(str)
        otus = h["observation/ids"][:].astype(str)
        tax = [";".join(t.astype(str)) for t in h["observation/metadata/taxonomy"][:]]
        # observation-major CSR: indptr over OTUs, indices are sample columns
        ip, ix, dv = (h["observation/matrix/" + k][:] for k in ("indptr", "indices", "data"))
        X = np.zeros((len(otus), len(samples)))
        for i in range(len(otus)):
            X[i, ix[ip[i]:ip[i + 1]]] = dv[ip[i]:ip[i + 1]]
    return meta, samples, otus, tax, X.T, prov


def prevalence_filter(Xtr, frac=0.10):
    return (Xtr > 0).mean(0) >= frac


def feats(Xc, keep):
    rel = Xc[:, keep] / Xc.sum(1, keepdims=True)
    return np.log10(rel + 1e-4)


def predict(model, Xc, y, tr, te, acid):
    if model == "mean_baseline":
        return np.full(len(te), y[tr].mean())
    if model == "acidobacteria_linear":   # single-feature, the paper's headline taxon
        a = acid[:, None]
        m = RidgeCV(alphas=[1e-3]).fit(a[tr], y[tr])
        return m.predict(a[te])
    keep = prevalence_filter(Xc[tr])
    F = feats(Xc, keep)
    if model == "ridge_otu":
        mu, sd = F[tr].mean(0), F[tr].std(0) + 1e-9
        m = RidgeCV(alphas=np.logspace(0, 4, 9)).fit((F[tr] - mu) / sd, y[tr])
        return m.predict((F[te] - mu) / sd)
    if model == "rf_otu":
        m = RandomForestRegressor(300, min_samples_leaf=2, max_features=0.3, random_state=SEED, n_jobs=-1)
        return m.fit(F[tr], y[tr]).predict(F[te])
    raise ValueError(model)


def cv(splits, models, Xc, y, acid):
    oof = {m: np.full(len(y), np.nan) for m in models}
    for tr, te in splits:
        for m in models:
            oof[m][te] = predict(m, Xc, y, tr, te, acid)
    return oof


def metrics(y, p):
    return float(np.sqrt(np.mean((y - p) ** 2))), float(1 - np.sum((y - p) ** 2) / np.sum((y - y.mean()) ** 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.expanduser("~/tmp/soil-transfer-cache"))
    args = ap.parse_args()
    meta, samples, otus, tax, Xc, prov = load(args.cache)

    meta = meta.set_index("sample_name")
    joined = meta.reindex(samples)
    y_all = pd.to_numeric(joined["ph"], errors="coerce").values
    reads_all = Xc.sum(1)
    ok = ~np.isnan(y_all) & (reads_all >= MIN_READS)
    audit = {"biom_samples": int(len(samples)), "metadata_rows": int(len(meta)),
             "biom_samples_in_metadata": int(joined.index.isin(meta.index).sum()),
             "biom_samples_with_numeric_pH": int((~np.isnan(y_all)).sum()),
             "dropped_below_min_reads": [str(s) for s in np.array(samples)[reads_all < MIN_READS]], "min_reads": MIN_READS,
             "samples_modelled": int(ok.sum()),
             "metadata_rows_without_biom_table_sample": sorted(set(meta.index) - set(samples)),
             "otus": int(len(otus)), "reads_per_sample_min_median_max": [int(v) for v in np.percentile(Xc.sum(1), [0, 50, 100])]}
    Xc, y = Xc[ok], y_all[ok]
    ids = np.array(samples)[ok]
    site = np.array([re.match(r"103\.([A-Za-z]+)", s).group(1) for s in ids])  # site code = ID prefix
    audit["sites"] = int(len(set(site)))
    audit["joined_table"] = "results/joined_samples.tsv"

    acid_cols = np.array([";p__Acidobacteria" in ";" + t.replace("; ", ";") for t in tax])
    acid = np.log10(Xc[:, acid_cols].sum(1) / Xc.sum(1) + 1e-3)
    audit["acidobacteria_otus"] = int(acid_cols.sum())

    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    pd.DataFrame({"sample": ids, "site": site, "ph": y, "reads": Xc.sum(1).astype(int),
                  "log10_acidobacteria_frac": acid}).to_csv(os.path.join(HERE, "results/joined_samples.tsv"), sep="\t", index=False)

    models = ["mean_baseline", "acidobacteria_linear", "ridge_otu", "rf_otu"]
    n = len(y)
    site_splits = list(LeaveOneGroupOut().split(Xc, y, site))
    rng = np.random.RandomState(SEED)
    perm = rng.permutation(n)                      # random 8-fold: replicate leakage control
    rand_splits = [(np.setdiff1d(np.arange(n), f), f) for f in np.array_split(perm, 8)]
    oof = {"leave_site_out": cv(site_splits, models, Xc, y, acid), "random_split_leaky": cv(rand_splits, models, Xc, y, acid)}

    # label-permutation null: permute pH across SITES (site-level mean structure kept), leave-site-out ridge
    us = np.unique(site)
    null = []
    for _ in range(20):
        m = dict(zip(us, rng.permutation(us)))
        yp = np.array([y[site == m[s]].mean() for s in site])
        yp = yp + (y - np.array([y[site == s].mean() for s in site]))
        o = cv(site_splits[:], ["ridge_otu"], Xc, yp, acid)["ridge_otu"]
        null.append(metrics(yp, o)[0])

    res = {"provenance": {**prov, "meta_url": META_URL, "biom_url": BIOM_URL, "biom_member": BIOM_MEMBER}, "audit": audit, "n": int(n), "results": {}}
    boot_sites = [rng.choice(us, len(us)) for _ in range(1000)]
    for scheme, o in oof.items():
        res["results"][scheme] = {}
        for m in models:
            rmse, r2 = metrics(y, o[m])
            d = {"rmse": rmse, "r2": r2}
            if m != "mean_baseline":
                # site-cluster bootstrap of RMSE(model) - RMSE(baseline); negative = model better
                diffs = []
                for bs in boot_sites:
                    idx = np.concatenate([np.where(site == s)[0] for s in bs])
                    diffs.append(metrics(y[idx], o[m][idx])[0] - metrics(y[idx], o["mean_baseline"][idx])[0])
                d["rmse_minus_baseline_ci95"] = [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))]
            res["results"][scheme][m] = d
    res["site_permutation_null_ridge_rmse"] = {"n_perm": len(null), "mean": float(np.mean(null)), "min": float(np.min(null))}
    pd.DataFrame({"sample": ids, "site": site, "ph": y, **{f"{s}__{m}": oof[s][m] for s in oof for m in models}}).to_csv(
        os.path.join(HERE, "results/predictions.tsv"), sep="\t", index=False)
    json.dump(res, open(os.path.join(HERE, "results/summary.json"), "w"), indent=2)
    print(json.dumps({k: res[k] for k in ("audit", "results", "site_permutation_null_ridge_rmse")}, indent=1))


if __name__ == "__main__":
    main()
