# Paired Wood pseudobulk: edgeR versus limma

## Analysis rules fixed before scoring

This is a post-hoc comparator for the [cytokine atlas benchmark](../cytokine-atlas/manuscript.md), not prospective preregistration. Use raw Wood RNA sums for all retained cells in each of six paired batch B donors (640–645), in each of four lineages (`mono`, `B_n`, `CD4_Tn`, `NK`) and each arm (48 h IL-2 or IL-4 versus Baseline). Use the same donors, lineages, gene symbols, and contrasts as the atlas limma comparison. Each model receives 12 donor × arm pseudobulks per lineage and ligand; no cell is an independent replicate. No source filter, normalization, ranking or mixing weight uses target data.

- **Shared CPM panel:** for each ligand use the atlas limma filter (raw ≥1 CPM in ≥6 of the 48 lineage × donor × arm pseudobulks using full RNA totals). This recovers the existing limma comparison and may retain genes expressed chiefly in one lineage.
- **Shared filterByExpr panel:** as a stricter sensitivity, independently apply default edgeR `filterByExpr` to each lineage using arm as the grouping variable and full RNA library sizes. Use the intersection of the passing genes across all four lineages. Filtering by arm rather than the paired design requires support over a full arm rather than the smallest donor block. This isolates genes with count support in all lineages, not necessarily the best own-type universe.
- **edgeR:** per ligand, lineage and panel, fit a negative-binomial model with `~ donor + arm`, TMM factors estimated from the filtered counts while preserving the original full RNA library sizes, robust quasi-likelihood moderation (`legacy=FALSE`), and the matched `treated − Baseline` test. Rank by `sign(logFC) × sqrt(F)`; genes that are all zero in a particular lineage have no directional evidence (score zero) and do not enter its fit. This is a test-based ranking, not a comparison of calibrated p-values across lineages.
- **limma:** per donor compute treated minus Baseline log2 CPM using the atlas pseudocounts (`count + 0.5`, library size `+ 1`), then fit the atlas intercept-only empirical Bayes model. Compare own-only signed moderated t, its original pre-fit mixing (mean of the three other lineages within donor, then equal own/other blend), and post-fit rank mixing as a like-for-like control.
- **Rank mixing:** in each lineage and for each direction rank the signed statistic (descending for Up, ascending for Down), scale to `1 − (average rank − 1)/(N−1)`, then take the equally weighted mean of the three other lineages. `half` gives equal weight to own rank and that mean. Rank aggregation is post-fit, not a pooled edgeR likelihood or a joint coefficient test. All final cutoff ties are broken by gene symbol, matching the existing continuous-score comparator.
- **Primary targets already in the project:** Parse/Allen independent 24 h cell-type-specific top-500 IL-2/IL-4 lists, and the same archived human microarray contrasts as before (GSE22886, GSE12198, GSE2770). For Parse, summarize directions and lineages equally within ligand. For the array benchmarks, average all contrasts and directions within accession, then average accessions equally. Preserve the archive orientation: `CONTROL_VS_TREATED_DN` indexes treatment-induced genes. No target gene-list membership is required to enter a source ranking.
- **Additional target:** if available, score the independently generated Yuan purified human CD14+ monocyte 24 h IL-4 vs untreated lists against the unchanged Wood IL-4 monocyte rankings. In the target's own ranking universe, take up to 500 genes per direction with the matching sign, breaking ties by symbol. Report separately, not as a replicate of Parse or the archived accession analysis.
- For every method and target use the same source genes within panel and the same budget of exactly 100 per direction; precision is overlap/100. As a reference, report the expected overlap fraction of drawing 100 uniformly from the same source genes (`eligible target hits / eligible genes`). No p-value over tasks: donor sets, source genes and directional responses are shared.

## Results

Mean precision at 100 (%); columns give **own → equally mixed own/other**. The [Parse table](results/parse.csv) and [archive table](results/archive_by_study.csv) also report other-only precision.

| Source filter | External target | edgeR post-fit ranks | limma post-fit ranks | limma pre-fit effects |
|---|---|---:|---:|---:|
| Shared CPM | Parse IL-2 | 43.63 → 41.88 | 22.00 → 26.50 | 22.00 → 22.25 |
| Shared CPM | Parse IL-4 | 59.75 → 40.00 | 38.88 → 27.38 | 38.88 → 33.38 |
| Shared CPM | Three archived accessions | 4.72 → 3.47 | 5.03 → 4.64 | 5.03 → 5.03 |
| Shared CPM | Yuan IL-4 monocytes | 57.00 → 31.50 | 52.00 → 29.50 | 52.00 → 48.50 |
| Shared filterByExpr | Parse IL-2 | 53.00 → 49.38 | 49.88 → 48.25 | 49.88 → 52.25 |
| Shared filterByExpr | Parse IL-4 | 66.38 → 49.88 | 60.88 → 49.25 | 60.88 → 58.50 |
| Shared filterByExpr | Three archived accessions | 5.78 → 3.14 | 5.42 → 3.50 | 5.42 → 4.83 |
| Shared filterByExpr | Yuan IL-4 monocytes | 20.50 → 14.00 | 23.00 → 14.50 | 23.00 → 27.50 |

