"""Score follow-up visits, never the first reference used for calibration."""
import argparse
import csv
from collections import defaultdict
from pathlib import Path

import numpy as np


MODELS = ('clock', 'texture', 'cnn')


def score_wells(rows):
    wells = defaultdict(list)
    for row in rows:
        if row['split'] != 'train':
            wells[row['split'], row['line'], row['well']].append(row)
    for (split, line, well), visits in sorted(wells.items()):
        visits.sort(key=lambda r: float(r['hours']))
        hours = np.array([float(r['hours']) for r in visits])
        if hours.size < 2 or hours[0] != 0 or np.any(np.diff(hours) <= 0):
            raise ValueError(f'Invalid longitudinal reference: {line}/{well}')
        y = np.array([float(r['count']) for r in visits])
        methods = {'first_count': np.full_like(y, y[0])}
        for model in MODELS:
            p = np.array([float(r[model]) for r in visits])
            methods[model] = p
            # Predict change since the first image, anchored to its measured count.
            methods[f'{model}_anchored'] = np.maximum(0, y[0] + (p - p[0]))
            if model == 'clock':
                if p[0] <= 0:
                    raise ValueError('Relative growth requires a positive initial clock prediction')
                methods['clock_relative'] = y[0] * p / p[0]
        for method, pred in methods.items():
            error = pred[1:] - y[1:]
            if not np.isfinite(error).all():
                raise ValueError(f'Nonfinite error: {line}/{well}/{method}')
            yield dict(split=split, line=line, well=well, n_followup=len(error), method=method,
                       mae=float(np.abs(error).mean()), bias=float(error.mean()))


def save(path, rows):
    with path.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def evaluate(cache):
    with (cache / 'predictions.csv').open(newline='') as f:
        wells = list(score_wells(csv.DictReader(f)))
    save(cache / 'well_scores.csv', wells)
    summary, contrasts = [], []
    for split in ('within', 'transfer'):
        groups = defaultdict(list)
        for row in wells:
            if row['split'] == split:
                groups[row['method']].append(row)
        for method, group in groups.items():
            summary.append(dict(split=split, method=method, wells=len(group),
                                followup_images=sum(r['n_followup'] for r in group),
                                mae=np.mean([r['mae'] for r in group]),
                                bias=np.mean([r['bias'] for r in group])))
        # Only the transfer endpoint has replicates across enough wells to show
        # a descriptive interval. This is not uncertainty over sites or cell lines.
        if split == 'transfer':
            cnn = {r['well']: r['mae'] for r in groups['cnn_anchored']}
            ids = sorted(cnn)
            draws = np.random.default_rng(2026).integers(len(ids), size=(10000, len(ids)))
            # The raw CNN contrast is an exploratory estimate of calibration benefit.
            for baseline in ('clock_anchored', 'clock_relative', 'texture_anchored', 'first_count', 'cnn'):
                ref = {r['well']: r['mae'] for r in groups[baseline]}
                delta = np.array([cnn[k] - ref[k] for k in ids])
                low, high = np.quantile(delta[draws].mean(axis=1), [0.025, 0.975])
                contrasts.append(dict(split=split, contrast='cnn_anchored - ' + baseline,
                                      mae_difference=delta.mean(), low95=low, high95=high))
    save(cache / 'summary.csv', summary)
    save(cache / 'contrasts.csv', contrasts)
    for path in ('summary.csv', 'contrasts.csv'):
        print((cache / path).read_text(), end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    evaluate(parser.parse_args().cache)
