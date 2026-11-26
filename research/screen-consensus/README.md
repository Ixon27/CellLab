# Can a two-screen shortlist of drug-sensitive cancer cell lines be trusted in a third assay?

Public-only computational pharmacogenomics pilot. Decision: when a researcher can select only 10% of the available cell lines for a given compound, does averaging ranks across two screens recover more externally sensitive lines than using either source alone? This is replication of **previously measured** cell models, not prediction for unseen patients, lines or untested drugs. No CellLab records are used.

[Working manuscript and observed effect sizes](manuscript.md) · [source flow](results/source-flow.json) · [per-drug primary results](results/per_drug.csv) · [dual confirmations](results/dual_confirmation.csv)

## Protocol fixed before scoring PRISM

1. Use fitted dose-response curve AUC from Sanger GDSC1 and GDSC2 (release 8.5, 27 Oct 2023) as the sources. Evaluate on independently measured [Broad PRISM secondary, 19Q4](https://doi.org/10.6084/m9.figshare.9393293). Lower viability AUC is more sensitive. Within each drug use exactly the same intersection of matched lines for every method. Source versions and identity/QC rules are in `prepare.py`. No external AUC is used for selection, hyperparameter search or score fitting; presence of a target measurement is used to define the candidate universe.
2. Include all compounds with ≥50 uniquely matched lines across the three screens. For each drug let `k = floor(0.10 × number of eligible lines)`. Equal budget in every arm. Ground truth is the k lowest PRISM AUC values for the same drug, a *relative* sensitivity label, not evidence of efficacy or even an absolute response. Ties that cross the cutoff get fractional membership, both for the shortlist and the target; this gives expected precision under independent tie breaking.
3. No fitted ML required for the primary test. Compare mean within-drug percentile rank (GDSC1 + GDSC2) against GDSC1 alone and GDSC2 alone. Additional controls: (a) random k/n, (b) leave-this-drug-out mean susceptibility rank across other matched drug pairs for each cell, using only GDSC response values (neutral 0.5 if unknown), and (c) expected precision after randomizing target hits **within tissue categories** for each drug. The last is a conditional null, not a deployable predictor. TCGA categories from GDSC are only proxies for lineage; pooling unknowns does not remove all confounding.
4. Primary outcome is precision@k averaged **equally across drugs**. Report paired drug-level differences with percentile intervals (10,000 drug bootstraps, seed 2026), all per-drug results and the fraction of drugs improved. Evidence for a gain from the second screen requires a positive difference vs **both** single screens with both lower confidence bounds above zero. A high lift over random alone is not enough. The bootstrap is descriptive conditional on these assays, cells and compound mix; related compounds and shared cell panels are not independent studies. Sensitivity: identical pipeline at 5% and 20%; neither can replace the primary endpoint.
5. Second external readout planned before seeing either endpoint: [CTRP v2](https://portals.broadinstitute.org/ctrp.v2/), [ORCESTRA frozen PSet](https://doi.org/10.5281/zenodo.7826870). Match via one-to-one BRD parent compound IDs and CCLE stripped names, exclude missing recomputed AAC, and use median negative AAC for technical/experimental repeats to align the direction. Re-evaluate PRISM **and** CTRP on the identical four-way overlap, reranking both source screens inside that cohort. This checks whether the same shortlist works under two different target assays; it is not a second independent collection of drugs or an independent institution from PRISM.
6. Descriptive decision check: on the four-way panel, count a shortlist member as confirmed only if it is in the sensitive decile of **both** PRISM and CTRP. The random comparator is the observed prevalence of these dual positives, not 0.1 squared (the two assays are not independent). Relate source shortlist overlap to this dual precision across drugs as an exploratory diagnostic, not a validated drug-specific confidence score.

## Reproduce

```sh
cd research/screen-consensus
CACHE="$HOME/tmp/celllab-drug-rank"
python prepare.py "$CACHE"
python evaluate.py "$CACHE/matched.csv" results
python ctrp.py "$CACHE"  # requires base R with Rscript
python evaluate.py "$CACHE/fourway.csv" results/matched-prism
python evaluate.py "$CACHE/fourway.csv" results/matched-ctrp --target ctrp
python replication.py "$CACHE/fourway.csv" results
python evaluate.py "$CACHE/matched-r2.csv" results/prism-r2  # exploratory fit-quality sensitivity
```

Raw data remain outside git. `results/per_drug.csv` gives denominators, equal budgets, precision, chance rates conditional on tissue, and ties. `results/summary.csv` and `results/contrasts.csv` are the aggregate endpoints; precision and differences are fractions, not percentage points. NumPy and pandas suffice for evaluation.
Tested with Python 3.13.12 (`requirements.txt`) and R 4.5.2. `matched-r2.csv` restricts the primary matched cohort to nonmissing PRISM curve R² ≥ 0 before reranking; this was added after the primary analysis, not used to choose the headline comparison.

## Novelty boundary and publication standard

- Cross-study agreement and inconsistencies are established, not our discovery. [A cross-study analysis of drug response prediction in cancer cell lines](https://doi.org/10.1093/bib/bbab356) benchmarked generalization; [Chen et al., Bioinformatics](https://doi.org/10.1093/bioinformatics/btag382) compared curve fits, response metrics and concentration windows. [Nader et al., preprint](https://doi.org/10.64898/2026.04.29.721574) already benchmarked reproducibility across 15 studies. This project does not claim that comparing GDSC and PRISM or averaging ranks is new.
- Added question: **how much value does buying a second measurement add at a fixed selection budget, beyond tissue and nonspecific susceptibility?** The GDSC screens belong to one programme; PRISM uses pooled cultures, different durations/dose ranges and readout. A smaller intersection of well-annotated, already tested models is not representative of all cells. Source concordance cannot establish clinical response or a drug mechanism.
- For a journal claim beyond the present design: repeat on shared concentration windows from raw curves, verify compound structures/salts independently of names, and resample by related compound groups as well as drugs. Document lack of coverage where a claim cannot be tested. If the second screen buys no reliable gain, report limits on that decision rather than retrofitting a neural net to the same target.
