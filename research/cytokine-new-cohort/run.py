#!/usr/bin/env python3
"""Frozen donor-resolved GSE252736 target and source-only Wood/Allen rankings."""

import argparse
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csc_matrix
from scipy.stats import spearmanr

COUNTS = 'GSE252736_raw_counts.txt.gz'
COUNTS_SHA = 'def7f70bf982a6920bf23236a21963a59e00791503f02e10680cbbee3de0d4b7'
ALLEN_SHA = '551647522083735def165aadde5911296243a689e1feacc32a670a84d43dd832'
WOOD_SHA = '595f7ced0fdfdaf40b55f9b3fd517e575672895b32a20ab4f2541b8275178d01'
SOURCE_TYPES = ['mono', 'B_n', 'CD4_Tn', 'NK']
ALLEN_TYPES = ['CD14 monocyte', 'Naive B cell', 'Naive CD4 T cell', 'CD56dim NK cell']
DIRECTIONS = [('up', 1), ('down', -1)]
LIGANDS = ['IL-4', 'IL-2']
TOP, TARGET = 100, 500


def check(path, expected):
    with path.open('rb') as src:
        actual = hashlib.file_digest(src, 'sha256').hexdigest()
    if actual != expected:
        raise ValueError(f'Unexpected SHA-256 for {path}: {actual}')


def yuan_targets(cache):
    path = cache / COUNTS
    check(path, COUNTS_SHA)
    counts = pd.read_csv(path, sep='\t', dtype={'gene_name': str}, keep_default_na=False)
    unique = (counts.gene_name != '') & ~counts.gene_name.duplicated(keep=False)
    symbols = counts.loc[unique, 'gene_name'].to_numpy(dtype=str)
    targets = {}
    for hour, sexes in [(24, ('Male', 'Male', 'Female')), (6, ('Male', 'Male'))]:
        columns = [f'{sex}_000_Mphage_{condition}_{hour}h_rep{rep}'
                   for rep, sex in enumerate(sexes, 1) for condition in ('UTC', 'IL4')]
        matrix = counts[columns].to_numpy().T
        totals = matrix.sum(axis=1, keepdims=True)
        keep = ((matrix[:, unique] / totals * 1e6) >= 1).sum(axis=0) >= len(sexes)
        log = np.log2((matrix[:, unique][:, keep] + 0.5) / (totals + 1) * 1e6)
        paired = log[1::2] - log[::2]
        targets[hour] = (symbols[keep], paired)
    genes, paired = targets[24]
    np.savez_compressed(cache / 'targets.npz', symbols=genes, yuan24=paired.mean(axis=0))
    return targets


def models(by_type):
    own = by_type.iloc[:, 0]
    other = by_type.iloc[:, 1:].mean(axis=1)
    return pd.DataFrame({'own': own, 'other': other, 'half': (own + other) / 2})


def wood_ranks(cache):
    tensor = cache / 'wood_donor_lfc.npz'
    check(tensor, WOOD_SHA)
    with np.load(tensor, allow_pickle=False) as data:
        lfc, genes, types, donors, ligands = (data[k] for k in
            ('lfc', 'symbols', 'source_types', 'donors', 'cytokines'))
    np.testing.assert_array_equal(types, SOURCE_TYPES)
    raw_symbols = pd.Index((cache / 'depth_genes.txt').read_text().splitlines())
    index = raw_symbols.get_indexer(genes)
    if (index < 0).any():
        raise ValueError('Missing Wood symbols in depth counts')
    meta = pd.read_csv(cache / 'depth_meta.tsv', sep='\t')
    groups = meta.groupby(['donor', 'stim', 'minor_label_short']).indices
    sparse = csc_matrix(tuple(np.fromfile(cache / f'depth_{col}.i32', dtype='<i4')
                              for col in ('x', 'i', 'p')), shape=(len(raw_symbols), len(meta)))
    result = {}
    for number, ligand in enumerate(ligands):
        summed = np.stack([np.asarray(sparse[:, groups[donor, arm, kind]].sum(axis=1)).ravel()
                           for arm in ['Baseline', ligand.replace('-', '')]
                           for donor in donors for kind in types])
        totals = summed.sum(axis=1, keepdims=True)
        counts = summed[:, index]
        log = np.log2((counts + 0.5) / (totals + 1) * 1e6).reshape(2, *lfc[number].shape)
        np.testing.assert_allclose(log[1] - log[0], lfc[number], atol=1e-10)
        keep = (counts / totals * 1e6 >= 1).sum(axis=0) >= 6
        effects = pd.DataFrame(lfc[number].mean(axis=0)[:, keep].T, index=genes[keep], columns=types)
        result[ligand] = models(effects)
    return result


