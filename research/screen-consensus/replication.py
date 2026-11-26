"""Descriptive checks on the identical four-screen panel, with no fitted thresholds."""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata, spearmanr

from evaluate import top_weights


def run(path, dest):
    rows = []
    for drug, g in pd.read_csv(path).groupby('drug'):
        if len(g) < 50:
            continue
        n = len(g)
        k = n // 10
        a, b, c, d = [rankdata(g[col]) for col in ['gdsc1','gdsc2','prism','ctrp']]
        first, second, selected, prism, ctrp = [top_weights(s,k) for s in [a,b,(a+b)/2,c,d]]
        joint = prism * ctrp  # independent tie breaking at each boundary
        rows.append(dict(drug=drug, n=n, budget=k, source_overlap=first @ second/k,
                         target_overlap=prism @ ctrp/k, random_both=joint.mean(),
                         gdsc1_both=first @ joint/k, gdsc2_both=second @ joint/k,
                         consensus_both=selected @ joint/k, consensus_prism=selected @ prism/k,
                         consensus_ctrp=selected @ ctrp/k))
    table = pd.DataFrame(rows)
    if table.empty:
        raise ValueError('No eligible four-screen panel')
    table.to_csv(dest/'dual_confirmation.csv', index=False, float_format='%.8g')
    print('Same shortlist, hits confirmed in BOTH target assays (equal weight per compound):')
    print(table[['random_both','gdsc1_both','gdsc2_both','consensus_both','target_overlap']].mean().to_string())
    if len(table) >= 3 and table.source_overlap.nunique() > 1 and table.consensus_both.nunique() > 1:
        print('Exploratory across-drug Spearman(source overlap, dual confirmation):',
              spearmanr(table.source_overlap, table.consensus_both).statistic)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fourway',type=Path)
    parser.add_argument('results',type=Path)
    args = parser.parse_args()
    run(args.fourway,args.results)
