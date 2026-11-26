# soil-transfer: site-held-out soil pH from 16S OTU tables

Question: does a real archived soil 16S OTU table predict measured soil pH for *sites never seen in training*, better than predicting the training-mean pH?

## Data (public, real, joined per sample)
- Lauber et al. 2009, 88 soils from the Americas, 454 16S V2, Qiita study 103 (`lauber_88_soils`). Paper: https://pmc.ncbi.nlm.nih.gov/articles/PMC2725504 (doi 10.1128/AEM.00335-09).
- Sample metadata incl. measured `ph`: https://qiita.ucsd.edu/public_download/?data=sample_information&study_id=103
- OTU table (QIIME 1.9 closed-reference, `processed_data/238_otu_table.biom`, 7396 OTUs x 89 samples) from the bundle https://qiita.ucsd.edu/public_download/?data=biom&study_id=103&data_type=16S
- The script downloads these to `~/tmp/soil-transfer-cache` (outside git) and records SHA-256 in `results/summary.json`.

## NEON status (honest)
NEON soil microbe community (DP1.10081.001/.002) and soil chemistry/pH (DP1.10086.001) are listed in the public product API (https://data.neonscience.org/api/v0/products/DP1.10081.001), but every `/api/v0/data/...` file-listing request from this machine returned HTTP 403 "Access Denied" (tried default and browser user-agents, with/without release=, for DP1.10086.001 and both microbe products). So no NEON ID-level join was possible here; no NEON numbers are claimed. Lauber is the substitute.

## Method
- Join: 89 BIOM samples matched metadata by sample ID; all 89 have numeric pH. The <200-read exclusion was chosen **after** an initial fit showed that the Acidobacteria-only estimate was sensitive to a single 1-read sample (103.BB1). It excludes only that sample. All reported models use the same remaining 88 samples and 37 groups (group = letter prefix of sample ID, a site proxy).
- Features: log10(relative abundance + 1e-4) of OTUs present in >=10% of *training* samples (filter refit per fold).
- Models: train-mean baseline; single feature log10 Acidobacteria fraction (the paper's headline taxon); ridge on OTUs (inner RidgeCV); random forest on OTUs.
- Evaluation: leave-one-site-out CV (primary). Control: random 8-fold CV (replicates of a site leak across folds). Site-cluster bootstrap (1000x) CI on RMSE(model) - RMSE(baseline). Site-level pH-shuffle null for ridge (20 perms).

## Results (results/summary.json; seed 0)
| leave-site-out | RMSE | R2 | dRMSE vs baseline, 95% CI |
|---|---|---|---|
| mean baseline | 1.479 | -0.069 | |
| Acidobacteria fraction | 1.103 | 0.405 | [-0.58, -0.18] |
| ridge OTU | 0.488 | 0.884 | [-1.18, -0.80] |
| random forest OTU | 0.605 | 0.821 | [-1.05, -0.69] |

Random-split CV is only slightly more optimistic (ridge RMSE 0.455), so replicate leakage is small here. Shuffled-pH null ridge RMSE: mean 1.58, min 1.24 (never near 0.49).

## Caveats
- One study, one lab, one primer set, one OTU pipeline; "site-held-out" is within this continental survey, not transfer across studies/protocols. Positive result reproduces the known pH-community link; it is not new biology.
- 37 sites, 1-7 samples each; site = ID prefix (a few prefixes may span >1 `specific_location`; 39 locations in metadata).
- Reads per sample are low (median ~966); OTU table appears already subsampled.
- Hyperparameters not nested beyond ridge alpha; RF is untuned. Honest next step: held-out *study* (e.g. another Qiita soil study with pH) or NEON once file access works.

## Reproduce
`python3 -m venv ~/tmp/soil-venv && ~/tmp/soil-venv/bin/pip install numpy pandas scipy scikit-learn h5py && ~/tmp/soil-venv/bin/python research/soil-transfer/run.py` (from repo root; ~1 min incl. 25 MB download).
