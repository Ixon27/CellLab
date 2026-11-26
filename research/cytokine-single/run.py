#!/usr/bin/env python3
"""Exploratory external transfer: Wood 48 h IL-2/IL-4 vs Parse/Allen 24 h.

Before scoring: use every subset of 1–6 matched Wood donors, type-matched
signed precision@100 against the published direction-specific 500-gene lists,
and compare own type, leave-type-out equal mean, and their fixed 1:1 blend.
Average equally across types and donor subsets, separately by cytokine/direction.
This all-cell donor-count curve also changes cell count; it is not a fixed-depth
or donor-count causal effect. Donor subsets overlap; they are not replications.
"""

import argparse
from itertools import combinations
from pathlib import Path
import hashlib
import subprocess
import tempfile
from urllib.request import urlretrieve

import numpy as np
import pandas as pd

ZENODO = "https://zenodo.org/records/15744698/files/seurat_v5_object.rds?download=1"
PARSE = (
    "https://allenimmunology.org/public/publication/download/"
    "fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/"
    "e7992b0c-e248-4f57-b16f-62784c48f15d/parse_cytokine_gsea_gene_sets.csv"
)
PARSE_SHA256 = "4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd"
WOOD_MD5 = "100e6686ff4003b19d9807d2d582c169"  # Zenodo v1 published checksum
DONORS = tuple(range(640, 646))  # GSE327907 batch B, all paired with both stimuli
CYTOKINES = {"IL2": "IL-2", "IL4": "IL-4"}
# Wood's broad mono cluster is approximated by the Parse CD14 subset. All other
# matches are subtype to subtype. One representative per lineage avoids pooling
# extra subtypes of the held-out lineage into the leave-type-out baseline.
TYPES = {
    "mono": "CD14 monocyte",
    "B_n": "Naive B cell",
    "CD4_Tn": "Naive CD4 T cell",
    "CD8_Tn": "Naive CD8 T cell",
    "NK": "CD56dim NK cell",
}
MIN_CELLS = 10  # applied jointly across both cytokines and baseline, before scoring
TOP = 100


def check(path, algorithm, expected):
    with path.open("rb") as f:
        digest = hashlib.file_digest(f, algorithm).hexdigest()
    if digest != expected:
        raise ValueError(f"Unexpected {algorithm} for {path}: {digest}")


def fetch(cache, name, url, algorithm, expected):
    path = cache / name
    if not path.exists():
        partial = path.with_suffix(path.suffix + ".partial")
        urlretrieve(url, partial)
        check(partial, algorithm, expected)
        partial.rename(path)
    else:
        check(path, algorithm, expected)
    return path


def responses(count_path, group_path, cache):
    groups = pd.read_csv(group_path, sep="\t").set_index("key")
    cols = [f"{donor}:{stim}:{ct}" for donor in DONORS
            for stim in ("Baseline", *CYTOKINES) for ct in TYPES]
    groups = groups.reindex(cols)
    eligible = (groups.cells.fillna(0).to_numpy() >= MIN_CELLS).reshape(-1, len(TYPES)).all(axis=0)
    types = [ct for ct, keep in zip(TYPES, eligible, strict=True) if keep]
    if len(types) < 2:
        raise ValueError("Fewer than two types meet the paired-cell threshold")

    # Keep all unique source feature names, independent of any Parse gene list.
    genes = pd.read_csv(count_path, sep="\t", index_col=0, keep_default_na=False)
    symbols = genes.index.to_numpy(dtype=str)
    unique = (symbols != "") & ~genes.index.duplicated(keep=False)
    symbols = symbols[unique]
    tensors = []
    cells = []
    for stim in CYTOKINES:
        paired_cols = [f"{donor}:{condition}:{ct}" for donor in DONORS
                       for ct in types for condition in ("Baseline", stim)]
        counts = genes[paired_cols].to_numpy().T
        lib = counts.sum(axis=1, keepdims=True)
        if (lib <= 0).any():
            raise ValueError("Empty library in eligible pseudobulk")
        log_cpm = np.log2((counts[:, unique] + 0.5) / (lib + 1) * 1e6)
        log_cpm = log_cpm.reshape(len(DONORS), len(types), 2, len(symbols))
        tensors.append(log_cpm[:, :, 1] - log_cpm[:, :, 0])
        cells.append(groups.loc[paired_cols, "cells"].to_numpy(dtype=int).reshape(len(DONORS), len(types), 2))

    lfc = np.stack(tensors)
    # Axes: cytokine × donor × source type × gene; cells replaces gene by baseline/stim.
    np.savez_compressed(cache / "wood_donor_lfc.npz", lfc=lfc, cells=np.stack(cells),
                        cytokines=list(CYTOKINES.values()), donors=DONORS,
                        source_types=types, target_types=[TYPES[ct] for ct in types], symbols=symbols)
    groups["eligible"] = [col.rsplit(":", 1)[1] in types for col in cols]
    return lfc, groups, types, symbols


