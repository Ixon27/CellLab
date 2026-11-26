#!/usr/bin/env python3
"""Does BBBC021-style compound morphology retrieval transfer to a second public Cell Painting study?

Part A  Audit: compound / feature overlap between BBBC021 (Caie 2010; Ljosa 2013 profiles) and the
        JUMP-Target-1 compound set (CPJUMP1 pilot, Chandrasekaran et al. 2024). Decides whether a
        cross-study transfer is even possible.
Part B  Batch-aware retrieval inside CPJUMP1 compound plates (24 plates, 7 conditions): same-compound
        replicate retrieval and compound-disjoint MoA 1-NN, scored with progressively stricter
        candidate pools (other plate / other cell line / other time point) and a label-free per-condition
        recentring, against permutation nulls and a DMSO well-position nuisance baseline.

Usage: python run.py [CACHE]     (default CACHE = ~/tmp/celllab-morph-transfer; BBBC021 profile header
                                   is read from ~/tmp/celllab-public-morphology if present, else fetched)
Design is fixed in README.md and the constants below. No label is used in any transform. No tuning.
"""
import hashlib
import json
import platform
import sys
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
SEED = 2026
N_BOOT = 2000
N_PERM = 200
S3 = "https://cellpainting-gallery.s3.amazonaws.com/cpg0000-jump-pilot/source_4/workspace/"
GH = ("https://raw.githubusercontent.com/jump-cellpainting/"
      "2024_Chandrasekaran_NatureMethods_CPJUMP1/56845c7d4dc322652952783d91dae0ffef47829f/")
BATCH = "2020_11_04_CPJUMP1"
LJOSA = ("https://cellpainting-gallery.s3.amazonaws.com/cpg0010-caie-drugresponse/broad-az/workspace/"
         "backend/ljosa_2013/analysis_batch_stable/ljosa_2013.csv")
LJOSA_SHA = "d356eec41bce816e19f7a2d2768949d1d7600702af3d8fde08770e30504f646d"
BBBC = "https://data.broadinstitute.org/bbbc/BBBC021/"
BBBC_SHA = {"BBBC021_v1_compound.csv": "e4b6868ea77eb1cef67cfe75dd792a2074ffde609c79d69c42deec131b1b88ec", "BBBC021_v1_moa.csv":
            "cddb6c6b72c043fd25f3a41d84624d4817927a1d76fe87dc829674181dd62719"}
VARIANTS = {"negcon_fs": "normalized_feature_select_negcon_batch",
            "plate_fs": "normalized_feature_select_batch"}
TRANSFORMS = ("negcon_fs", "plate_fs", "cond_center")  # cond_center = negcon_fs + label-free per-condition robust z
PRIMARY = "negcon_fs"
CORE = [("A549", 24), ("U2OS", 24), ("A549", 48), ("U2OS", 48)]  # density 100, Parental, no antibiotic
TIERS = ("same_condition", "cross_cell_line", "cross_time")
EXPECT = dict(plates=24, conditions=7, compounds=306)

SRC = json.loads((HERE / "sources.json").read_text())


def fetch(url, dest, sha):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print("download", url, file=sys.stderr)
        urllib.request.urlretrieve(url, dest)
    got = hashlib.sha256(dest.read_bytes()).hexdigest()
    if sha and got != sha:
        sys.exit(f"SHA256 mismatch for {dest.name}: {got} != {sha}")
    return got


def cond_id(r):
    return f"{r.Cell_type}_{r.Time}h_d{r.Density}_{r.Cell_line}"


