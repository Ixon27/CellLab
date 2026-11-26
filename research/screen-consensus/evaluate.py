"""Evaluate fixed GDSC shortlists against independent target measurements."""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd


SOURCES = ['gdsc1', 'gdsc2']
FRACTIONS = (0.1, 0.05, 0.2)


def top_weights(values, k):
    """Exact budget k with fractional membership for a tied boundary."""
    cutoff = np.partition(values, k - 1)[k - 1]
    before, at = values < cutoff, values == cutoff
    return before.astype(float) + (k - before.sum()) / at.sum() * at


def drug_scores(frame, target):
    rank_cols = ['rank1', 'rank2']
    # Ranks on the common candidate universe only; no target magnitudes used.
    frame[rank_cols] = frame.groupby('drug')[SOURCES].rank(pct=True)
    frame['mean_rank'] = frame[rank_cols].mean(axis=1)
    # General susceptibility to OTHER drugs, not a score fitted to PRISM.
    by_cell = frame.groupby('cell').mean_rank
    n_other = by_cell.transform('count') - 1
    frame['pan'] = ((by_cell.transform('sum') - frame.mean_rank) / n_other.replace(0, np.nan)).fillna(0.5)
    out = []
    for drug, rows in frame.groupby('drug', sort=True):
        if len(rows) < 50:
            continue
        values = rows[target].to_numpy()
        tissue = rows.tissue.astype('category').cat.codes.to_numpy()
        counts = np.bincount(tissue)
        for fraction in FRACTIONS:
            k = max(1, int(len(rows) * fraction))
            positive = top_weights(values, k)
            # Precision expected if PRISM hits were exchangeable within each tissue.
            # Holds composition of both shortlist and target positives fixed in expectation.
            stratum_rate = np.bincount(tissue, weights=positive) / np.maximum(1, counts)
            for model, col in [('gdsc1', 'rank1'), ('gdsc2', 'rank2'), ('consensus', 'mean_rank'), ('pan', 'pan')]:
                scores = rows[col].to_numpy()
                w = top_weights(scores, k)
                precision = w @ positive / k
                null = w @ stratum_rate[tissue] / k
                out.append(dict(drug=drug, n=len(rows), k=k, fraction=fraction, model=model,
                                precision=precision, random=k/len(rows), tissue_null=null,
                                above_tissue=precision-null, tied_at_cutoff=np.count_nonzero((w > 0) & (w < 1))))
    return pd.DataFrame(out)


def write_metrics(matched, dest, target):
    frame = pd.read_csv(matched, keep_default_na=False)
    required = ['drug', 'cell', 'tissue', *SOURCES, target]
    if set(required) - set(frame) or frame.duplicated(['drug', 'cell']).any():
        raise ValueError('Expected one matched response per drug/cell with tissue')
    if not np.isfinite(frame[[*SOURCES, target]].to_numpy(dtype=float)).all() or (frame[required[:3]] == '').any().any():
        raise ValueError('Nonfinite responses or empty identifiers')
    metrics = drug_scores(frame, target)
    if metrics.empty:
        raise ValueError('No drug has at least 50 matched lines; no adequate common cohort')
    dest.mkdir(parents=True, exist_ok=True)
    metrics.to_csv(dest/'per_drug.csv', index=False, float_format='%.8g')
    summary = metrics.groupby(['fraction', 'model']).agg(drugs=('drug','size'), pairs=('n','sum'),
        precision=('precision','mean'), random=('random','mean'), tissue_null=('tissue_null','mean'), above_tissue=('above_tissue','mean')).reset_index()
    summary.to_csv(dest/'summary.csv', index=False, float_format='%.8g')
    paired = []
    for frac, df in metrics.groupby('fraction'):
        scores = df.pivot(index='drug', columns='model', values='precision').sort_index()
        draws = np.random.default_rng(2026).integers(len(scores), size=(10000, len(scores)))
        for ref in ['gdsc1','gdsc2','pan','tissue_null']:
            baseline = df.loc[df.model == 'consensus'].set_index('drug').loc[scores.index, 'tissue_null'] if ref == 'tissue_null' else scores[ref]
            delta = (scores.consensus - baseline).to_numpy()
            low, high = np.quantile(delta[draws].mean(axis=1), [.025,.975])
            paired.append(dict(fraction=frac, contrast='consensus - '+ref, delta=delta.mean(), low95=low, high95=high,
                               improved=int(sum(delta > 1e-10)), tied=int(sum(abs(delta) <= 1e-10)), drugs=len(delta)))
    contrasts = pd.DataFrame(paired)
    contrasts.to_csv(dest/'contrasts.csv', index=False, float_format='%.8g')
    print(summary[summary.fraction == 0.1].to_string(index=False))
    print(contrasts[contrasts.fraction == 0.1].to_string(index=False))
    qualified = frame[frame.drug.isin(metrics.drug)]
    print(f'Eligible drugs={qualified.drug.nunique()}, cell models={qualified.cell.nunique()}, pairs={len(qualified)}, tissue categories={qualified.tissue.nunique()}')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('matched', type=Path)
    p.add_argument('results', type=Path)
    p.add_argument('--target', choices=['prism', 'ctrp'], default='prism')
    args = p.parse_args()
    write_metrics(args.matched, args.results, args.target)
