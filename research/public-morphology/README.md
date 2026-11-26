# How much of public BBBC021 mechanism-of-action retrieval survives a stricter batch exclusion?

CellLab research pilot, independent of the desktop application, of private culture records and of any wet-lab work. It uses **only public data**: the Broad BBBC021 MCF-7 compound-profiling set (official metadata and MoA labels) and the public per-well CellProfiler profiles of its labelled treatments. No images are processed. No pathogens, no new experiments.

This is a second, separate study. It does **not** test, validate or calibrate the unstained phase-contrast nuclear-count work in [`../nuclear-count`](../nuclear-count/README.md): here nuclei are fluorescently stained and the profiles come from a different segmentation pipeline, cell line and laboratory. It says nothing about treatment causality, viability, or about any CellLab culture.

## Prior work: this is a re-audit, not a new method

BBBC021 mechanism-of-action (MoA) classification with leave-one-compound-out ("not same compound", NSC) and "not same compound or batch" (NSCB) scoring is established. The BBBC021 page lists per-treatment results of 94% NSC / 77% NSCB (Ljosa et al., J Biomol Screen 2013), 96% / 95% (Ando et al., bioRxiv 2017), 90% / 85% (Singh et al., J Microsc 2014) and 91% NSC (Pawlowski et al., bioRxiv 2016); the images are from Caie et al., Mol Cancer Ther 2010. A plain 1-NN on public classical features reaching the high 80s is therefore the **expected** result, not a finding, and the numbers here are not state-of-the-art. My batch definitions (below) are my own and were not matched to the published NSCB, so the published NSCB figures are not directly comparable.

What this pilot adds is narrow and bookkeeping-style: the same score, recomputed on a fixed, pre-specified design, with explicit nuisance baselines, compound-level (not well-level) uncertainty, the exact eligibility of each stricter protocol, and a **matched-query** comparison that scores the plain NSC rule on exactly the queries the stricter rule keeps.

## Question and design (fixed before the first fit)

Does a compound-disjoint nearest-neighbour MoA call from public morphology profiles beat nuisance baselines that know only plate/week metadata or the plate's own DMSO state, and how much of the score is lost when same-week (or same-plate-group) candidates are removed?

- **Data** (cached outside the repo in `~/tmp/celllab-public-morphology/raw`, every file pinned by SHA256 in `run.py`, no data redistributed here):
  - `BBBC021_v1_image.csv`, `BBBC021_v1_moa.csv` from <https://bbbc.broadinstitute.org/BBBC021> (images and ground truth copyright AstraZeneca Pharmaceuticals; see the BBBC page for terms).
  - `ljosa_2013.csv` from the Broad Cell Painting Gallery, `cpg0010-caie-drugresponse/broad-az/workspace/backend/ljosa_2013/analysis_batch_stable/`. 632 wells x 516 CellProfiler columns (Cells/Cytoplasm/Nuclei). Verified here: its (plate, well) set joins 1:1 to the official metadata; it contains **all 330 DMSO wells and 302 treated wells = exactly the 103 MoA-labelled compound-concentrations of 38 compounds in 12 classes, 2-3 wells each**, over 55 plates and 10 weeks. I could not find documentation of how wells were aggregated or normalised (values are raw-scale), nor prove it is bit-identical to the 2013 paper's supplementary profiles; treat it as "public CellProfiler per-well profiles".
  - The profile file holds only 3 of the 333 `taxol 0.3` wells in the metadata (taxol 0.3 appears on essentially every plate, so I infer it served as a positive control), so taxol enters as one ordinary 3-well treatment. The other compounds and concentrations of the 113-compound screen (unlabelled or inactive) are absent: this is the curated active subset and says nothing about inactive treatments.
