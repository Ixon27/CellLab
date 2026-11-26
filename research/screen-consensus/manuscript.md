# Does a second drug screen improve the shortlist? A fixed-budget benchmark of pharmacological sensitivity across four public screens

**Working manuscript — computational results, not a submitted or peer-reviewed paper.**

## Abstract

Pharmacogenomic screens are commonly combined, but agreement across assays does not by itself show that merging rankings improves cell-model selection. We tested whether a two-screen consensus improves the fraction of externally confirmed sensitive cell lines under a fixed shortlist budget. For each drug we ranked common lines by viability-curve area in GDSC1 and GDSC2, averaged their percentile ranks, and evaluated the most sensitive decile in the PRISM secondary screen. Across 48 drugs and 11,490 drug–cell-line pairs, macro precision was 25.7% for consensus, 24.1% for GDSC1 and 23.5% for GDSC2 (chance 9.7%). The gain over either single screen was not resolved by paired drug bootstrap intervals. On 25 drugs with identical candidate panels in PRISM and CTRPv2, consensus precision was 30.1% and 35.2%, respectively; GDSC2 alone achieved 29.9% and 42.0%. Only 17.0% of consensus selections were in the sensitive decile of both external measurements, versus 2.7% expected from random selection and the observed dual-positive prevalence. These data distinguish external enrichment from incremental decision value: combining two informative screens enriched for reproducible sensitivity but did not consistently improve shortlist precision. The comparison concerns already measured cell models, not treatment efficacy or patient selection.

## Design and results

The [analysis protocol](README.md) defines the primary endpoint, inclusion criteria and measurement budgets. No neural network was trained and no target outcomes were used to learn weights. GDSC screens are related experiments from one programme; the two external measurement sets both come from Broad. Cell identities were linked to DepMap using Sanger model/COSMIC identifiers, not fuzzy matching. Compound names had to agree exactly after case/whitespace normalization; ambiguous identifiers were excluded rather than guessed. This is conservative, not chemical structure validation. CTRP was joined by unique BRD parent compound identifiers and CCLE-style cell names. Each comparison below uses the same candidate lines and budget for all algorithms within each drug. Drug means receive equal weight, not weights proportional to the number of measured lines.

| Candidate universe; evaluation readout | Drugs | Drug–cell pairs | GDSC1 | GDSC2 | Consensus | Random |
|---|---:|---:|---:|---:|---:|---:|
| Three screens; PRISM (primary) | 48 | 11,490 | 24.1% | 23.5% | 25.7% | 9.7% |
| Four screens; PRISM | 25 | 5,120 | 28.3% | 29.9% | 30.1% | 9.7% |
| Same four screens; CTRP | 25 | 5,120 | 31.4% | 42.0% | 35.2% | 9.7% |
| Same four screens; **both** PRISM and CTRP positives | 25 | 5,120 | 14.7% | 20.3% | 17.0% | 2.7% |

**Primary comparison.** Consensus minus GDSC1 was +1.58 percentage points (paired drug-bootstrap 95% interval −0.99 to +4.18); consensus minus GDSC2 was +2.21 points (−0.57 to +4.93). Neither passes the prespecified superiority rule. This is not an equivalence test. In contrast, consensus exceeded general cell susceptibility estimated from the other compounds by 11.15 points (6.39–16.17), and the conditional tissue-label randomization expectation by 11.08 points (7.79–14.41). Tissue labels are TCGA categories, sometimes unknown; this is not proof that tissue effects were fully removed.

**Measurement dependence.** On the strictly matched four-way panel, consensus underperformed GDSC2 on CTRP by 6.82 points (−12.39 to −1.91); the comparable difference on PRISM was +0.15 points (−3.76 to +3.88). These are secondary contrasts with only 25 drugs. They do not establish which experimental difference caused the direction change. PRISM and CTRP had mean sensitive-decile overlap of 28.0%; a hit in one screen is an imperfect reference for the other. Full drug-level results, including failures and ties, are retained in `results/`.

**Exploratory fit-quality analysis.** Among the 11,542 originally matched pairs before applying the minimum drug coverage, 2,923 had negative PRISM curve-fit R². Reranking after excluding negative or missing R² left 42 eligible drugs and 8,363 pairs. Consensus precision was 25.43%, compared with 25.47% and 23.00% for GDSC1 and GDSC2. Filtering changes the target population and may preferentially discard flat, resistant curves; it cannot be interpreted simply as better ground truth.

## Interpretation and submission decision

The primary evidence supports enrichment, **not** universal superiority of pooling. The positive result worth investigating is that the utility of a shortlist depends on which external assay is used to accept it. To claim a general rule for **when** to use one or two sources, a rule must predict performance without looking at the target and work on new compounds or additional withheld studies. The present results do not provide that rule. Growth medium, concentration window, viability readout, treatment time, missingness and correlated compound classes remain alternative explanations. A decile always exists even for a drug with negligible absolute activity; our results are about within-drug relative ranking only.

This is a viable starting point for a **public-only decision benchmark**; not yet a claim of a new algorithm or enough evidence for a top-tier methods paper. The highest-value extension is to refit published dose curves on common concentration windows, verify chemical identities against structures, and ask whether the observed loss on CTRP persists after grouping uncertainty by drug class. New cell cultures or new patient samples are not necessary to test that claim. Relevant prior work, data versions, complete scripts and regeneration commands are in the [protocol](README.md).
