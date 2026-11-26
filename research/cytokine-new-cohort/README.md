# Independent human IL-4 monocyte holdout

**Result.** For a new donor-resolved CD14+ monocyte study, fixed half-borrowing did not improve primary signed top-100 recovery from either Wood or Parse/Allen. The loss was modest and driven by the induced list; the repressed list tied at 24 h for both sources. This is evidence for one lineage and ligand, not a general rule against borrowing.

## Held-out cohort

[Yuan et al., *Nature Communications* 17:11556 (2026)](https://doi.org/10.1038/s41467-026-78528-3), [GSE252736](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE252736), measured RNA-seq after adding IL-4 to purified human CD14+ monocytes from healthy New York Blood Center donors. This separately collected study is not a release or reanalysis of prior manuscript datasets. We used the deposited gene-count matrix, not the authors' selected gene clusters or ImmuneSigDB. Figure 1 documents the IL-4-only arm and the time-matched controls. Both arms were conditioned with M-CSF; the contrast isolates IL-4 addition in that context, not IL-4 stimulation of fresh PBMCs. We left out TNF, co-stimulation, chromatin assays and the mouse data.

| Time | Biological pairs | Untreated GEO samples (replicate order) | IL-4 GEO samples (replicate order) | Detectable unique target symbols |
|---|---:|---|---|---:|
| 24 h (primary) | 3 | GSM8006017, GSM8006018, GSM8006004 | GSM8006005, GSM8006006, GSM8006001 | 12,069 |
| 6 h | 2 | GSM8006019, GSM8006020 | GSM8006007, GSM8006008 | 12,058 |

Replicate suffixes, treatment, time and sample descriptions in GEO identified the pairs. Donor identifiers beyond replicate labels were not disclosed; we do not assume distinct donors across times. All comparisons follow the [design written before scoring](protocol.md). Wood uses six paired PBMC donors at 48 h; Parse/Allen uses published continuous pseudobulk DESeq2 effects from its 24 h, 12-donor PBMC experiment. In both cases, own is the closest monocyte match, other averages the three nonmonocyte lineages, and half blends the two equally. Neither the blend nor the source ranks were fitted to Yuan expression.

## Results

Primary P@100 = fraction of the 100 source recommendations in the matching directional target top 500, on the method-common gene universe. Values below are percentages (e.g. 86% = 86 of 100). The random shortlist expectation is 4.50% for Wood (11,108 genes) and 15.45% for Parse/Allen (3,236 genes). The source-specific universes differ, so absolute recovery is not a head-to-head comparison of the platforms.

| Source → Yuan 24 h | Direction | Own P@100 | Other P@100 | Half P@100 | Half − own |
|---|---|---:|---:|---:|---:|
| Wood | Induced | 86% | 33% | 83% | −3 pp |
| Wood | Repressed | 79% | 28% | 79% | 0 pp |
| Wood | Direction mean | **82.5%** | 30.5% | 81.0% | **−1.5 pp** |
| Parse/Allen | Induced | 74% | 39% | 70% | −4 pp |
| Parse/Allen | Repressed | 78% | 68% | 78% | 0 pp |
| Parse/Allen | Direction mean | **76.0%** | 53.5% | 74.0% | **−2.0 pp** |

- **Other ranking endpoints:** Direction-mean average precision for own vs half was 0.504 vs 0.481 (Wood) and 0.500 vs 0.479 (Parse/Allen). Spearman rank correlation was 0.519 vs 0.471 and 0.535 vs 0.521, respectively. Overall direction agreement among the shortlists was 95.5% vs 96.5% (Wood) and 92.0% vs 91.0% (Parse/Allen); the blend can improve sign agreement without retrieving more of the strongest effects. Direction-adjusted mean target log2 fold changes at 100 were 3.15 vs 3.01 and 0.88 vs 0.84, respectively.
- **Effect of assay coverage:** Ranking source and target in their respective universes instead of taking the intersection gave direction-mean P@100 of 58.0% vs 54.0% (Wood) and 24.5% vs 23.5% (Parse/Allen). Only 48 of the original 500 induced and 39 of the original 500 repressed target genes were in the four-lineage Parse/Allen source universe, versus 449 and 432 in Wood. The high shared-universe precision does not imply broad recovery of the original target lists.
- **Omitting one Yuan replicate pair at 24 h:** Half minus own direction-mean P@100 remained negative in every omission: −2.5 to −1.0 pp for Wood and −3.0 to −2.5 pp for Parse/Allen. These are three overlapping two-pair subsets, not confidence intervals or additional cohorts.
- **Timing and ligand checks:** At 6 h, direction-mean shared P@100 was 73.5% own vs 73.0% half (Wood) and 60.5% vs 57.5% (Parse/Allen); small differences can reverse by direction or universe (e.g. whole-assay Parse/Allen mean 15.5% vs 17.0%). For the 24 h target, mismatched IL-2 rankings achieved only 44.5% own and 38.0% half (Wood) and 37.0% and 33.5% (Parse/Allen), showing that matching the ligand matters even though some response transfers across these stimuli.

See [all directional metrics, coverage and leave-one-out rows](results/directional.csv) and [all Spearman results](results/correlation.csv). The target list threshold ranks relative expression changes; it is not a differential-expression significance cutoff, and target genes outside it are not biological negatives. Count normalization, exact symbol matching across annotation vintages, bulk purified cells versus PBMC subtypes, conditioning and time jointly affect transfer. Three donor pairs at the primary time, one lineage, one target study and one ligand cannot establish population-level superiority. The two prediction sources share the same target; they are not two new replications.

## Reproduce

Run from `research/cytokine-new-cohort`. Python 3.13.12 with NumPy 2.4.6, pandas 3.0.5 and SciPy 1.18.0. Regenerating Wood uses [its public release](../cytokine-single/sources.json), R 4.5.2, SeuratObject 5.4.0 and Matrix 1.7-4. The scorer checks that contrasts reconstructed from the `depth_` sparse count files agree with `wood_donor_lfc.npz` before applying the detection filter. Skip the downloads and cache-generation steps if the inputs already exist.

```sh
NEW="$HOME/tmp/celllab-cytokine-new-cohort"
WOOD="$HOME/tmp/celllab-cytokine-single"
ALLEN="$HOME/tmp/celllab-transcript-transfer/parse-effects.csv"
mkdir -p "$NEW" "$(dirname "$ALLEN")"
curl -fL 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252736/suppl/GSE252736_raw_counts.txt.gz' \
  -o "$NEW/GSE252736_raw_counts.txt.gz"
# Uncensored differential effects, not the Allen GSEA list download:
curl -fL 'https://allenimmunology.org/public/publication/download/fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/87ce4a04-98f1-43b3-aea3-1fdc95272fea/parse_cytokine_deg_uncensored.csv' \
  -o "$ALLEN"
# If the Wood caches do not already exist:
python ../cytokine-single/run.py "$WOOD" "$WOOD/benchmark-results"
Rscript ../cytokine-atlas/depth_extract.R "$WOOD/seurat_v5_object.rds" "$WOOD"
python run.py "$NEW" --wood-cache "$WOOD" --allen "$ALLEN" --out results
```

Running `python run.py "$NEW"` alone derives the local-only `targets.npz` consumed by the separate Wood count-model benchmark (`symbols` and `yuan24`). The [Allen download page](https://apps.allenimmunology.org/aifi/resources/parse-10m-cytokines/downloads/) states CC BY-NC 4.0 for its derived data. The repository includes only aggregate benchmark results, not downloaded counts, gene lists or individual-level data.

| File | SHA-256 |
|---|---|
| GSE252736_raw_counts.txt.gz | `def7f70bf982a6920bf23236a21963a59e00791503f02e10680cbbee3de0d4b7` |
| [GSE252736_family.soft.gz](https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252736/soft/GSE252736_family.soft.gz) (metadata for mapping) | `677f3a1e93f33a880bd5dd9b02f1ceda71991880af7a9ceab0d404448de65dd1` |
| Allen uncensored effect release (`parse-effects.csv`, 2,809,203,656 bytes) | `551647522083735def165aadde5911296243a689e1feacc32a670a84d43dd832` |
| Wood derived tensor (`wood_donor_lfc.npz`) | `595f7ced0fdfdaf40b55f9b3fd517e575672895b32a20ab4f2541b8275178d01` |
| Local `targets.npz` | `25f2fadf84f138839dabe492692fee464fc0872555dc2a7c103ec9c133340535` |
| `results/directional.csv` | `b3873ea7c7397fc3b0ed58c6a0ca727d91cdb22a8282252614d3d4295192f7c3` |
| `results/correlation.csv` | `63fc391cfde114bb65905592d9e535c149cb39fd7d57098d33e11e0dd40c5155` |
