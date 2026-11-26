# Amplicon pre-flight audit: generated report

Uniform sample of 20000 read pairs per mock (seed 2026). Headline setting: maxEE 2.0, min count 2.

## Orientation of the read files relative to the published expected sequences

dataset read_file  reads  frac_plus  frac_minus  frac_no_hit_or_tie
mock-12   forward   5000     0.9982      0.0000              0.0018
mock-12   reverse   5000     0.0000      0.9912              0.0088
mock-24   forward   5000     0.0000      0.8692              0.1308
mock-24   reverse   5000     0.8314      0.0000              0.1686
mock-25   forward   5000     0.0000      0.8600              0.1400
mock-25   reverse   5000     0.7436      0.0000              0.2564

## Primer state (sample-metadata primers searched in the first reads)

dataset read_file  reads  starts_with_fwd_primer_le2mm  starts_with_rev_primer_le2mm  exact_iupac_hit_fwd  exact_iupac_hit_fwd_rc  exact_iupac_hit_rev  exact_iupac_hit_rev_rc
mock-12   forward  20000                           0.0                           0.0                  0.0                  0.0000                  0.0                 0.00000
mock-12   reverse  20000                           0.0                           0.0                  0.0                  0.0000                  0.0                 0.00000
mock-24   forward  20000                           0.0                           0.0                  0.0                  0.0000                  0.0                 0.00000
mock-24   reverse  20000                           0.0                           0.0                  0.0                  0.0000                  0.0                 0.00000
mock-25   forward  20000                           0.0                           0.0                  0.0                  0.0004                  0.0                 0.00000
mock-25   reverse  20000                           0.0                           0.0                  0.0                  0.0000                  0.0                 0.00055

## Headline pipeline outcome

                                    4         13        22
dataset                        mock-12   mock-24   mock-25
max_ee                             2.0       2.0       2.0
min_count                            2         2         2
pairs                            20000     20000     20000
trunc_ok                         20000     16840     16822
merged                           16516       343       540
merged_frac_of_pairs            0.8258   0.01715     0.027
merged_frac_of_trunc_ok         0.8258  0.020368  0.032101
reads_after_ee_and_min_count     13730        32        14
frac_exact                    0.785288    0.0625  0.571429
frac_near                     0.214348    0.8125  0.428571
frac_ambiguous                     0.0       0.0       0.0
frac_chimera_like                  0.0       0.0       0.0
frac_other                    0.000364     0.125       0.0
frac_no_seed                       0.0       0.0       0.0
frac_singleton_not_aligned         0.0       0.0       0.0
n_other_variants                     2         2         0
n_chimera_like_variants              0         0         0
expected_taxa                       26         8         8
detected_ge1                        13         3         3
detected_ge10                        9         1         0
bray_curtis_taxon             0.805392  0.478901  0.168697
median_abs_log2_ratio         3.563366  0.730024   0.27006
max_abs_log2_ratio            7.989631  0.978617    1.7156

## Per-taxon expected vs observed (headline setting)

dataset                        taxon  expected_frac  reads  observed_frac  median_core_len  n_refs  log2_obs_over_exp
mock-12 Bacteroides cellulosilyticus       0.037037    614       0.044736            253.0       3           0.272464
mock-12        Bacteroides eggerthii       0.037037      0       0.000000            253.0       1                NaN
mock-12         Bacteroides fragilis       0.037037      6       0.000437            253.0       1          -6.404669
mock-12     Bacteroides massiliensis       0.037037      0       0.000000            253.0       1                NaN
mock-12           Bacteroides ovatus       0.037037   6645       0.484153            253.0       7           3.708422
mock-12 Bacteroides thetaiotaomicron       0.037037      7       0.000510            253.0       3          -6.182276
mock-12        Bacteroides uniformis       0.037037     53       0.003862            253.0       5          -3.261711
mock-12         Bacteroides vulgatus       0.037037   5320       0.387614            253.0       5           3.387580
mock-12 Barnesiella intestinihominis       0.037037      0       0.000000            253.0       2                NaN
mock-12          Clostridium celatum       0.037037      2       0.000146            253.0       1          -7.989631
mock-12        Clostridium cocleatum       0.037037     42       0.003060            252.0       1          -3.597314
mock-12   Clostridium methylpentosum       0.037037      0       0.000000            253.0       2                NaN
mock-12  Clostridium phytofermentans       0.037037      0       0.000000            253.0       1                NaN
mock-12     Clostridium xylanovorans       0.037037    488       0.035556            253.0       1          -0.058894
mock-12            Coprococcus comes       0.037037     43       0.003133            253.0       2          -3.563366
mock-12          Eubacterium rectale       0.037037      0       0.000000            253.0       1                NaN
mock-12        Howardella ureilytica       0.037037      0       0.000000            253.0       1                NaN
mock-12   Parabacteroides distasonis       0.074074    436       0.031767            253.0       2          -1.221447
mock-12       Parabacteroides merdae       0.037037     63       0.004590            253.0       5          -3.012351
mock-12      Parabacteroides sp. D13       0.037037      0       0.000000            253.0       1                NaN
mock-12         Paraprevotella clara       0.037037      0       0.000000            252.0       2                NaN
mock-12          Prevotella buccalis       0.037037      0       0.000000            253.0       1                NaN
mock-12             Prevotella copri       0.037037      0       0.000000            253.0       4                NaN
mock-12       Roseburia intestinalis       0.037037      0       0.000000            253.0       1                NaN
mock-12      Roseburia inulinivorans       0.037037      6       0.000437            253.0       1          -6.404669
mock-12          Ruminococcus gnavus       0.037037      0       0.000000            253.0       4                NaN
mock-24             Amanita muscaria       0.000433      0       0.000000            388.0       1                NaN
mock-24          Amphinema byssoides       0.434971     24       0.857143            323.0       1           0.978617
mock-24          Coprinopsis cinerea       0.043064      2       0.071429            371.0       1           0.730024
mock-24           Mortierella alpina       0.043064      0       0.000000            375.0       1                NaN
mock-24    Schizosaccharomyces pombe       0.430665      0       0.000000            535.0       1                NaN
mock-24      Spizellomyces punctatus       0.000433      0       0.000000            369.0       1                NaN
mock-24          Tricholoma vaccinum       0.004306      0       0.000000            365.0       1                NaN
mock-24        Tylospora asterophora       0.043064      2       0.071429            347.0       1           0.730024
mock-25             Amanita muscaria       0.430664      7       0.500000            388.0       1           0.215366
mock-25          Amphinema byssoides       0.043497      2       0.142857            323.0       1           1.715600
mock-25          Coprinopsis cinerea       0.004307      0       0.000000            371.0       1                NaN
mock-25           Mortierella alpina       0.000431      0       0.000000            375.0       1                NaN
mock-25    Schizosaccharomyces pombe       0.004307      0       0.000000            535.0       1                NaN
mock-25      Spizellomyces punctatus       0.043065      0       0.000000            369.0       1                NaN
mock-25          Tricholoma vaccinum       0.043065      0       0.000000            365.0       1                NaN
mock-25        Tylospora asterophora       0.430664      5       0.357143            347.0       1          -0.270060