# ---------------------------------------------------------------- data
def load(cache):
    raw = cache / "raw"
    exp_url = {"exp.tsv": GH + "benchmark/output/experiment-metadata.tsv",
               "ann.tsv": GH + "benchmark/input/JUMP-Target-1_compound_metadata_additional_annotations.tsv",
               "JUMP-Target-1_compound_metadata.tsv":
               S3 + "metadata/external_metadata/JUMP-Target-1_compound_metadata.tsv"}
    for f, u in exp_url.items():
        fetch(u, raw / f, SRC[f])
    exp = pd.read_csv(raw / "exp.tsv", sep="\t")
    exp = exp[(exp.Batch == BATCH) & (exp.Perturbation == "compound")].copy()
    exp["cond"] = exp.apply(cond_id, axis=1)
    ann = pd.read_csv(raw / "ann.tsv", sep="\t")
    frames = {k: [] for k in VARIANTS}
    for p in exp.Assay_Plate_Barcode:
        for k, v in VARIANTS.items():
            name = f"prof/{p}_{v}.csv.gz"
            fetch(f"{S3}profiles/{BATCH}/{p}/{p}_{v}.csv.gz", raw / name, SRC[name])
            d = pd.read_csv(raw / name)
            frames[k].append(d.assign(Metadata_cond=exp.set_index("Assay_Plate_Barcode").cond[p]))
    out = {}
    for k, fs in frames.items():
        d = pd.concat(fs, ignore_index=True)
        meta = [c for c in d.columns if c.startswith("Metadata")]
        feats = [c for c in d.columns if c not in meta]
        assert not d[feats].isna().any().any()
        out[k] = (d[meta].copy(), d[feats].to_numpy(float))
    return exp, ann, out


def cond_center(meta, X):
    """Label-free per-condition robust z (median / MAD over all wells of the condition)."""
    Z = np.empty_like(X)
    for c in meta.Metadata_cond.unique():
        m = (meta.Metadata_cond == c).to_numpy()
        med = np.median(X[m], 0)
        mad = np.median(np.abs(X[m] - med), 0) * 1.4826
        Z[m] = (X[m] - med) / np.where(mad > 1e-9, mad, 1.0)
    return Z


def unit(X):
    return X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)


# ---------------------------------------------------------------- tiers
def tier_conds(q, tier):
    """Candidate condition names for a core query condition `q` = (cell, time)."""
    cell, t = q
    if tier == "same_condition":
        return [(cell, t)]
    if tier == "cross_cell_line":
        return [("U2OS" if cell == "A549" else "A549", t)]
    return [(cell, 48 if t == 24 else 24)]


def cname(ct):
    return f"{ct[0]}_{ct[1]}h_d100_Parental"


def tier_pairs(tier):
    return [(cname(q), [cname(c) for c in tier_conds(q, tier)]) for q in CORE]


# ---------------------------------------------------------------- retrieval
def ap_from_order(rel_sorted, valid_sorted):
    """rel_sorted/valid_sorted: (nq, nc) in descending-similarity order; invalid slots sit at the end."""
    rel = rel_sorted & valid_sorted
    cs = np.cumsum(rel, 1)
    pos = np.arange(1, rel.shape[1] + 1)
    nrel = rel.sum(1)
    ap = (rel * cs / pos).sum(1) / np.maximum(nrel, 1)
    return ap, nrel, rel[:, 0]


class Retrieval:
    """Cosine retrieval of wells by label across allowed plate/condition pools."""

    def __init__(self, meta, U, qmask, cmask, allowed_cond, label):
        qi, ci = np.where(qmask)[0], np.where(cmask)[0]
        self.qi, self.ci = qi, ci
        S = U[qi] @ U[ci].T
        cq = meta.Metadata_cond.to_numpy()[qi]
        cc = meta.Metadata_cond.to_numpy()[ci]
        pq, pc = meta.Metadata_Plate.to_numpy()[qi], meta.Metadata_Plate.to_numpy()[ci]
        ok = np.zeros(S.shape, bool)
        for a in np.unique(cq):
            ok[cq == a] = np.isin(cc, allowed_cond.get(a, ()))[None, :]
        valid = ok & (pq[:, None] != pc[None, :])
        S = np.where(valid, S, -np.inf)
        self.order = np.argsort(-S, 1, kind="stable")
        self.valid_sorted = np.take_along_axis(valid, self.order, 1)
        self.lq = label[qi]
        self.lc = label[ci]
        self.plate_q = pq
        self.cond_q = cq

    def score(self, lc=None):
        lc = self.lc if lc is None else lc
        rel = (lc[self.order] == self.lq[:, None])
        return ap_from_order(rel, self.valid_sorted)


