# Do purified human immune-cell responses transfer to Parse?

**The best method depended on direction and contrast.** In the matched 24-hour IFN-γ comparison, an all-type mean recovered more Parse up-regulated genes than the type-specific or half-pooled score. Half pooling did best for down-regulated genes, but its absolute recovery was only 4.88%, versus 3.37% for uniform random selection from the source universe. For the two CD4 polarization contrasts, averaging naïve and memory CD4 scores improved macro recovery; those contrasts are **not** replications of IL-4 or IL-12 alone.

## Independent sources and units

- **Waddell et al.** ([paper](https://doi.org/10.1371/journal.pone.0009753), [purified subseries GSE16253](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE16253), [parent GSE17762](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE17762), [GPL8601](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GPL8601)). The stimulated and time-matched mock arrays are from magnetically purified B, CD4, CD8, NK and monocyte preparations. The paper describes three healthy buffy-coat donors supplying this part of the study, but the public matrix contains only one array per analyzed type/time/arm and no donor IDs. The source observation is thus an array-level contrast; neither the donor allocation nor donor-level replication is recoverable. The 24 h comparison uses four types because neither 24 h CD8 arm is deposited; the 12 h comparison adds CD8, the latest complete panel. Time points and lineages are not independent cohorts. Purity ranged from 67–98% in the study.
- **Cano-Gamez et al.** ([paper](https://doi.org/10.1038/s41467-020-15543-y), [processed bulk data S-BSST2978](https://www.ebi.ac.uk/biostudies/studies/S-BSST2978), [treatment ingredients](https://static-content.springer.com/esm/art%3A10.1038%2Fs41467-020-15543-y/MediaObjects/41467_2020_15543_MOESM5_ESM.xlsx)). The 16 h bulk comparison uses isolated naïve CD4 cells from three male donors and isolated memory CD4 cells from a **different** set of three male donors. Each contrast pairs the same donor's treated and Th0 arms *within* each type. Multiple Th0 libraries within a donor count once, and the two contrasts reuse the same Th0 donors. All three arms include CD3/CD28 stimulation. Th1 adds IL-12 and IL-4 blockade; Th2 adds IL-4 and IFN-γ blockade. These are secondary, cross-context comparisons to the corresponding single-cytokine Parse lists. Neither the blockade effect nor source state versus donor cohort can be separated here.
- **Target:** the Allen Institute's [published Parse lists and methods](https://apps.allenimmunology.org/aifi/resources/parse-10m-cytokines/downloads/) ([credits](https://apps.allenimmunology.org/aifi/resources/parse-10m-cytokines/cite/), CC BY-NC 4.0) contain the top 500 genes in each direction from DESeq2 comparisons of pseudobulk profiles from a separate [12-donor mixed-PBMC experiment](https://www.parsebiosciences.com/datasets/10-million-human-pbmcs-in-a-single-experiment), stimulated for 24 h versus PBS. We score only these published lists, not raw cells or independent target donor splits. List membership is not ground truth or evidence of significance for each gene.

## Scoring

Before evaluating any overlaps, fixed the 100-gene ranked-retrieval endpoint, the matching rules, and the 1:1 blend. Used 24 h for the time-matched array endpoint and added the 12 h full panel after inspecting sample coverage only; used 16 h as the closest Cano-Gamez time point to Parse. Array scores subtract the time-matched mock log2 ratio from the treated log2 ratio. Keep probes with an unambiguous approved HGNC mapping by Entrez ID and values in all arms of the panel, then take the median probe contrast per gene. For bulk, average log2(CPM+1) across libraries for each donor/type/arm, difference the paired arms, then average the three donor contrasts equally. Within each contrast require CPM ≥ 1 in at least three participating libraries in **each** state, map Ensembl IDs to HGNC, and median-collapse duplicate symbols. Retain a source-only gene universe per contrast; each of the four models ranks that same universe.

Models are the matching type alone, the mean of all *other* source types, a 1:1 mixture of those two, and a single mean across **all** source types. With two states, the mixture equals the all-type mean, so they are not distinct confirmation of pooling. Score the 100 extreme genes in each direction (break ties by symbol) against the corresponding Parse list. Average mapped Parse subtypes within each source type, then weight each source type equally. The [subtype table](results/by_subtype.csv) includes the source universe and the number of target genes detectable in it: 333–409 of 500 for Waddell at 24 h and 460–478 for the CD4 comparisons. The uniform-gene baseline is detectable target list size divided by source universe size; it is not a test or a null accounting for gene correlation or shared biology.

## Observed macro precision at 100 (%)

| Source → Parse | Direction | Matching type | Other types only | 1:1 mixture | All-type mean | Random expectation |
|---|---|---:|---:|---:|---:|---:|
| IFN-γ, 24 h → IFN-γ | Up | 11.75 | 19.13 | 19.00 | **21.63** | 3.59 |
| IFN-γ, 24 h → IFN-γ | Down | 4.25 | 1.63 | **4.88** | 3.00 | 3.37 |
| IFN-γ, 12 h → IFN-γ | Up | 13.10 | 23.10 | 20.70 | **24.60** | 3.62 |
| IFN-γ, 12 h → IFN-γ | Down | 5.90 | 3.20 | **6.30** | 4.20 | 3.42 |
| Th1, 16 h → IL-12 | Up | 10.00 | 10.50 | **12.00** | **12.00** | 3.73 |
| Th1, 16 h → IL-12 | Down | 11.50 | 13.50 | **17.50** | **17.50** | 3.83 |
| Th2, 16 h → IL-4 | Up | 16.00 | 16.50 | **26.50** | **26.50** | 3.83 |
| Th2, 16 h → IL-4 | Down | 23.00 | 20.50 | **32.50** | **32.50** | 3.71 |

Macro wins do not mean all lineages improve. At 24 h, the monocyte up-list scored 25.5% with half pooling and 22.5% with the all-type mean; the NK up-list scored 0.0% for matching type versus 27.5% for the all-type mean. For Th2 → IL-4 up-regulation, pooling raised memory CD4 recovery from 4% to 27% while reducing naïve CD4 recovery from 28% to 26%. The 12 h and 24 h IFN-γ panels differ in lineage coverage as well as time, so their change in magnitude is not a time effect estimate. Mixed vs purified cultures, treatment/control context, dose, platform, source-panel composition and coarse subtype mappings all affect cross-study agreement. This is a descriptive external holdout, not evidence for a universal pooling weight or a donor threshold.

## Reproduce

From the repository root, using Python 3.13.12 and the pinned packages below. Data are downloaded to the external cache, and each file is verified against the SHA-256 in `run.py`. The script only writes the [macro table](results/macro.csv), [subtype table](results/by_subtype.csv), and [analyzed sample layout](results/source_samples.csv) to the output directory; it writes no source expression data or target gene lists there.

```sh
python -m pip install -r research/cytokine-sorted/requirements.txt
python research/cytokine-sorted/run.py "$HOME/tmp/celllab-cytokine-sorted" research/cytokine-sorted/results
```