With the original CPM filter, switching from limma to edgeR raised **own-type** Parse recovery by 21.63 percentage points for IL-2 and 20.88 points for IL-4. The differences shrank to 3.13 and 5.50 points on the stricter shared universe. Giving equal rank weight to the other types lowered edgeR precision on both Parse ligands with either filter, even though the pre-fit limma blend improved IL-2 with both filters. The model contrast changes the count likelihood, normalization, dispersion moderation, and score together; this is not an estimate of the effect of any one component.

The three archived microarray accessions did not show the same absolute gain: own-type edgeR and limma each recovered only about 5% in the [accession-weighted summary](results/archive_macro.csv). For the [new independent Yuan target](../cytokine-new-cohort/protocol.md), CPM-filtered edgeR recovered 65 induced and 49 repressed genes with the monocyte-only ranking, versus 38 and 25 with the rank blend. The much smaller common-expression panel retained only 69 induced and 50 repressed Yuan target genes (out of 500 each), versus 449 and 432 in the CPM panel. Its lower absolute precision should not be attributed to the fit alone. The strict intersection retained 4,115 IL-2 and 4,163 IL-4 genes, versus 19,589 and 19,864 for shared CPM.

## Limits

This compares one four-lineage Wood source cohort and two ligands, not a universal ranking rule. Wood used 48 h stimulation in mixed PBMCs; Parse measured 24 h PBMCs, Yuan used 24 h purified monocytes after M-CSF conditioning, and archived arrays varied in duration, activation and coverage. The archived lists were previously scored in the project and exact symbol matching can miss platform-specific genes. Yuan 24 h has three replicate pairs and is one held-out target, not a large validation panel. Ranked list membership is not biological ground truth; absent genes are not labeled biological negatives. Unlike limma's pre-fit averaging, the edgeR rank blend has no donor-level joint model or calibrated pooled test. In the CPM panels, edgeR returned 46 near-zero negative numerical F values (minimum −2.17 × 10⁻⁷); these were rounded to zero before taking the square root. The code stops for values below −10⁻⁵.

## Reproduction

Run from this directory with Python 3.13.12, NumPy 2.4.6, pandas 3.0.5, SciPy 1.18.0, R 4.5.2, Bioconductor 3.22 `edgeR` 4.8.2 and `limma` 3.66.0, CRAN `locfit` 1.5-9.12 and `statmod` 1.5.2. If these are not installed in the active R library, install the named packages with `BiocManager::install(c("edgeR", "limma", "locfit", "statmod"), version = "3.22")` or use the pinned R 4.5 package archives. For the original Wood extraction, also install SeuratObject 5.4.0 and Matrix 1.7-4.

```sh
WOOD="$HOME/tmp/celllab-cytokine-single"
REF="$HOME/tmp/celllab-transcript-transfer"
# Set R_LIBS_USER if using a private R package library.
# On a fresh cache, fetch/verify Wood and create the log-CPM cross-check tensor:
python3 ../cytokine-single/run.py "$WOOD" ../cytokine-single/results
# Fetch/verify the original Allen and MSigDB release files:
python3 ../cytokine-atlas/human_targets.py "$REF" ../cytokine-atlas/results
# Regenerate the raw RNA sparse depth inputs (only if absent):
Rscript ../cytokine-atlas/depth_extract.R "$WOOD/seurat_v5_object.rds" "$WOOD"
# The optional Yuan target used in the reported results:
YUAN="$HOME/tmp/celllab-cytokine-new-cohort"
python3 ../cytokine-new-cohort/run.py "$YUAN"
python3 run.py "$WOOD" "$REF" results --new-target "$YUAN/targets.npz"
```

The [source manifest](../cytokine-single/sources.json) identifies the Wood release and Allen lists; the archive is [MSigDB ImmuneSigDB v2025.1.Hs](https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2025.1.Hs/c7.immunesigdb.v2025.1.Hs.symbols.gmt). `run.py` checks all depth export and primary target SHA-256 hashes, verifies library assembly against the independently produced atlas tensor (every donor-level log-CPM delta and cell count), and checks both matched-CPM limma summaries against the previously reported results. [Input hashes](results/inputs.csv), [aggregated cell coverage](results/source_sizes.csv), and [task-level metrics](results/tasks.csv) are included, not raw cell data, fitted signatures, or gene lists.

For Yuan, place [GSE252736_raw_counts.txt.gz](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE252736) in `$YUAN` before running its extraction; the sibling code validates the release checksum. The `targets.npz` hash records the exact derived target scores used here. Omit `--new-target` (using a fresh output directory) to run only Parse and archived-list evaluations.
