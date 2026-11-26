# Generated results (run.py)

## Part A: BBBC021 vs JUMP-Target-1 overlap

BBBC021 labelled compounds: 39; with a published SMILES: 34; structure (InChIKey connectivity block) found in JUMP-Target-1: **6**.

Profile feature names: ljosa_2013 518 columns, CPJUMP1 904 features, exactly shared names: **86**.

| bbbc021_compound | moa | jump_connectivity_match | jump_best_name | jump_name_similarity |
|---|---|---|---|---|
| PP-2 | Epithelial | PP-2 | pp-2 | 1.000 |
| anisomycin | Protein synthesis | anisomycin | anisomycin | 1.000 |
| colchicine | Microtubule destabilizers | colchicine | colchicine | 1.000 |
| cyclohexamide | Protein synthesis | cycloheximide | cycloheximide | 0.920 |
| epothilone B | Microtubule stabilizers | epothilone-b | epothilone-b | 0.920 |
| simvastatin | Cholesterol-lowering | simvastatin | simvastatin | 1.000 |

| bbbc021_compound | bbbc021_moa | jump_name | compound_ap_same_condition | compound_ap_cross_cell_line | compound_ap_cross_time | jump_moa_annotation |
|---|---|---|---|---|---|---|
| PP-2 | Epithelial | PP-2 | 1.000 | 0.876 | 1.000 | src inhibitor |
| anisomycin | Protein synthesis | anisomycin | 0.817 | 0.334 | 0.504 | DNA synthesis inhibitor |
| colchicine | Microtubule destabilizers | colchicine | 0.522 | 0.119 | 0.138 | microtubule inhibitor |
| cyclohexamide | Protein synthesis | cycloheximide | 1.000 | 0.320 | 0.253 | protein synthesis inhibitor |
| epothilone B | Microtubule stabilizers | epothilone-b | 0.986 | 0.190 | 0.562 | microtubule stabilizing agent|tubulin polymerization inhibitor |
| simvastatin | Cholesterol-lowering | simvastatin | 0.635 | 0.047 | 0.224 | HMGCR inhibitor |

## Part B: CPJUMP1 compound plates

| cond | plates |
|---|---|
| A549_24h_d100_Parental | 4 |
| A549_48h_d100_Cas9 | 4 |
| A549_48h_d100_Parental | 4 |
| A549_48h_d120_Parental | 2 |
| A549_48h_d80_Parental | 2 |
| U2OS_24h_d100_Parental | 4 |
| U2OS_48h_d100_Parental | 4 |

### Same-compound retrieval (mAP, 1 = perfect; null = plate-wise label permutation)

| transform | tier | n_queries | n_groups | mAP | top1 | null_mAP_mean | null_mAP_p95 | perm_p | compound_ap_thr95 | frac_compounds_above_null95 |
|---|---|---|---|---|---|---|---|---|---|---|
| negcon_fs | same_condition | 5050 | 306 | 0.493 | 0.535 | 0.010 | 0.011 | 0.005 | 0.026 | 1.000 |
| negcon_fs | cross_cell_line | 5050 | 306 | 0.106 | 0.089 | 0.009 | 0.009 | 0.005 | 0.021 | 0.732 |
| negcon_fs | cross_time | 5050 | 306 | 0.309 | 0.328 | 0.009 | 0.009 | 0.005 | 0.020 | 0.958 |
| plate_fs | same_condition | 5050 | 306 | 0.507 | 0.546 | 0.010 | 0.011 | 0.005 | 0.026 | 1.000 |
| plate_fs | cross_cell_line | 5050 | 306 | 0.120 | 0.107 | 0.009 | 0.009 | 0.005 | 0.021 | 0.788 |
| plate_fs | cross_time | 5050 | 306 | 0.323 | 0.340 | 0.009 | 0.009 | 0.005 | 0.021 | 0.990 |
| cond_center | same_condition | 5050 | 306 | 0.496 | 0.536 | 0.010 | 0.011 | 0.005 | 0.026 | 0.997 |
| cond_center | cross_cell_line | 5050 | 306 | 0.118 | 0.104 | 0.009 | 0.009 | 0.005 | 0.021 | 0.781 |
| cond_center | cross_time | 5050 | 306 | 0.317 | 0.338 | 0.009 | 0.009 | 0.005 | 0.021 | 0.990 |