def per_group_mean(vals, groups, keep):
    s = pd.Series(vals[keep]).groupby(groups[keep]).mean()
    return s


def permuted_labels(meta, rng, lab, mask, by="Metadata_Plate"):
    """Shuffle labels among the `mask` wells inside each plate (keeps plate structure, breaks identity)."""
    lab = lab.copy()
    plates = meta[by].to_numpy()
    for p in np.unique(plates[mask]):
        idx = np.where(mask & (plates == p))[0]
        lab[idx] = lab[rng.permutation(idx)]
    return lab


def retrieval_block(meta, X, rng, boot_idx_cache):
    """All same-compound retrieval numbers for one transform matrix X."""
    U = unit(X)
    pert = meta.Metadata_broad_sample.notna().to_numpy()
    dmso = (meta.Metadata_control_type == "negcon").to_numpy()
    comp = meta.Metadata_InChIKey.astype("string").fillna("").to_numpy()
    well = meta.Metadata_Well.to_numpy()
    rows, comp_scores, nulls = [], {}, {}
    for tier in TIERS:
        pairs = tier_pairs(tier)
        allowed = {a: tuple(b) for a, b in pairs}
        qconds = [a for a, _ in pairs]
        cconds = sorted({c for _, b in pairs for c in b})
        condcol = meta.Metadata_cond.to_numpy()
        for kind, mask, label in (("compound", pert, comp), ("dmso_position", dmso, well)):
            R = Retrieval(meta, U, mask & np.isin(condcol, qconds), mask & np.isin(condcol, cconds), allowed, label)
            ap, nrel, top1 = R.score()
            keep = nrel > 0
            if kind == "compound":
                cs = per_group_mean(ap, R.lq, keep)
                t1 = per_group_mean(top1.astype(float), R.lq, keep)
                comp_scores[tier] = (cs, t1)
            # permutation null: shuffle candidate labels among wells within each plate
            null_mean, null_pool = [], []
            lab_c_full = label.copy()
            for _ in range(N_PERM):
                pl = permuted_labels(meta, rng, lab_c_full, mask)
                # queries and candidates carry the same permuted identity
                lq_orig = R.lq
                R.lq = pl[R.qi]
                apn, nrn, _ = R.score(pl[R.ci])
                R.lq = lq_orig
                kn = nrn > 0
                null_mean.append(apn[kn].mean())
                if kind == "compound":
                    null_pool.append(per_group_mean(apn, pl[R.qi], kn).to_numpy())
            thr = np.quantile(np.concatenate(null_pool), 0.95) if kind == "compound" else np.nan
            rows.append(dict(tier=tier, kind=kind, n_queries=int(keep.sum()),
                             n_groups=int(R.lq[keep].size and len(set(R.lq[keep]))),
                             mAP=float(ap[keep].mean()), top1=float(top1[keep].mean()),
                             null_mAP_mean=float(np.mean(null_mean)),
                             null_mAP_p95=float(np.quantile(null_mean, 0.95)),
                             perm_p=float((1 + np.sum(np.array(null_mean) >= ap[keep].mean())) / (1 + N_PERM)),
                             compound_ap_thr95=float(thr),
                             frac_compounds_above_null95=float((comp_scores[tier][0] > thr).mean())
                             if kind == "compound" else np.nan))
            if kind == "compound":
                nulls[tier] = thr
    return pd.DataFrame(rows), comp_scores, nulls


def boot_ci(diff_by_compound, rng_seed=SEED):
    v = np.asarray(diff_by_compound, float)
    rng = np.random.default_rng(rng_seed)
    idx = rng.integers(0, len(v), (N_BOOT, len(v)))
    b = v[idx].mean(1)
    return float(v.mean()), float(np.quantile(b, 0.025)), float(np.quantile(b, 0.975))


