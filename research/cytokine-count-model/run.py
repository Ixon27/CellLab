"""Paired Wood raw-count comparator, scored on independent response lists."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd
from scipy.sparse import csc_matrix
from scipy.stats import rankdata

HERE = Path(__file__).resolve().parent
ATLAS = HERE.parent / 'cytokine-atlas'
sys.path.insert(0, str(ATLAS))
from human_targets import contrasts

TOP = 100
PANELS = ('shared_cpm', 'shared_filter_by_expr')
MODES = ('edgeR_rank', 'limma_rank', 'limma_prefit')
METHODS = ('own', 'other', 'half')
DIRECTIONS = (('Up', 1, '_DN'), ('Down', -1, '_UP'))
LIGANDS = ('IL-2', 'IL-4')
DONORS = tuple(range(640, 646))
TYPES = {'mono': 'CD14 monocyte', 'B_n': 'Naive B cell',
         'CD4_Tn': 'Naive CD4 T cell', 'NK': 'CD56dim NK cell'}
DEPTH_HASHES = {
    'depth_genes.txt': '2972a4dc8bb3f198d89d51e4077c18eb3b81bd7d850b303a262df42a9fdf9eb5',
    'depth_meta.tsv': 'a2247ac7f4bbc36e89023352e9944ff2532ada1ca2356e3842a371ad978518f2',
    'depth_p.i32': '4a8c281ccf069da7ba3576eba4af5915751fb4d74fc655779f669ccdc4ee1ab8',
    'depth_i.i32': '66604c94e537a0dca713bf32f7a32f264173bf951f11341392ab69ed4fa40f44',
    'depth_x.i32': 'f565e39c169c4ed52ec046354bcff58e96c27d950d26b9df7ce31214f6cadf2c',
}
PARSE_HASH = '4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd'
GMT_HASH = 'b5a725afbc14a98b4ccfc1821fdcb76e4bc7fa44ffbebd4570c0aa7b0998c060'


def input_hash(path, expected=None):
    with path.open('rb') as f:
        actual = hashlib.file_digest(f, 'sha256').hexdigest()
    if expected is not None and actual != expected:
        raise ValueError(f'SHA-256 mismatch for {path}: {actual}')
    return (path.name, actual)


def raw_pseudobulk(wood):
    genes = np.array((wood / 'depth_genes.txt').read_text().splitlines())
    if len(set(genes)) != len(genes) or np.any(genes == ''):
        raise ValueError('Expected unique nonempty Wood RNA features')
    meta = pd.read_csv(wood / 'depth_meta.tsv', sep='\t')
    arrays = tuple(np.fromfile(wood / f'depth_{k}.i32', dtype='<i4') for k in ('x', 'i', 'p'))
    matrix = csc_matrix(arrays, shape=(len(genes), len(meta)))
    groups = meta.groupby(['donor', 'stim', 'minor_label_short']).indices
    sums, cells = [], []
    for lineage in TYPES:
        counts, sizes = [], []
        for arm in ('Baseline', 'IL2', 'IL4'):
            selected = [groups[d, arm, lineage] for d in DONORS]
            counts.append([matrix[:, cols].sum(axis=1).A1 for cols in selected])
            sizes.append([len(cols) for cols in selected])
        sums.append(counts)
        cells.append(sizes)
    cells = np.array(cells)
    counts = np.array(sums)
    if cells.min() < 10 or counts.min() < 0 or counts.max() > np.iinfo(np.int32).max:
        raise ValueError('Invalid Wood pseudobulk counts or cell coverage')
    with np.load(wood / 'wood_donor_lfc.npz', allow_pickle=False) as atlas:
        for key, expected in [('symbols', genes), ('source_types', list(TYPES)),
                              ('target_types', list(TYPES.values())), ('cytokines', LIGANDS),
                              ('donors', DONORS)]:
            np.testing.assert_array_equal(atlas[key], expected)
        for i in range(len(LIGANDS)):
            paired = counts[:, [0, i+1]]
            logged = np.log2((paired + 0.5) / (paired.sum(axis=-1, keepdims=True) + 1) * 1e6)
            np.testing.assert_allclose((logged[:, 1] - logged[:, 0]).transpose(1, 0, 2),
                                       atlas['lfc'][i], atol=1e-10, rtol=0)
            np.testing.assert_array_equal(cells[:, [0, i+1]].transpose(2, 0, 1), atlas['cells'][i])
    return genes, counts, cells


def fit_rankings(scratch, counts, genes):
    raw = scratch / 'counts.bin'
    counts.astype('<i4').tofile(raw)
    prefix = scratch / 'fit'
    subprocess.run(['Rscript', HERE / 'fit.R', raw, str(len(genes)), str(len(DONORS)),
                    str(len(TYPES)), prefix], check=True)
    for panel in PANELS:
        ix = np.fromfile(f'{prefix}-{panel}-indices.bin', dtype='<i4') - 1
        scores = np.fromfile(f'{prefix}-{panel}.bin', dtype='<f8').reshape(4, len(TYPES), len(ix))
        if len(ix) < TOP or not np.isfinite(scores).all():
            raise ValueError(f'Invalid fit output for {panel}')
        yield panel, genes[ix], scores


def ranking_modes(scores, direction):
    edge, own_limma, other_limma, half_limma = direction * scores
    for label, stat in [('edgeR_rank', edge), ('limma_rank', own_limma)]:
        own = stat.shape[1] - rankdata(-stat, axis=1, method='average')
        other = own.sum(axis=0) - own
        # Constant rescaling preserves ranks and avoids rounding exact cutoff ties.
        yield label, zip(METHODS, (stat, other, (len(own) - 1) * own + other), strict=True)
    yield 'limma_prefit', zip(METHODS, (own_limma, other_limma, half_limma), strict=True)


def target_lists(parse, archive, new_target):
    pg = pd.read_csv(parse).set_index(['fg', 'cell_type', 'direction'])['pathway_genes']
    with archive.open() as f:
        gmt = {r[0]: set(r[2:]) for r in (line.rstrip('\n').split('\t') for line in f)}
    result = {}
    for ligand in LIGANDS:
        for lineage, parse_name in TYPES.items():
            for direction, _, suffix in DIRECTIONS:
                key = (ligand, lineage, direction)
                result[key] = [('Parse', 'Parse', parse_name,
                                set(pg.loc[ligand, parse_name, direction].split(';')))]
                for name, contrast_ligand, cell in contrasts():
                    if ligand == contrast_ligand and lineage == {'NK_cell': 'NK', 'T_cell_CD4': 'CD4_Tn'}[cell]:
                        result[key].append(('archive', name.split('_')[0], name, gmt[name + suffix]))
    if new_target is not None:
        with np.load(new_target, allow_pickle=False) as data:
            symbols = data['symbols'].astype(str)
            score = data['yuan24']
        if score.shape != symbols.shape or symbols.ndim != 1 or len(set(symbols)) != len(symbols):
            raise ValueError('Expected one independent Yuan score per unique target symbol')
        for direction, sign, _ in DIRECTIONS:
            pos = (sign * score > 0) & np.isfinite(score)
            names = symbols[pos]
            order = np.lexsort((names, -sign * score[pos]))[:500]
            result['IL-4', 'mono', direction].append(('new_target', 'Yuan', 'IL4_24h_CD14', set(names[order])))
    return result


def summarize(results, by):
    columns = [*by, 'ranking']
    out = results.pivot_table(index=columns, columns='mix', values='precision', aggfunc='mean')
    out = out[['own', 'other', 'half']]
    out['half_minus_own'] = out['half'] - out['own']
    return out.reset_index()


def verify_legacy(parse, archive):
    for result, name, key in [(parse, 'moderated.csv', 'ligand'),
                              (archive, 'moderated_double_holdout.csv', 'study')]:
        old = pd.read_csv(ATLAS / 'results' / name).query('rank == "moderated_t"').set_index(key)
        current = result.query('panel == "shared_cpm" and ranking == "limma_prefit"').set_index(key)
        np.testing.assert_allclose(current.loc[old.index, list(METHODS)], old[list(METHODS)],
                                   rtol=0, atol=1e-12)


def run(wood, references, out, new_target):
    parse = references / 'parse_sets.csv'
    archive = references / 'immune.gmt'
    hashes = [input_hash(wood / k, v) for k, v in DEPTH_HASHES.items()]
    hashes.extend([input_hash(wood / 'wood_donor_lfc.npz'), input_hash(parse, PARSE_HASH),
                   input_hash(archive, GMT_HASH)])
    if new_target is not None:
        hashes.append(input_hash(new_target))
    genes, counts, cells = raw_pseudobulk(wood)
    rows = []
    with TemporaryDirectory() as temp:
        scratch = Path(temp)
        rankings = [(ligand, panel, universe, scores)
                    for i, ligand in enumerate(LIGANDS)
                    for panel, universe, scores in fit_rankings(scratch, counts[:, [0, i + 1]], genes)]
        versions = (scratch / 'fit-versions.txt').read_text()
    # Targets are opened only after assembling and fitting both source panels.
    targets = target_lists(parse, archive, new_target)
    for ligand, panel, universe, scores in rankings:
        for direction, sign, _ in DIRECTIONS:
            truth = {lineage: [(kind, study, contrast, len(names), np.isin(universe, sorted(names)))
                               for kind, study, contrast, names in targets[ligand, lineage, direction]]
                     for lineage in TYPES}
            for ranking, mixes in ranking_modes(scores, sign):
                for mix, values in mixes:
                    for lineage, vec in zip(TYPES, values, strict=True):
                        top = np.lexsort((universe, -vec))[:TOP]
                        for kind, study, contrast, size, eligible in truth[lineage]:
                            rows.append((kind, study, contrast, panel, ligand, lineage, direction,
                                         ranking, mix, len(universe), size, int(eligible.sum()), TOP,
                                         int(eligible[top].sum()), eligible[top].mean(), eligible.mean()))
    detail = pd.DataFrame(rows, columns=['target', 'study', 'contrast', 'panel', 'ligand', 'lineage',
                                         'direction', 'ranking', 'mix', 'eligible_genes', 'target_genes',
                                         'eligible_target_genes', 'budget', 'hits', 'precision', 'uniform_precision'])
    parse_summary = summarize(detail.query('target == "Parse"'), ['panel', 'ligand'])
    archive_summary = summarize(detail.query('target == "archive"'), ['panel', 'study'])
    verify_legacy(parse_summary, archive_summary)
    out.mkdir(parents=True, exist_ok=True)
    detail.to_csv(out / 'tasks.csv', index=False)
    parse_summary.to_csv(out / 'parse.csv', index=False)
    archive_summary.to_csv(out / 'archive_by_study.csv', index=False)
    archive_summary.groupby(['panel', 'ranking'], as_index=False)[
        ['own', 'other', 'half', 'half_minus_own']].mean().to_csv(out / 'archive_macro.csv', index=False)
    if new_target is not None:
        summarize(detail.query('target == "new_target"'), ['panel', 'study']).to_csv(out / 'new_target.csv', index=False)
    sizes = [(t, arm, len(DONORS), sizes.sum(), sizes.min(), sizes.max())
             for t, by_arm in zip(TYPES, cells, strict=True)
             for arm, sizes in zip(('Baseline', *LIGANDS), by_arm, strict=True)]
    pd.DataFrame(sizes, columns=['lineage', 'arm', 'pseudobulks', 'cells', 'min_cells', 'max_cells']).to_csv(
        out / 'source_sizes.csv', index=False)
    pd.DataFrame(hashes, columns=['input', 'sha256']).to_csv(out / 'inputs.csv', index=False)
    print(versions.rstrip(), f'\nPython {sys.version.split()[0]} / numpy {np.__version__} / pandas {pd.__version__}',
          f'\nscored {len(detail)} method × task rows; atlas limma precision reproduced')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wood', type=Path)
    parser.add_argument('references', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('--new-target', type=Path, help='local NPZ with symbols and independent Yuan 24 h scores')
    args = parser.parse_args()
    run(args.wood, args.references, args.out, args.new_target)