def allen_ranks(path):
    check(path, ALLEN_SHA)
    pieces = []
    columns = ['cell_type', 'fg', 'bg', 'gene', 'log2FoldChange', 'mode']
    for batch in pd.read_csv(path, usecols=columns, dtype={'gene': str}, chunksize=200_000):
        keep = (batch.cell_type.isin(ALLEN_TYPES) & batch.fg.isin(LIGANDS)
                & (batch.bg == 'PBS') & (batch['mode'] == 'Pseudobulk')
                & batch.gene.notna() & np.isfinite(batch.log2FoldChange))
        pieces.append(batch.loc[keep, ['cell_type', 'fg', 'gene', 'log2FoldChange']])
    all_effects = pd.concat(pieces, ignore_index=True)
    result = {}
    for ligand in LIGANDS:
        effects = (all_effects.loc[all_effects.fg == ligand]
                   .pivot(index='gene', columns='cell_type', values='log2FoldChange'))
        if not set(ALLEN_TYPES) <= set(effects.columns):
            raise ValueError(f'Missing Allen gene effects for a prespecified lineage: {ligand}')
        result[ligand] = models(effects[ALLEN_TYPES].dropna())
    return result


def shortlist(effect, sign, n):
    values = sign * effect.to_numpy()
    symbols = effect.index.to_numpy(dtype=str)
    eligible = np.flatnonzero(values > 0)
    ordering = np.lexsort((symbols[eligible], -values[eligible]))
    return symbols[eligible[ordering[:n]]]


def average_precision(score, positive):
    order = np.argsort(-score, kind='stable')
    bins = np.r_[np.flatnonzero(np.diff(score[order])), len(order) - 1]
    cumulative = np.cumsum(positive[order])[bins]
    return np.dot(np.diff(cumulative, prepend=0), cumulative / (bins + 1)) / cumulative[-1]


def compare(source, target):
    aligned = target.reindex(source.index).dropna()
    shared = source.loc[aligned.index]
    rank = []
    for direction, sign in DIRECTIONS:
        truth = shortlist(aligned, sign, TARGET)
        whole_truth = shortlist(target, sign, TARGET)
        positive = aligned.index.isin(truth)
        if len(truth) != TARGET or len(whole_truth) != TARGET:
            raise ValueError(f'{direction}: cannot fill 500 target slots for this contrast')
        for method in source.columns:
            score = shared[method]
            top = shortlist(score, sign, TOP)
            whole_top = shortlist(source[method], sign, TOP)
            if len(top) != TOP or len(whole_top) != TOP:
                raise ValueError(f'{direction}: cannot fill 100 source slots for {method}')
            values = sign * aligned.loc[top]
            rank.append({'direction': direction, 'method': method, 'shared_genes': len(shared),
                         'source_genes': len(source), 'target_genes': len(target),
                         'shared_p100': np.isin(top, truth).mean(),
                         'shared_average_precision': average_precision(sign * score.to_numpy(), positive),
                         'shared_random_prevalence': positive.mean(),
                         'shared_sign100': (values > 0).mean(),
                         'shared_signed_mean_lfc100': values.mean(),
                         'whole_p100': np.isin(whole_top, whole_truth).mean(),
                         'whole_source_top100_in_target': np.isin(whole_top, target.index).sum(),
                         'whole_target_top500_in_source': np.isin(whole_truth, source.index).sum()})
    global_rho = [{'method': method, 'shared_genes': len(shared),
                   'shared_spearman': spearmanr(shared[method], aligned).statistic}
                  for method in source.columns]
    return rank, global_rho


def score(targets, sources, out):
    ranked, global_rho = [], []
    for hour, (genes, paired) in targets.items():
        scenarios = [('all', paired.mean(axis=0))]
        if hour == 24:
            scenarios.extend((f'omit_rep{rep + 1}', np.delete(paired, rep, axis=0).mean(axis=0))
                             for rep in range(len(paired)))
        for scenario, values in scenarios:
            for design, by_ligand in sources.items():
                for ligand, source in by_ligand.items():
                    detail = {'source': design, 'source_ligand': ligand, 'target_hour': hour,
                              'target_replicates': len(paired) - (scenario != 'all'), 'scenario': scenario}
                    row, rho = compare(source, pd.Series(values, index=genes))
                    ranked.extend(detail | r for r in row)
                    global_rho.extend(detail | r for r in rho)
    out.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(ranked).to_csv(out / 'directional.csv', index=False, float_format='%.8f')
    pd.DataFrame(global_rho).to_csv(out / 'correlation.csv', index=False, float_format='%.8f')


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('target_cache', type=Path)
    cli.add_argument('--wood-cache', type=Path)
    cli.add_argument('--allen', type=Path)
    cli.add_argument('--out', type=Path)
    args = cli.parse_args()
    if any((args.wood_cache, args.allen, args.out)) and not all((args.wood_cache, args.allen, args.out)):
        cli.error('--wood-cache, --allen and --out must be supplied together')
    targets = yuan_targets(args.target_cache)
    if args.out is not None:
        score(targets, {'Wood': wood_ranks(args.wood_cache), 'Parse/Allen': allen_ranks(args.allen)}, args.out)


if __name__ == '__main__':
    main()