# ---------------------------------------------------------------- MoA
def moa_block(meta, X, ann, rng_seed=SEED):
    """Compound-disjoint 1-NN MoA call from compound-mean profiles across condition tiers."""
    pert = meta.Metadata_broad_sample.notna().to_numpy()
    lab = ann.drop_duplicates("InChIKey").set_index("InChIKey").moa_list
    cmean = {}
    for cnd in meta.Metadata_cond.unique():
        m = pert & (meta.Metadata_cond == cnd).to_numpy()
        df = pd.DataFrame(X[m]).groupby(meta.Metadata_InChIKey[m].to_numpy()).mean()
        cmean[cnd] = df
    out, per = [], {}
    for tier in TIERS:
        for q, cands in tier_pairs(tier):
            for c in cands:
                A, B = cmean[q], cmean[c]
                comps = [k for k in A.index if k in B.index and isinstance(lab.get(k), str)]
                A, B = A.loc[comps], B.loc[comps]
                L = np.array([lab[k] for k in comps])
                cnt = pd.Series(L).value_counts()
                S = unit(A.to_numpy()) @ unit(B.to_numpy()).T
                eye = np.eye(len(comps), dtype=bool)
                S[eye] = -np.inf  # compound-disjoint: never the same compound
                pred = L[S.argmax(1)]
                # majority baseline among other compounds (leave-one-compound-out)
                maj = np.empty(len(L), dtype=object)
                for i, l in enumerate(L):
                    c2 = cnt.copy()
                    c2[l] -= 1
                    maj[i] = c2.index[int(np.argmax(c2.to_numpy()))]
                elig = cnt.reindex(L).to_numpy() >= 2
                per[(tier, q, c)] = pd.DataFrame(dict(compound=np.array(comps)[elig], correct=(pred == L)[elig].astype(float),
                                                      maj=(maj == L)[elig].astype(float), query=q, cand=c, tier=tier))
    df = pd.concat(per.values(), ignore_index=True)
    return df


def summarize_moa(df):
    rows = []
    for tier, g in df.groupby("tier"):
        cs = g.groupby("compound")[["correct", "maj"]].mean()
        m, lo, hi = boot_ci(cs.correct)
        d, dlo, dhi = boot_ci(cs.correct - cs.maj)
        rows.append(dict(tier=tier, n_compounds=len(cs), acc=m, ci_lo=lo, ci_hi=hi,
                         majority=float(cs.maj.mean()), minus_majority=d, minus_majority_lo=dlo, minus_majority_hi=dhi))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- Part A
def overlap(cache, exp_meta):
    from rdkit import Chem, RDLogger
    from rdkit.Chem import inchi
    RDLogger.DisableLog("rdApp.*")
    raw = cache / "raw"
    old = Path.home() / "tmp/celllab-public-morphology/raw"
    for f, sha in BBBC_SHA.items():
        base = old if (old / f).exists() else raw
        fetch(BBBC + f, base / f, sha)
    base = old if (old / "BBBC021_v1_compound.csv").exists() else raw
    comp = pd.read_csv(base / "BBBC021_v1_compound.csv")
    moa = pd.read_csv(base / "BBBC021_v1_moa.csv")
    j = pd.read_csv(raw / "JUMP-Target-1_compound_metadata.tsv", sep="\t")
    j = j[j.broad_sample.notna() & (j.control_type != "negcon")] if "control_type" in j else j
    j = j[j.pert_iname.str.upper() != "DMSO"]
    jk = {k[:14]: n for k, n in zip(j.InChIKey, j.pert_iname)}
    rows = []
    for c in sorted(moa.compound.unique()):
        s = comp.loc[comp.compound == c, "smiles"]
        s = s.iloc[0] if len(s) and isinstance(s.iloc[0], str) else None
        key = None
        if s:
            mol = Chem.MolFromSmiles(s)
            key = inchi.MolToInchiKey(mol)[:14] if mol is not None else None
        names = j.pert_iname.str.lower().tolist()
        sim = max(((SequenceMatcher(None, c.lower(), n).ratio(), n) for n in names), default=(0, ""))
        rows.append(dict(bbbc021_compound=c, moa="; ".join(sorted(moa.loc[moa.compound == c, "moa"].unique())),
                         has_smiles=bool(s), jump_connectivity_match=jk.get(key), jump_best_name=sim[1],
                         jump_name_similarity=round(sim[0], 2)))
    ov = pd.DataFrame(rows)
    ov["structure_match"] = ov.jump_connectivity_match.notna()
    # raw feature-name overlap (ljosa_2013 profile header vs CPJUMP1 profile columns)
    lj = old / "ljosa_2013.csv"
    if not lj.exists():
        lj = raw / "ljosa_2013.csv"
    fetch(LJOSA, lj, LJOSA_SHA)
    lf = set(pd.read_csv(lj, nrows=0).columns)
    jf = set(c for c in pd.read_csv(raw / "prof" / f"{exp_meta.Assay_Plate_Barcode.iloc[0]}_{VARIANTS['negcon_fs']}.csv.gz",
                                    nrows=0).columns if not c.startswith("Metadata"))
    feat = dict(ljosa_columns=len(lf), jump_features=len(jf), shared_exact_names=len(lf & jf))
    return ov, feat, moa


