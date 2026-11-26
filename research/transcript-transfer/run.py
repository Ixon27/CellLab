#!/usr/bin/env python3
"""Split-donor reproducibility of cell-type-specific IFN-beta responses (Kang et al. 2018, GSE96583 batch 2).

Usage: python run.py [CACHE_DIR] [RESULTS_DIR]
Defaults: ~/tmp/celllab-transcript-transfer, ./results

Pre-specified design (see README.md). Only NumPy, pandas and SciPy are used.
"""
import gzip
import hashlib
import io
import itertools
import json
import sys
import tarfile
import urllib.request
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import mmread
from scipy.stats import spearmanr

warnings.filterwarnings("ignore", category=DeprecationWarning)

BASE = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96583/suppl/"
FILES = {
    "GSE96583_RAW.tar": "e5d41a3248a813f99d68fd5c9eb9773de7f46a83680a67f4a02d683b8955fe80",
    "GSE96583_batch2.genes.tsv.gz": "93aa4e9b530ef9d6411ca129b416324c5cc1cc5a01a1fa6ed4f4a845480ed3ca",
    "GSE96583_batch2.total.tsne.df.tsv.gz": "1d57e72e92ca8695250e88cc0f1c3fa8c0be1175d974f8b427c58f1274dc6c09",
}
CTRL_MTX, STIM_MTX = "GSM2560248_2.1.mtx.gz", "GSM2560249_2.2.mtx.gz"
CTRL_BC, STIM_BC = "GSM2560248_barcodes.tsv.gz", "GSM2560249_barcodes.tsv.gz"

SEED = 2026
MIN_CELLS = 10        # per donor x cell type x condition, otherwise cell type excluded for all donors
MIN_GENE_COUNTS = 200  # total UMIs over retained singlets; fixed gene universe, independent of any split
TOP_RESPONSIVE = 500   # genes picked from half A only for the "responsive-gene" panel
TOP_N = 100            # top-N gene overlap
N_PERM = 20            # within-donor cell-type-label permutations per split
CURVE_PAIRS = 200      # random disjoint donor-set pairs per k in the donor curve


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fetch(cache):
    cache.mkdir(parents=True, exist_ok=True)
    for name, digest in FILES.items():
        p = cache / name
        if not p.exists():
            print("downloading", name, flush=True)
            urllib.request.urlretrieve(BASE + name, p)
        got = sha256(p)
        if got != digest:
            raise SystemExit(f"checksum mismatch for {name}: {got}")


def load(cache):
    meta = pd.read_csv(cache / "GSE96583_batch2.total.tsne.df.tsv.gz", sep="\t")
    meta = meta.rename_axis("barcode").reset_index()
    genes = pd.read_csv(cache / "GSE96583_batch2.genes.tsv.gz", sep="\t", header=None, names=["ensembl", "symbol"])
    mats = []
    with tarfile.open(cache / "GSE96583_RAW.tar") as tf:
        def read(name):
            return gzip.decompress(tf.extractfile(name).read())
        for mtx, bc in ((CTRL_MTX, CTRL_BC), (STIM_MTX, STIM_BC)):
            m = mmread(io.BytesIO(read(mtx))).tocsc()  # genes x cells
            bcs = pd.read_csv(io.BytesIO(read(bc)), header=None)[0].astype(str).values
            if m.shape[1] != len(bcs) or m.shape[0] != len(genes):
                raise SystemExit("matrix/barcode/gene dimension mismatch")
            mats.append((m, bcs))
    return meta, genes, mats


def pseudobulk(meta, genes, mats):
    meta = meta[(meta.multiplets == "singlet") & meta.cell.notna()].copy()
    meta["stim"] = meta["stim"].astype(str)
    keep_types = []
    counts = meta.groupby(["cell", "stim", "ind"]).size()
    for ct in sorted(meta.cell.unique()):
        sub = counts[ct]
        if sub.shape[0] == 16 and sub.min() >= MIN_CELLS:
            keep_types.append(ct)
    donors = sorted(meta.ind.unique())
    meta = meta[meta.cell.isin(keep_types)]
    pb = {}
    for (m, bcs), cond in zip(mats, ("ctrl", "stim")):
        idx = {b: i for i, b in enumerate(bcs)}
        # GEO metadata disambiguates 313 stim barcodes that collide with ctrl by writing suffix -11 instead of -1
        sub = meta[meta.stim == cond]
        for (ct, d), g in sub.groupby(["cell", "ind"]):
            cols = [idx[b[:-1] if (cond == "stim" and b.endswith("-11")) else b] for b in g.barcode]
            pb[(ct, d, cond)] = np.asarray(m[:, cols].sum(axis=1)).ravel()
    total = sum(v for v in pb.values())
    gene_keep = total >= MIN_GENE_COUNTS
    ncell = meta.groupby(["cell", "ind", "stim"]).size()
    return keep_types, donors, pb, gene_keep, ncell