- **Features:** 459 of the 516 columns after dropping image-position/object-index columns (`_Location_`, `_Center_X/Y`, `ObjectNumber`, `_Number_`, `_Parent_`, `_Children_`) and zero-variance columns; decided from names only. Subsets for ablation: `dna_only` (99: Nuclei features from the DAPI channel plus nuclear shape/neighbours), `no_dna` (360), `density_proxy` (10 nuclear neighbour-distance/neighbour-count columns). The file has no per-image cell count.
- **Transforms:** `plate_dmso` (primary): subtract each plate's DMSO-well median, divide by the pooled DMSO MAD. Sensitivities: `raw_z` (global z-score) and `plate_dmso_whiten` (plus shrunken-covariance whitening on DMSO residuals, shrinkage 0.5). No label is used in any transform.
- **Unit and rule:** primary unit = treatment (compound x concentration; replicate wells averaged after transform); queries = all 103 treatments; 1-NN by cosine similarity among allowed candidates, predicted class = neighbour's MoA. Well level (302 wells) is secondary.
- **Protocols (candidate exclusions):** `NSC` = other compounds only (the standard leave-one-compound-out). `NSCB_plate_group` = also exclude candidates on the same plate group (plates linked by sharing a treatment: the replicate plates of one plate map; 23 groups). `NSCB_week` = also exclude the same week (10 weeks; every compound is run entirely within a single week in this file). A query is **eligible** only if a same-MoA candidate survives; ineligible queries are dropped and reported, not scored as errors.
- **Nuisance baselines:** `majority` (most common class among allowed candidates), `week_prior` (same, restricted to same-week candidates), `position_prior` (well level only, same plate coordinate), `dmso_plate` (1-NN on the plate's own DMSO-median profile; contains no treatment information). Note these leave-compound-out priors are not at chance by construction: removing the query's compound depletes its own class, so they can fall below the class-frequency chance level (sum p^2 = 0.092 for these 103 treatments, computed from the class sizes).
- **Uncertainty:** the independent unit is the compound (38), not the treatment or well. 95% intervals are percentile intervals over 10,000 compound-cluster bootstrap draws (seed 2026), paired across methods. Permutation p-values shuffle MoA labels across compounds (2,000 draws; the floor is 1/2001 = 0.0005) and test only "any compound-level association", not confounding.
- **Pre-specified rule:** a profile advantage is *supported* in a protocol only if the lower bound of the paired accuracy difference is above 0 against **each** of `majority`, `week_prior` and `dmso_plate` at treatment level. No tuning on labels; sensitivities are reported, not selected.

## Results

Run output: [`results/report.md`](results/report.md) (all tables, generated), [`summary.csv`](results/summary.csv), [`contrasts.csv`](results/contrasts.csv) (paired and matched-query differences), [`per_moa.csv`](results/per_moa.csv), [`compound_scores.csv`](results/compound_scores.csv), [`confusion.csv`](results/confusion.csv), [`predictions.csv`](results/predictions.csv), [`provenance.json`](results/provenance.json), [`primary.png`](results/primary.png).

Treatment-level 1-NN accuracy, `plate_dmso`, all features (95% compound-bootstrap CI):

| protocol | eligible / 103 | profile | plate DMSO profile | same-week prior | majority |
|---|---:|---|---|---|---|
| NSC | 103 | 0.883 [0.806, 0.943] | 0.136 | 0.087 | 0.010 |
| NSCB_plate_group | 98 | 0.878 [0.796, 0.940] | 0.163 | 0.204 | 0.041 |
| NSCB_week | 92 | 0.739 [0.598, 0.864] | 0.087 | 0.033 | 0.033 |

Each protocol's profile advantage over the three nuisance baselines has a lower bound above 0 (smallest: +0.468 against the DMSO baseline at NSCB_week), so the pre-specified rule is met in all three. **Read this narrowly:** the nuisance baselines are weak floors (they use only metadata or the plate's DMSO state), so beating them shows the profiles carry compound-level MoA information beyond those particular shortcuts; it does not show batch-free signal.