# ---------------------------------------------------------------- main
def main():
    cache = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.home() / "tmp/celllab-morph-transfer"
    OUT.mkdir(exist_ok=True)
    exp, ann, data = load(cache)
    meta0 = data["negcon_fs"][0]
    assert exp.Assay_Plate_Barcode.nunique() == EXPECT["plates"] and exp.cond.nunique() == EXPECT["conditions"]
    pert = meta0.Metadata_broad_sample.notna()
    wells = meta0.groupby("Metadata_Plate").size()
    assert wells.max() == 384 and wells.min() >= 300  # a few plates lack wells in the public files
    assert meta0.Metadata_InChIKey[pert].nunique() == EXPECT["compounds"]
    for k in data:
        assert data[k][0].Metadata_Plate.equals(meta0.Metadata_Plate) and data[k][0].Metadata_Well.equals(meta0.Metadata_Well)
    data["cond_center"] = (meta0, cond_center(meta0, data["negcon_fs"][1]))

    ov, feat, moa = overlap(cache, exp)
    ov.to_csv(OUT / "bbbc021_jump_overlap.csv", index=False)

    rng = np.random.default_rng(SEED)
    blocks, scores = [], {}
    for t in TRANSFORMS:
        meta, X = data[t]
        df, cs, thr = retrieval_block(meta, X, rng, None)
        df.insert(0, "transform", t)
        blocks.append(df)
        scores[t] = cs
    ret = pd.concat(blocks, ignore_index=True)
    ret.to_csv(OUT / "retrieval_summary.csv", index=False)

    # compound-level scores + paired contrasts (compound-cluster bootstrap)
    cs_rows, con_rows = [], []
    for t in TRANSFORMS:
        for tier in TIERS:
            ap, t1 = scores[t][tier]
            for k in ap.index:
                cs_rows.append(dict(transform=t, tier=tier, inchikey=k, compound_ap=ap[k], compound_top1=t1[k]))
    pd.DataFrame(cs_rows).to_csv(OUT / "compound_scores.csv", index=False)

    def vec(t, tier):
        return scores[t][tier][0]

    def contrast(label, a, b):
        idx = a.index.intersection(b.index)
        m, lo, hi = boot_ci((a[idx] - b[idx]).to_numpy())
        con_rows.append(dict(contrast=label, n_compounds=len(idx), mean_diff=m, ci_lo=lo, ci_hi=hi))

    for tier in TIERS:  # batch-aware correction effect
        contrast(f"{tier}: cond_center - negcon_fs", vec("cond_center", tier), vec("negcon_fs", tier))
        contrast(f"{tier}: negcon_fs - plate_fs", vec("negcon_fs", tier), vec("plate_fs", tier))
    for t in TRANSFORMS:  # price of stricter pools (same compounds, same queries)
        for tier in TIERS[1:]:
            contrast(f"{t}: {tier} - same_condition", vec(t, tier), vec(t, "same_condition"))
        contrast(f"{t}: cross_time - cross_cell_line", vec(t, "cross_time"), vec(t, "cross_cell_line"))
    # extra: matched density / Cas9 pools for A549 48 h d100 parental
    meta, X = data["negcon_fs"]
    pd.DataFrame(con_rows).to_csv(OUT / "contrasts.csv", index=False)

    # secondary conditions: same-condition and A549_48_d100 vs density/Cas9 pools
    extra = []
    for t in TRANSFORMS:
        meta, X = data[t]
        U = unit(X)
        pert_m = meta.Metadata_broad_sample.notna().to_numpy()
        comp = meta.Metadata_InChIKey.astype("string").fillna("").to_numpy()
        cc = meta.Metadata_cond.to_numpy()
        pools = {"same_condition_other_plate": lambda q: [q],
                 "other_density_or_Cas9": lambda q: [c for c in np.unique(cc) if c != q and c.startswith("A549_48h")]}
        for q in sorted(np.unique(cc)):
            for pn, pf in pools.items():
                if pn == "other_density_or_Cas9" and q != "A549_48h_d100_Parental":
                    continue
                R = Retrieval(meta, U, pert_m & (cc == q), pert_m & np.isin(cc, pf(q)), {q: tuple(pf(q))}, comp)
                ap, nrel, top1 = R.score()
                k = nrel > 0
                extra.append(dict(transform=t, query_condition=q, pool=pn, n_plates_query=int(meta[cc == q].Metadata_Plate.nunique()),
                                  n_queries=int(k.sum()), mAP=float(ap[k].mean()), top1=float(top1[k].mean())))
    pd.DataFrame(extra).to_csv(OUT / "secondary_conditions.csv", index=False)

    # MoA
    moa_rows, moa_all = [], []
    for t in TRANSFORMS:
        meta, X = data[t]
        d = moa_block(meta, X, ann)
        d.insert(0, "transform", t)
        moa_all.append(d)
        s = summarize_moa(d)
        s.insert(0, "transform", t)
        moa_rows.append(s)
    moa_sum = pd.concat(moa_rows, ignore_index=True)
    moa_sum.to_csv(OUT / "moa_summary.csv", index=False)
    pd.concat(moa_all).to_csv(OUT / "moa_per_compound.csv", index=False)

    # overlap compounds: JUMP retrieval for the BBBC021-shared compounds
    shared = ov[ov.structure_match]
    jmap = {k[:14]: k for k in meta0.Metadata_InChIKey.dropna().unique()}
    sh_rows = []
    j = pd.read_csv(cache / "raw/JUMP-Target-1_compound_metadata.tsv", sep="\t")
    for _, r in shared.iterrows():
        key = j.InChIKey[j.pert_iname == r.jump_connectivity_match].iloc[0]
        row = dict(bbbc021_compound=r.bbbc021_compound, bbbc021_moa=r.moa, jump_name=r.jump_connectivity_match)
        for tier in TIERS:
            a = vec("negcon_fs", tier)
            row[f"compound_ap_{tier}"] = float(a.get(key, np.nan))
        row["jump_moa_annotation"] = ann.set_index("InChIKey").moa_list.get(key)
        sh_rows.append(row)
    pd.DataFrame(sh_rows).to_csv(OUT / "shared_compounds.csv", index=False)

    provenance = dict(python=platform.python_version(), numpy=np.__version__, pandas=pd.__version__, seed=SEED,
                      n_boot=N_BOOT, n_perm=N_PERM, feature_overlap=feat, source_hashes=SRC,
                      core_conditions=[cname(c) for c in CORE],
                      conditions={c: sorted(g.Assay_Plate_Barcode) for c, g in exp.groupby("cond")})
    (OUT / "provenance.json").write_text(json.dumps(provenance, indent=1))
    write_report(ret, pd.DataFrame(con_rows), pd.DataFrame(extra), moa_sum, ov, pd.DataFrame(sh_rows), feat, exp)
    figure(ret, moa_sum)
    print((OUT / "report.md").read_text())