def lfc_tensor(keep_types, donors, pb, gene_keep):
    """donor x type x gene log2 fold change of CPM-normalised pseudobulk (prior 0.5 count)."""
    tot = {k: v.sum() for k, v in pb.items()}  # library size over all genes, not only kept ones
    L = np.zeros((len(donors), len(keep_types), int(gene_keep.sum())))
    for i, d in enumerate(donors):
        for j, ct in enumerate(keep_types):
            c, s = pb[(ct, d, "ctrl")], pb[(ct, d, "stim")]
            lc = np.log2((c[gene_keep] + 0.5) / (tot[(ct, d, "ctrl")] + 1.0) * 1e6)
            ls = np.log2((s[gene_keep] + 0.5) / (tot[(ct, d, "stim")] + 1.0) * 1e6)
            L[i, j] = ls - lc
    return L


def pearson(a, b):
    a = a - a.mean()
    b = b - b.mean()
    den = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / den) if den > 0 else np.nan


def spear(a, b):
    return float(spearmanr(a, b).statistic)


def half_estimates(L, A):
    """Mean over donors in A -> type x gene; plus leave-one-type-out pooled signature (equal weight)."""
    E = L[list(A)].mean(axis=0)
    n = E.shape[0]
    P = (E.sum(axis=0, keepdims=True) - E) / (n - 1)  # P[c] = mean of the other cell types
    return E, P


def top_overlap(x, y, n, absolute=False):
    kx = np.argsort(-(np.abs(x) if absolute else x))[:n]
    ky = np.argsort(-(np.abs(y) if absolute else y))[:n]
    return len(set(kx) & set(ky)) / n


def metrics_for_split(L, A, B, types, perm_rng=None):
    EA, PA = half_estimates(L, A)
    EB, PB = half_estimates(L, B)
    DA, DB = EA - PA, EB - PB  # cell-type-specific deviation from the other-type pooled signature
    G = EA.shape[1]
    rows = []
    for j, ct in enumerate(types):
        # responsive panel chosen from half A only: strongest |pooled signature incl. this type|
        resp = np.argsort(-np.abs(EA.mean(axis=0)))[:TOP_RESPONSIVE]
        out = dict(cell_type=ct)
        for panel, sel in (("all", slice(None)), ("responsive", resp)):
            ea, eb, pa, db_, da = EA[j][sel], EB[j][sel], PA[j][sel], DB[j][sel], DA[j][sel]
            mse_pool = float(np.mean((eb - pa) ** 2))
            mse_ct = float(np.mean((eb - ea) ** 2))
            mse_zero = float(np.mean(eb**2))
            out.update({
                f"{panel}_r_celltype": pearson(ea, eb),
                f"{panel}_r_pooled_to_celltype": pearson(pa, eb),
                f"{panel}_r_dev": pearson(da, db_),
                f"{panel}_rho_dev": spear(da, db_),
                f"{panel}_mse_zero": mse_zero,
                f"{panel}_mse_pooled": mse_pool,
                f"{panel}_mse_celltype": mse_ct,
                f"{panel}_mse_gain_celltype_vs_pooled": 1.0 - mse_ct / mse_pool,
            })
        out["top100_up_overlap_celltype"] = top_overlap(EA[j], EB[j], TOP_N)
        out["top100_up_overlap_pooled"] = top_overlap(PA[j], EB[j], TOP_N)
        out["top100_dev_abs_overlap"] = top_overlap(DA[j], DB[j], TOP_N, absolute=True)
        out["top100_dev_abs_chance"] = TOP_N / G
        rows.append(out)
    return rows


def permute_types(L, rng):
    """Within each donor, shuffle which cell-type slot each LFC vector occupies (destroys type specificity only)."""
    P = L.copy()
    for i in range(L.shape[0]):
        P[i] = L[i][rng.permutation(L.shape[1])]
    return P


