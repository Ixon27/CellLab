# Do cell-type-specific interferon responses replicate across donors, or is a pooled signature enough?

Public-only reanalysis of real single-cell perturbation data. Question: when PBMCs from some donors are exposed to IFN-β, how well does a cell-type-specific response estimated in one set of donors predict the response of the same cell type in *other* donors, compared with a pooled signature taken from the other cell types? No CellLab records, no pathogens, no genetic engineering; this is a descriptive biological-replication check on an old, well-studied dataset, not a new discovery claim.

**Update: an external study is now included.** The donor-split experiment below is within Kang. The separate [cross-study test and fixed-cell-budget control](external-results.md) use the Parse/Allen IFN-β signatures; their endpoint and limitations differ.

## Data (primary sources)

- Kang et al., *Multiplexed droplet single-cell RNA-sequencing using natural genetic variation*, Nat Biotechnol 2018, [doi:10.1038/nbt.4042](https://doi.org/10.1038/nbt.4042).
- GEO [GSE96583](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE96583), batch 2: control [GSM2560248](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSM2560248) and IFN-β 6 h [GSM2560249](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSM2560249) PBMC libraries from 8 pooled donors (SLE patients, demultiplexed by genotype), plus the authors' donor/cell-type/singlet labels (`GSE96583_batch2.total.tsne.df.tsv.gz`). Downloaded from the [GEO FTP](https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96583/suppl/) (~77 MB) into `~/tmp/celllab-transcript-transfer` (outside git); SHA-256 checksums are pinned in `run.py`. Bioconductor muscData and SeuratData ship the same experiment but were not needed.

## Protocol (fixed before looking at the split results)

1. Keep authors' singlets with a cell-type label. Keep a cell type only if **every** donor has ≥10 cells in both conditions → B, CD14⁺ monocytes, CD4 T, CD8 T, FCGR3A⁺ monocytes, NK (dendritic cells and megakaryocytes dropped: minimum 8 and 4 cells per cell). Gene universe: ≥200 UMIs over retained cells (7,449 genes), chosen independent of any split.
2. Pseudobulk per donor × cell type × condition; log2 CPM with prior 0.5 count; per-donor response = stim − ctrl (log2 fold change). Donors are the replicate unit, not cells.
3. All 35 balanced 4 vs 4 donor splits (A, B). Per half, response of cell type *c* = mean over donors; the **pooled signature** for *c* is the equal-weight mean of the *other* five cell types in the same half (leave-one-type-out, so the target type never informs its own pooled predictor); the **cell-type-specific deviation** is `E_c − pooled_{−c}`.
4. Metrics, half A estimate against half B estimate of the same cell type (B is never used to choose anything): Pearson r of responses; Pearson/Spearman r of deviations (the reproducible *cell-type-specific* part); relative MSE gain of predicting B from A's cell-type estimate vs from A's pooled signature, `1 − MSE_celltype/MSE_pooled`; overlap of top-100 genes by |deviation| (chance ≈ 1.3%). Each on all 7,449 genes and on a "responsive panel" of the 500 genes with the largest |mean response| **chosen from half A only**.
5. Null: within each donor, shuffle which cell-type slot each response vector occupies (20 shuffles per split). This keeps each donor's overall IFN response and noise level but removes cell-type specificity, so deviation reproducibility should be ≈0.
6. Donor-count curve: k = 1..4 donors per side, 200 random disjoint donor sets per k.
7. Seed 2026. Splits share donors, so intervals/quantiles below are descriptive spread over splits, not confidence intervals.

## Headline results (macro-average over 6 cell types, mean over 35 splits)

| metric | observed | type-shuffled null |
|---|---|---|
| r of response A vs B, responsive panel | 0.92 | 0.89 |
| r of cell-type deviation A vs B, responsive panel | **0.70** | 0.00 |
| r of cell-type deviation A vs B, all genes | 0.35 | 0.00 |
| Spearman of deviation, all genes | 0.30 | 0.00 |
| MSE gain, cell-type-specific vs pooled predictor, responsive panel | **+49%** | −80% |
| top-100 |deviation| gene overlap (chance 1.3%) | 27.5% | 4.9% |

Per cell type (responsive panel, deviation r): CD14⁺ mono 0.91, FCGR3A⁺ mono 0.71, CD8 T 0.70, NK 0.66, CD4 T 0.62, B 0.62. The cell-type-specific estimator beat the pooled signature on the responsive panel in 35/35 splits for every cell type (all-gene r of deviation 0.26–0.68). Donor-count curve (macro mean): responsive deviation r = 0.33 / 0.52 / 0.64 / 0.70 for 1 / 2 / 3 / 4 donors per side, and the MSE gain is **−7%** at k=1 (one donor's cell-type estimate is *worse* than the pooled signature), +22% at k=2, +40% at k=3, +50% at k=4. Files: `results/summary_by_cell_type.csv`, `donor_curve.csv`, `split_metrics.csv`, `observed_split_quantiles_5_95.csv`, `flow.json`.

Reading: the shared IFN-β program is highly reproducible between donors, and cell-type-specific departures from it replicate clearly above the null, strongest in CD14⁺ monocytes, but only when several donors are averaged and mostly for strongly responsive genes. The reproducible-specific signal over all expressed genes is modest (r≈0.35).

## Limits (read before citing anything)

- One experiment, one lab, one 10x batch, 8 SLE patients stimulated *in vitro* for 6 h; replication here is between donors inside the same run, not between independent studies, batches or healthy donors. Donor effects shared by the whole pooled library (processing, ambient RNA) cannot be separated from biology.
- Cell-type labels are the authors' joint clusters over control and stimulated cells; mislabelled or state-shifted cells can inflate or deflate specificity. Fold changes of lowly expressed genes are inflated by the 0.5 prior; library-size normalization is affected by the strong ISG shift (composition effect), which can create apparent type-specific shifts on non-ISG genes.
- The responsive panel depends on a half-A selection step and has a much higher r than all genes; both are reported, neither is a general claim. The null is one specific permutation (shuffling type labels within donor) and not a full model of donor noise.
- `results/top_deviation_genes_all_donors.csv` ranks genes using all 8 donors and then counts donors with the same sign; it is selected, descriptive, and dominated by genes near the detection limit, so it is **not** evidence about individual genes (no gene-level claims or FDR here).
- Pseudobulk LFC is not a differential-expression test; no test statistics or p-values are made. Not a clinical or drug-response claim, and no mechanism is established.
- Known in the field: IFN-β responses are strongly shared across cell types with cell-type-specific modulation (Kang et al. 2018), and pseudobulk-with-donor-as-replicate is the established practice ([Crowell et al. 2020](https://doi.org/10.1038/s41467-020-19894-4), [Squair et al. 2021](https://doi.org/10.1038/s41467-021-25960-2)). Novelty here is only the small split-donor predictive framing versus a pooled signature.
- One data quirk handled in code: 313 stimulated-library cells have barcodes written with suffix `-11` in the authors' metadata (to disambiguate collisions with control barcodes) and `-1` in the matrix barcodes file; they are mapped back explicitly.

## Prerequisites and reproduce

Python 3.13, NumPy, pandas, SciPy (`requirements.txt`); ~80 MB download, ~40 s runtime (observed on one Apple-silicon laptop; memory not measured). No R, GPU or credentials.

```sh
cd research/transcript-transfer && python run.py "$HOME/tmp/celllab-transcript-transfer" results
```

Outputs are deterministic given the pinned data and seed; `results/flow.json` contains counts, hashes and headline numbers.