def md(df, fmt="{:.3f}"):
    d = df.copy()
    for c in d.columns:
        if d[c].dtype.kind == "f":
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else fmt.format(v))
    head = "| " + " | ".join(d.columns) + " |\n|" + "---|" * len(d.columns) + "\n"
    return head + "\n".join("| " + " | ".join(map(str, r)) + " |" for r in d.itertuples(index=False)) + "\n"


def write_report(ret, con, extra, moa, ov, shared, feat, exp):
    conds = exp.groupby("cond").Assay_Plate_Barcode.nunique().rename("plates").reset_index()
    t = ["# Generated results (run.py)\n"]
    t.append("## Part A: BBBC021 vs JUMP-Target-1 overlap\n")
    t.append(f"BBBC021 labelled compounds: {len(ov)}; with a published SMILES: {int(ov.has_smiles.sum())}; "
             f"structure (InChIKey connectivity block) found in JUMP-Target-1: **{int(ov.structure_match.sum())}**.\n")
    t.append(f"Profile feature names: ljosa_2013 {feat['ljosa_columns']} columns, CPJUMP1 {feat['jump_features']} features, "
             f"exactly shared names: **{feat['shared_exact_names']}**.\n")
    t.append(md(ov[ov.structure_match | (ov.jump_name_similarity >= 0.8)][
        ["bbbc021_compound", "moa", "jump_connectivity_match", "jump_best_name", "jump_name_similarity"]]))
    t.append(md(shared))
    t.append("## Part B: CPJUMP1 compound plates\n")
    t.append(md(conds))
    t.append("### Same-compound retrieval (mAP, 1 = perfect; null = plate-wise label permutation)\n")
    t.append(md(ret[ret.kind == "compound"].drop(columns="kind")))
    t.append("### DMSO well-position nuisance baseline (same-position retrieval among DMSO wells)\n")
    t.append(md(ret[ret.kind == "dmso_position"][["transform", "tier", "n_queries", "mAP", "top1", "null_mAP_mean", "null_mAP_p95", "perm_p"]]))
    t.append("### Paired compound-bootstrap contrasts (mean AP difference, 95% CI)\n")
    t.append(md(con))
    t.append("### Secondary conditions (same-condition other-plate; A549 48 h d100 vs density/Cas9 plates)\n")
    t.append(md(extra))
    t.append("### Compound-disjoint MoA 1-NN (compound-mean profiles; eligible = class has >=2 compounds)\n")
    t.append(md(moa))
    (OUT / "report.md").write_text("\n".join(t))