**Matched queries (the comparison that matters for the batch question).** The NSCB_week row above is scored on 92 treatments, not 103, so 0.883 vs 0.739 is **not** a like-for-like drop. On exactly the 92 queries kept by the week exclusion, the plain NSC rule scores 0.880 versus 0.739 under the week exclusion: a paired difference of **+0.141 [+0.024, +0.279]**. The same matched contrast at well level (274 queries) is +0.124 [+0.023, +0.240]. For `plate_group` the matched difference is 0.000 [0.000, 0.000] at treatment level (98 queries; well level -0.010 [-0.025, 0.000]): removing other compounds on the same plate-map plates changed nothing here. So part of the plain compound-disjoint score depends on same-week neighbours, but the 92-query week-disjoint score remains well above every nuisance floor. The loss is concentrated: with eligibility unchanged, actin disruptors fall from 0.80 to 0.00 recall (5 treatments) and microtubule destabilizers from 0.93 to 0.36 (14 treatments); most other classes are unchanged (per-class table in `report.md`, `per_moa.csv`). The week-disjoint score also covers fewer classes: **cholesterol-lowering (6) and kinase-inhibitor (5) treatments cannot be tested at all** under NSCB_week because all their compounds sit in one week, and kinase inhibitors are also untestable under plate_group.

Secondary (treatment level): the DNA-channel nuclear subset alone gets 0.796 [0.700, 0.883] NSC and 0.685 under NSCB_week, versus all features 0.883 and 0.739; paired differences NSC +0.087 [+0.009, +0.169], NSCB_week +0.054 [-0.033, +0.151]. Ten nuclear neighbour-density columns alone give 0.447 NSC (0.391 NSCB_week; chance about 0.09), i.e. density-like features are strongly treatment-dependent, so they are a response, not a nuisance, and a density/count proxy would not be a batch-neutral anchor. The transform choice (raw z, plate-DMSO, whitened) moves accuracy by at most a few points with intervals that overlap everywhere (`contrasts.csv`); the whitened variant is nominally highest at NSC (0.913) and was not selected.

## What this does and does not support

- Supports: on this public set, a 1-NN on classical profiles identifies the MoA of held-out compounds well above plate/week/DMSO shortcuts, and a stricter same-week exclusion lowers the score on identical queries by roughly 0.12-0.14 (wide intervals).
- Does **not** support: independent replication. Everything is within BBBC021 (one cell line, one laboratory, one acquisition programme, 38 compounds); the week and plate-group exclusions do not remove shared reagents, stain lots, operators, plate layouts or protocol, and a compound-disjoint split is not chemotype-disjoint: analogues and same-series compounds remain across the split (I did not examine SMILES). It also does not support MoA discrimination in unlabelled or inactive compounds, other cell lines, doses outside the curated ones, unstained images, nuclear-count accuracy, treatment effects or causality.
- Class sizes are small (2-4 compounds per MoA, 5-14 treatments), compound intervals are wide, and only ~92 of 103 queries survive the strictest exclusion. The labels are the curators' (6 of 12 classes were visually defined, the rest from the literature).
- Possible confound I cannot rule out from these files: the curated treatments were chosen with a profile-based activity criterion from a different feature set (per the BBBC page), which selects treatments that already look distinct.

## Reproduce

Python 3.13; `numpy`, `pandas`, `matplotlib` (pinned in `requirements.txt`; no GPU, no scikit-learn). From this directory:

```sh
python run.py "$HOME/tmp/celllab-public-morphology"
```

About 6 s after the first download (about 10 MB; 3 files). A SHA256/size mismatch aborts. Outputs go to `results/`; nothing in the application or any private database is read or written.

## What would justify a paper?

Not this table: the benchmark is saturated and well published. The open question is *how* batch shortcuts inflate profile-based MoA calls and what controls remove them. A confirmatory design would freeze this rule and a chemotype-aware split, then evaluate on an independent public screen with different laboratory and plate layout (for example the JUMP-CP or LINCS Cell Painting resources, or the other cell lines in the Caie et al. study if they were released) and report coverage (how many MoAs remain testable) alongside accuracy. Any link to the unstained nuclear-count work would need a dataset that has both a label-free image and an independent nuclear count in the same field; BBBC021 has neither.