### DMSO well-position nuisance baseline (same-position retrieval among DMSO wells)

| transform | tier | n_queries | mAP | top1 | null_mAP_mean | null_mAP_p95 | perm_p |
|---|---|---|---|---|---|---|---|
| negcon_fs | same_condition | 1010 | 0.240 | 0.234 | 0.041 | 0.045 | 0.005 |
| negcon_fs | cross_cell_line | 1010 | 0.112 | 0.085 | 0.036 | 0.038 | 0.005 |
| negcon_fs | cross_time | 1010 | 0.178 | 0.177 | 0.036 | 0.039 | 0.005 |
| plate_fs | same_condition | 1010 | 0.243 | 0.239 | 0.041 | 0.045 | 0.005 |
| plate_fs | cross_cell_line | 1010 | 0.115 | 0.086 | 0.036 | 0.039 | 0.005 |
| plate_fs | cross_time | 1010 | 0.179 | 0.166 | 0.036 | 0.038 | 0.005 |
| cond_center | same_condition | 1010 | 0.244 | 0.232 | 0.041 | 0.044 | 0.005 |
| cond_center | cross_cell_line | 1010 | 0.113 | 0.081 | 0.036 | 0.038 | 0.005 |
| cond_center | cross_time | 1010 | 0.178 | 0.172 | 0.036 | 0.039 | 0.005 |

### Paired compound-bootstrap contrasts (mean AP difference, 95% CI)

| contrast | n_compounds | mean_diff | ci_lo | ci_hi |
|---|---|---|---|---|
| same_condition: cond_center - negcon_fs | 306 | 0.004 | 0.002 | 0.007 |
| same_condition: negcon_fs - plate_fs | 306 | -0.015 | -0.018 | -0.011 |
| cross_cell_line: cond_center - negcon_fs | 306 | 0.011 | 0.009 | 0.014 |
| cross_cell_line: negcon_fs - plate_fs | 306 | -0.013 | -0.017 | -0.009 |
| cross_time: cond_center - negcon_fs | 306 | 0.008 | 0.005 | 0.011 |
| cross_time: negcon_fs - plate_fs | 306 | -0.013 | -0.017 | -0.010 |
| negcon_fs: cross_cell_line - same_condition | 306 | -0.373 | -0.409 | -0.340 |
| negcon_fs: cross_time - same_condition | 306 | -0.177 | -0.196 | -0.158 |
| negcon_fs: cross_time - cross_cell_line | 306 | 0.197 | 0.169 | 0.225 |
| plate_fs: cross_cell_line - same_condition | 306 | -0.375 | -0.409 | -0.342 |
| plate_fs: cross_time - same_condition | 306 | -0.178 | -0.198 | -0.160 |
| plate_fs: cross_time - cross_cell_line | 306 | 0.197 | 0.169 | 0.225 |
| cond_center: cross_cell_line - same_condition | 306 | -0.366 | -0.400 | -0.334 |
| cond_center: cross_time - same_condition | 306 | -0.173 | -0.192 | -0.155 |
| cond_center: cross_time - cross_cell_line | 306 | 0.193 | 0.166 | 0.221 |

### Secondary conditions (same-condition other-plate; A549 48 h d100 vs density/Cas9 plates)

