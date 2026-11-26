"""Plot every A549 well; breaks in the reference curve denote missing counts."""
import argparse
import csv
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def draw(cache):
    wells = defaultdict(list)
    with (cache / 'predictions.csv').open(newline='') as f:
        for r in csv.DictReader(f):
            if r['split'] == 'transfer':
                wells[r['well']].append(r)
    rows = sorted({w[0] for w in wells})
    cols = sorted({int(w[1:]) for w in wells})
    times = np.unique([float(r['hours']) for visits in wells.values() for r in visits])
    fig, axes = plt.subplots(len(rows), len(cols), figsize=(12, 6.6), sharex=True, sharey=True)
    for i, row in enumerate(rows):
        for j, col in enumerate(cols):
            ax = axes[i, j]
            well = f'{row}{col}'
            visits = sorted(wells[well], key=lambda r: float(r['hours']))
            indices = np.searchsorted(times, [float(r['hours']) for r in visits])
            start = float(visits[0]['count'])
            for key, label, color in [('count', 'Fluorescence reference', 'black'),
                                      ('cnn', 'CNN + first count', '#0072B2'),
                                      ('texture', 'Texture + first count', '#D55E00'),
                                      ('clock', 'Time + first count', '#009E73')]:
                series = np.full(times.size, np.nan)
                values = np.array([float(r[key]) for r in visits])
                series[indices] = values if key == 'count' else np.maximum(0, start + values - values[0])
                ax.plot(times, series, color=color, linewidth=1.3, label=label)
            ax.set_title(well, fontsize=10)
            ax.spines[['right', 'top']].set_visible(False)
    fig.supylabel('Nuclei per field')
    fig.supxlabel('Hours since first image')
    fig.legend(*axes[0, 0].get_legend_handles_labels(), loc='upper center', ncol=4, frameon=False)
    fig.tight_layout(rect=(0.015, 0.025, 1, 0.94))
    fig.savefig(cache / 'transfer-trajectories.png', dpi=170)
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    draw(parser.parse_args().cache)