## ITS mock-24 vs mock-25 library-ratio check

                    taxon  expected_log2_ratio_24_over_25  observed_log2_ratio_24_over_25  reads_24  reads_25  bias_shift_log2
         Amanita muscaria                       -9.957099                             NaN         0         7              NaN
      Amphinema byssoides                        3.321946                        2.584963        24         2        -0.736983
      Coprinopsis cinerea                        3.321709                             NaN         2         0              NaN
       Mortierella alpina                        6.641958                             NaN         0         0              NaN
Schizosaccharomyces pombe                        6.643725                             NaN         0         0              NaN
  Spizellomyces punctatus                       -6.635137                             NaN         0         0              NaN
      Tricholoma vaccinum                       -3.321979                             NaN         0         0              NaN
    Tylospora asterophora                       -3.322013                       -2.321928         2         5         1.000085

Pearson r of log2 ratios (observed vs expected): None

## Amplicon length vs recovery

dataset  n_taxa  spearman_len_vs_log2ratio        p
mock-12      13                   0.154303 0.614737
mock-24       3                        NaN      NaN
mock-25       3                        NaN      NaN

## Dataset facts

[
 {
  "dataset": "mock-12",
  "marker": "16S V4",
  "study": "Callahan 2016 'Extreme' mock, 27 strains, MiSeq 2x251 (doi:10.1038/nmeth.3869)",
  "fwd_primer": "GTGCCAGCMGCCGCGGTAA",
  "rev_primer": "GGACTACHVGGGTWTCTAAT",
  "files_swapped_relative_to_expected_entries": false,
  "refs_in_fasta": 61,
  "refs_with_core": 59,
  "refs_without_core": [
   "Bacteroides thetaiotaomicron",
   "Bacteroides thetaiotaomicron"
  ],
  "expected_taxa_without_any_ref_core": [],
  "ref_taxa_not_in_taxonomy_table": [],
  "merged_len_median": 253.0,
  "merged_len_p5_p95": [
   253.0,
   253.0
  ],
  "overlap_median": 249.0,
  "distinct_merged_sequences": 3583,
  "distinct_aligned": 797,
  "tail_clip": 0
 },
 {
  "dataset": "mock-24",
  "marker": "ITS2 (fungal)",
  "study": "Taylor 2016 'Mock A', 8 fungi, uneven, MiSeq 2x250 (doi:10.1128/AEM.02576-16)",
  "fwd_primer": "AACTTTYRRCAAYGGATCWCT",
  "rev_primer": "AGCCTCCGCTTATTGATATGCTTAART",
  "files_swapped_relative_to_expected_entries": true,
  "refs_in_fasta": 8,
  "refs_with_core": 8,
  "refs_without_core": [],
  "expected_taxa_without_any_ref_core": [],
  "ref_taxa_not_in_taxonomy_table": [],
  "merged_len_median": 348.0,
  "merged_len_p5_p95": [
   347.0,
   365.0
  ],
  "overlap_median": 53.0,
  "distinct_merged_sequences": 319,
  "distinct_aligned": 8,
  "tail_clip": 30
 },
 {
  "dataset": "mock-25",
  "marker": "ITS2 (fungal)",
  "study": "Taylor 2016 'Mock B', same 8 fungi, different uneven mixing (doi:10.1128/AEM.02576-16)",
  "fwd_primer": "AACTTTYRRCAAYGGATCWCT",
  "rev_primer": "AGCCTCCGCTTATTGATATGCTTAART",
  "files_swapped_relative_to_expected_entries": true,
  "refs_in_fasta": 8,
  "refs_with_core": 8,
  "refs_without_core": [],
  "expected_taxa_without_any_ref_core": [],
  "ref_taxa_not_in_taxonomy_table": [],
  "merged_len_median": 364.0,
  "merged_len_p5_p95": [
   348.0,
   403.0
  ],
  "overlap_median": 38.0,
  "distinct_merged_sequences": 531,
  "distinct_aligned": 5,
  "tail_clip": 30
 }
]