| transform | query_condition | pool | n_plates_query | n_queries | mAP | top1 |
|---|---|---|---|---|---|---|
| negcon_fs | A549_24h_d100_Parental | same_condition_other_plate | 4 | 1279 | 0.456 | 0.505 |
| negcon_fs | A549_48h_d100_Cas9 | same_condition_other_plate | 4 | 1279 | 0.514 | 0.574 |
| negcon_fs | A549_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.636 | 0.672 |
| negcon_fs | A549_48h_d100_Parental | other_density_or_Cas9 | 4 | 1280 | 0.442 | 0.548 |
| negcon_fs | A549_48h_d120_Parental | same_condition_other_plate | 2 | 640 | 0.633 | 0.572 |
| negcon_fs | A549_48h_d80_Parental | same_condition_other_plate | 2 | 640 | 0.623 | 0.548 |
| negcon_fs | U2OS_24h_d100_Parental | same_condition_other_plate | 4 | 1211 | 0.463 | 0.501 |
| negcon_fs | U2OS_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.414 | 0.459 |
| plate_fs | A549_24h_d100_Parental | same_condition_other_plate | 4 | 1279 | 0.468 | 0.513 |
| plate_fs | A549_48h_d100_Cas9 | same_condition_other_plate | 4 | 1279 | 0.543 | 0.589 |
| plate_fs | A549_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.649 | 0.684 |
| plate_fs | A549_48h_d100_Parental | other_density_or_Cas9 | 4 | 1280 | 0.453 | 0.555 |
| plate_fs | A549_48h_d120_Parental | same_condition_other_plate | 2 | 640 | 0.641 | 0.575 |
| plate_fs | A549_48h_d80_Parental | same_condition_other_plate | 2 | 640 | 0.643 | 0.564 |
| plate_fs | U2OS_24h_d100_Parental | same_condition_other_plate | 4 | 1211 | 0.478 | 0.505 |
| plate_fs | U2OS_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.431 | 0.480 |
| cond_center | A549_24h_d100_Parental | same_condition_other_plate | 4 | 1279 | 0.459 | 0.506 |
| cond_center | A549_48h_d100_Cas9 | same_condition_other_plate | 4 | 1279 | 0.520 | 0.575 |
| cond_center | A549_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.640 | 0.678 |
| cond_center | A549_48h_d100_Parental | other_density_or_Cas9 | 4 | 1280 | 0.444 | 0.548 |
| cond_center | A549_48h_d120_Parental | same_condition_other_plate | 2 | 640 | 0.630 | 0.561 |
| cond_center | A549_48h_d80_Parental | same_condition_other_plate | 2 | 640 | 0.638 | 0.562 |
| cond_center | U2OS_24h_d100_Parental | same_condition_other_plate | 4 | 1211 | 0.468 | 0.503 |
| cond_center | U2OS_48h_d100_Parental | same_condition_other_plate | 4 | 1280 | 0.416 | 0.457 |

### Compound-disjoint MoA 1-NN (compound-mean profiles; eligible = class has >=2 compounds)

| transform | tier | n_compounds | acc | ci_lo | ci_hi | majority | minus_majority | minus_majority_lo | minus_majority_hi |
|---|---|---|---|---|---|---|---|---|---|
| negcon_fs | cross_cell_line | 161 | 0.017 | 0.006 | 0.031 | 0.043 | -0.026 | -0.064 | 0.008 |
| negcon_fs | cross_time | 161 | 0.054 | 0.031 | 0.081 | 0.043 | 0.011 | -0.031 | 0.051 |
| negcon_fs | same_condition | 161 | 0.079 | 0.050 | 0.113 | 0.043 | 0.036 | -0.014 | 0.082 |
| plate_fs | cross_cell_line | 161 | 0.020 | 0.008 | 0.034 | 0.043 | -0.023 | -0.059 | 0.011 |
| plate_fs | cross_time | 161 | 0.054 | 0.028 | 0.084 | 0.043 | 0.011 | -0.033 | 0.054 |
| plate_fs | same_condition | 161 | 0.081 | 0.051 | 0.115 | 0.043 | 0.037 | -0.012 | 0.082 |
| cond_center | cross_cell_line | 161 | 0.025 | 0.011 | 0.040 | 0.043 | -0.019 | -0.056 | 0.016 |
| cond_center | cross_time | 161 | 0.051 | 0.028 | 0.079 | 0.043 | 0.008 | -0.034 | 0.050 |
| cond_center | same_condition | 161 | 0.082 | 0.051 | 0.116 | 0.043 | 0.039 | -0.011 | 0.084 |