def main():
    cache = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "tmp" / "celllab-transcript-transfer")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent / "results")
    out.mkdir(parents=True, exist_ok=True)
    fetch(cache)
    meta, genes, mats = load(cache)
    types, donors, pb, gene_keep, ncell = pseudobulk(meta, genes, mats)
    L = lfc_tensor(types, donors, pb, gene_keep)
    syms = genes.symbol.values[gene_keep]
    nd = len(donors)
    rng = np.random.default_rng(SEED)

    flow = dict(
        source="GEO GSE96583 batch2 (Kang et al. 2018), ctrl GSM2560248 vs IFN-beta GSM2560249",
        sha256=FILES,
        singlets_with_label=int(((meta.multiplets == "singlet") & meta.cell.notna()).sum()),
        donors=[int(d) for d in donors],
        cell_types_kept=types,
        cell_types_dropped=sorted(set(meta.cell.dropna().unique()) - set(types)),
        min_cells_per_donor_type_condition=MIN_CELLS,
        genes_total=int(len(gene_keep)),
        genes_kept=int(gene_keep.sum()),
        min_gene_umis=MIN_GENE_COUNTS,
        seed=SEED,
    )
    cells_tab = ncell.unstack("stim").reset_index()
    cells_tab = cells_tab[cells_tab.cell.isin(types)]
    cells_tab.to_csv(out / "cells_per_donor_type.csv", index=False)

    # 35 balanced donor splits (donor 0 always in A)
    splits = [(A, tuple(i for i in range(nd) if i not in A))
              for A in itertools.combinations(range(nd), nd // 2) if 0 in A]
    rows = []
    for si, (A, B) in enumerate(splits):
        for r in metrics_for_split(L, A, B, types):
            rows.append(dict(split=si, A=",".join(str(donors[i]) for i in A), B=",".join(str(donors[i]) for i in B), kind="observed", **r))
        for pi in range(N_PERM):
            Lp = permute_types(L, rng)
            for r in metrics_for_split(Lp, A, B, types):
                rows.append(dict(split=si, A="", B="", kind="type-permuted", perm=pi, **r))
    sm = pd.DataFrame(rows)
    sm.to_csv(out / "split_metrics.csv", index=False)

    metric_cols = [c for c in sm.columns if c not in ("split", "A", "B", "kind", "perm", "cell_type")]
    # average over splits first (and permutations), then summarise by cell type
    per_ct = sm.groupby(["kind", "cell_type"])[metric_cols].mean()
    q = sm[sm.kind == "observed"].groupby("cell_type")[metric_cols].quantile([0.05, 0.95]).unstack()
    per_ct.to_csv(out / "summary_by_cell_type.csv")
    q.to_csv(out / "observed_split_quantiles_5_95.csv")
    macro = sm.groupby(["kind"])[metric_cols].mean()
    macro.to_csv(out / "summary_macro_over_cell_types.csv")
    # fraction of observed splits where cell-type-specific half-A estimate beats pooled half-A for target half B
    frac = (sm[sm.kind == "observed"].assign(w=lambda d: d["responsive_mse_gain_celltype_vs_pooled"] > 0)
            .groupby("cell_type")["w"].mean())
    frac.rename("frac_splits_celltype_beats_pooled_responsive").to_csv(out / "frac_splits_celltype_beats_pooled.csv")

    # donor-count curve: k donors per estimate, disjoint pairs, random draws
    crow = []
    for k in range(1, nd // 2 + 1):
        pairs = []
        for _ in range(CURVE_PAIRS):
            perm = rng.permutation(nd)
            pairs.append((tuple(perm[:k]), tuple(perm[k:2 * k])))
        for A, B in pairs:
            for r in metrics_for_split(L, A, B, types):
                crow.append(dict(k=k, **r))
    cv = pd.DataFrame(crow)
    keep = ["all_r_celltype", "all_r_dev", "all_rho_dev", "responsive_r_celltype", "responsive_r_dev",
            "responsive_mse_gain_celltype_vs_pooled", "top100_dev_abs_overlap"]
    cv.groupby(["k", "cell_type"])[keep].mean().to_csv(out / "donor_curve.csv")

    # full-8-donor cell-type-specific genes + donor consistency (descriptive; not an independent test)
    E8 = L.mean(axis=0)
    rows = []
    for j, ct in enumerate(types):
        Pm = (E8.sum(axis=0) - E8[j]) / (len(types) - 1)
        D = E8[j] - Pm
        Dd = L[:, j, :] - (L.sum(axis=1) - L[:, j, :]) / (len(types) - 1)  # donor x gene
        for gi in np.argsort(-np.abs(D))[:20]:
            rows.append(dict(cell_type=ct, gene=syms[gi], lfc_celltype=E8[j, gi], lfc_other_types=Pm[gi], deviation=D[gi],
                             donors_same_sign=int((np.sign(Dd[:, gi]) == np.sign(D[gi])).sum()), n_donors=nd))
    pd.DataFrame(rows).to_csv(out / "top_deviation_genes_all_donors.csv", index=False)

    obs = macro.loc["observed"]
    nul = macro.loc["type-permuted"]
    flow["headline_macro_over_cell_types"] = {
        "observed": {k: float(obs[k]) for k in keep if k in obs},
        "type_permuted": {k: float(nul[k]) for k in keep if k in nul},
    }
    flow["n_splits"] = len(splits)
    flow["n_permutations_per_split"] = N_PERM
    (out / "flow.json").write_text(json.dumps(flow, indent=2))
    print(per_ct.loc["observed"][["all_r_celltype", "all_r_dev", "responsive_r_dev", "responsive_mse_gain_celltype_vs_pooled"]].round(3))
    print(json.dumps(flow["headline_macro_over_cell_types"], indent=2))


if __name__ == "__main__":
    main()