def score(lfc, groups, types, symbols, parse_path, out):
    ref = pd.read_csv(parse_path).set_index(["fg", "cell_type", "direction"])
    rows = []
    coverage = []
    for cytokine, donor_lfc in zip(CYTOKINES.values(), lfc, strict=True):

        for direction, sign in (("Up", 1), ("Down", -1)):
            targets = []
            for ct in types:
                target = ref.loc[(cytokine, TYPES[ct], direction), "pathway_genes"].split(";")
                if len(set(target)) != 500:
                    raise ValueError(f"Non-500-gene target for {cytokine}, {ct}, {direction}")
                mask = np.isin(symbols, target)
                targets.append(mask)
                coverage.append((cytokine, ct, TYPES[ct], direction, len(symbols), mask.sum()))
            for k in range(1, len(DONORS) + 1):
                for subset in combinations(range(len(DONORS)), k):
                    own = donor_lfc[list(subset)].mean(axis=0)
                    pooled = (own.sum(axis=0) - own) / (len(types) - 1)
                    blend = (own + pooled) / 2
                    for i, ct in enumerate(types):
                        precision = []
                        for estimator in (own, pooled, blend):
                            ranks = np.lexsort((symbols, -sign * estimator[i]))[:TOP]
                            precision.append(targets[i][ranks].sum() / TOP)
                        rows.append((cytokine, k, ct, direction, *precision))

    out.mkdir(parents=True, exist_ok=True)
    groups.to_csv(out / "cells.csv")
    pd.DataFrame(coverage, columns=["cytokine", "source_type", "target_type", "direction",
                                   "source_genes", "target_genes_in_source"]).to_csv(out / "coverage.csv", index=False)
    frame = pd.DataFrame(rows, columns=["cytokine", "donors", "source_type", "direction", "type", "pooled", "half_pool"])
    detail = frame.groupby(["cytokine", "donors", "source_type", "direction"]).mean()
    macro = detail.groupby(["cytokine", "donors", "direction"]).mean()
    macro["type_minus_pooled"] = macro.type - macro.pooled
    macro["half_pool_minus_pooled"] = macro.half_pool - macro.pooled
    detail.to_csv(out / "by_type.csv", float_format="%.8f")
    macro.to_csv(out / "macro.csv", float_format="%.8f")
    print(macro.to_string(float_format=lambda n: f"{n:.4f}"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path, help="directory for downloaded raw inputs outside the repository")
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    wood = fetch(args.cache, "seurat_v5_object.rds", ZENODO, "md5", WOOD_MD5)
    parse = fetch(args.cache, "parse_sets.csv", PARSE, "sha256", PARSE_SHA256)
    with tempfile.TemporaryDirectory(dir=args.cache) as tmp:
        subprocess.run(["Rscript", str(Path(__file__).with_name("extract.R")), str(wood), tmp], check=True)
        source = responses(Path(tmp) / "counts.tsv", Path(tmp) / "groups.tsv", args.cache)
        score(*source, parse, args.out)


if __name__ == "__main__":
    main()