def figure(ret, moa):
    c = ret[ret.kind == "compound"]
    fig, ax = plt.subplots(1, 2, figsize=(10, 3.8))
    w = 0.25
    for i, t in enumerate(TRANSFORMS):
        s = c[c["transform"] == t].set_index("tier").loc[list(TIERS)]
        ax[0].bar(np.arange(3) + i * w, s.mAP, w, label=t)
    nul = c[c["transform"] == PRIMARY].set_index("tier").loc[list(TIERS)].null_mAP_mean
    ax[0].plot(np.arange(3) + w, nul, "k_", ms=40, label="permutation null")
    ax[0].set_xticks(np.arange(3) + w, TIERS, fontsize=8)
    ax[0].set_ylabel("same-compound mAP")
    ax[0].legend(fontsize=7)
    for i, t in enumerate(TRANSFORMS):
        s = moa[moa["transform"] == t].set_index("tier").loc[list(TIERS)]
        ax[1].bar(np.arange(3) + i * w, s.acc, w, yerr=[s.acc - s.ci_lo, s.ci_hi - s.acc], label=t)
    mj = moa[moa["transform"] == PRIMARY].set_index("tier").loc[list(TIERS)].majority
    ax[1].plot(np.arange(3) + w, mj, "k_", ms=40, label="majority")
    ax[1].set_xticks(np.arange(3) + w, TIERS, fontsize=8)
    ax[1].set_ylabel("MoA 1-NN accuracy")
    ax[1].legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "primary.png", dpi=150)


if __name__ == "__main__":
    main()
