"""Compare purified human cytokine responses against fixed Parse/Allen gene sets."""

import argparse
import csv
import gzip
import hashlib
from pathlib import Path
from urllib.request import urlretrieve
from zipfile import ZipFile

import numpy as np
import pandas as pd

TOP = 100
ARRAY_CYTOKINE = 'IFN-gamma'
ARRAY_TYPES = {
    'B Cell': ('Naive B cell', 'Memory B cell'),
    'CD4 Cell': ('Naive CD4 T cell', 'Memory CD4 T cell'),
    'CD8 Cell': ('Naive CD8 T cell', 'Memory CD8 T cell'),
    'NK Cell': ('CD56dim NK cell', 'CD56bright NK cell'),
    'Monocyte': ('CD14 monocyte', 'CD16 monocyte'),
}
# Match Parse at 24 h where both arms are deposited; 12 h is the latest full panel.
ARRAY_PANELS = {'24 h': {k: v for k, v in ARRAY_TYPES.items() if k != 'CD8 Cell'},
                '12 h': ARRAY_TYPES}
BULK_FILE = 'bulk_RNAseq-20260511T152800Z-3-001.zip'
BULK_BASE = 'bulk_RNAseq/NCOMMS-19-7936188_bulk_RNAseq_'
BULK_TIME = '16h'  # Closest measured point to the 24 h Parse endpoint.
BULK_CYTOKINES = {'Th1': 'IL-12', 'Th2': 'IL-4'}
BULK_TYPES = {'CD4_Naive': ('Naive CD4 T cell',), 'CD4_Memory': ('Memory CD4 T cell',)}
HGNC_FILE = 'hgnc_complete_set_2026-08-07.txt'
INPUTS = {
    'parse_sets.csv': (
        'https://allenimmunology.org/public/publication/download/fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/e7992b0c-e248-4f57-b16f-62784c48f15d/parse_cytokine_gsea_gene_sets.csv',
        '4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd',
    ),
    'GSE17762_series_matrix.txt.gz': (
        'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE17nnn/GSE17762/matrix/GSE17762_series_matrix.txt.gz',
        '49b74f1ba519d9b12c66107b532ddb0f4b58a84648340be5b55de10bf5effd71',
    ),
    'GPL8601.soft': (
        'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GPL8601&targ=self&form=text&view=full',
        '634b347c08f42b4e88ef1c36eaa26bcfeff9a4ffc6ebdcc58ae36e0a9219b1ba',
    ),
    BULK_FILE: (
        f'https://www.ebi.ac.uk/biostudies/files/S-BSST2978/{BULK_FILE}',
        'ab5240e3224ff4184c3b8bc8c2c7f8e123db64b4bfe9f6d4ef7131f2fbc4720e',
    ),
    HGNC_FILE: (
        f'https://storage.googleapis.com/public-download-files/hgnc/archive/archive/monthly/tsv/{HGNC_FILE}',
        'faaeb6ae1e2a596be658b5f23ee44937c9c5379fa37d1f5ace54b94b16962b1c',
    ),
}


def cached(cache, name):
    url, expected = INPUTS[name]
    path = cache / name
    if not path.exists():
        partial = path.with_suffix(path.suffix + '.part')
        urlretrieve(url, partial)
        check_hash(partial, expected)
        partial.replace(path)
    else:
        check_hash(path, expected)
    return path


def check_hash(path, expected):
    with path.open('rb') as data:
        actual = hashlib.file_digest(data, 'sha256').hexdigest()
    if actual != expected:
        raise ValueError(f'{path.name}: sha256 {actual} does not match {expected}')


def open_table(handle, marker):
    for line in handle:
        if line.strip() == marker:
            return
    raise ValueError(f'Missing table marker {marker}')


def array_responses(matrix, platform, hgnc):
    with gzip.open(matrix, 'rt') as handle:
        metadata = {}
        for row in csv.reader(handle, delimiter='\t'):
            if row and row[0] == '!series_matrix_table_begin':
                break
            if row and row[0].startswith('!Sample_'):
                metadata.setdefault(row[0], []).append(row[1:])
        else:
            raise ValueError('GEO matrix table not found')
        ids, = metadata['!Sample_geo_accession']
        time, treatment, cell_type = metadata['!Sample_characteristics_ch2']
        selected = {}
        layout = []
        for hour, mapping in ARRAY_PANELS.items():
            for source in mapping:
                for arm in ('0.6 pM IFNg', 'Mock'):
                    samples = [
                        acc for acc, t, a, c in zip(ids, time, treatment, cell_type, strict=True)
                        if (t, a, c) == (f'measurement: time(absolute) {hour}',
                                         f'compound based treatment: {arm}', f'cell type: {source}')
                    ]
                    if len(samples) != 1:
                        raise ValueError(f'Expected one array for {hour} {source} {arm}: {samples}')
                    selected[hour, source, arm] = samples[0]
                    layout.append(('Waddell', hour, source, arm, samples[0], ''))
        # Values are log2(sample/reference), so subtracting the matched mock cancels the reference.
        values = pd.read_csv(handle, sep='\t', comment='!', usecols=['ID_REF', *selected.values()],
                             index_col='ID_REF', dtype={'ID_REF': str})
    with platform.open() as handle:
        open_table(handle, '!platform_table_begin')
        probe_ids = pd.read_csv(handle, sep='\t', comment='!', usecols=['ID', 'GeneId'], dtype=str)
    entrez = unique_symbol_map(hgnc, 'entrez_id')
    probe_symbols = probe_ids.set_index('ID')['GeneId'].map(entrez)
    responses = {}
    for hour, mapping in ARRAY_PANELS.items():
        contrasts = pd.DataFrame({source: values[selected[hour, source, '0.6 pM IFNg']]
                                         - values[selected[hour, source, 'Mock']] for source in mapping})
        contrasts['symbol'] = probe_symbols
        # A source-only common universe permits all cell-type scores on the same genes.
        responses[hour] = contrasts.dropna().groupby('symbol', sort=True).median()
    return responses, layout


def bulk_responses(path, hgnc):
    with ZipFile(path) as archive:
        with archive.open(BULK_BASE + 'metadata.txt') as handle:
            meta = pd.read_csv(handle, sep='\t', index_col=0, dtype={'donor_id': str})
        with archive.open(BULK_BASE + 'raw_counts.txt') as handle:
            counts = pd.read_csv(handle, sep='\t', index_col=0)
    meta = meta[meta['stimulation_time'].eq(BULK_TIME)]
    meta = meta[meta['cytokine_condition'].isin(['Th0', *BULK_CYTOKINES])]
    cpms = counts[meta['sample_id']].div(counts[meta['sample_id']].sum()) * 1e6
    pairs = {}
    layout = []
    for source, labels in meta.groupby('cell_type', sort=True):
        for (donor, arm), libraries in labels.groupby(['donor_id', 'cytokine_condition'], sort=True):
            samples = libraries['sample_id'].tolist()
            pairs[source, donor, arm] = np.log2(cpms[samples] + 1).mean(axis=1)
            layout.extend(('Cano-Gamez', BULK_TIME, source, arm, sample, donor) for sample in samples)
    responses = {}
    for arm in BULK_CYTOKINES:
        contrasts = {}
        use = np.ones(len(counts), dtype=bool)
        for source in BULK_TYPES:
            labels = meta[meta['cell_type'].eq(source) & meta['cytokine_condition'].isin([arm, 'Th0'])]
            use &= cpms[labels['sample_id']].ge(1).sum(axis=1).ge(3)
            donors = sorted(labels['donor_id'].unique())
            if len(donors) != 3:
                raise ValueError(f'Expected three donors for {source}, got {donors}')
            contrasts[source] = pd.concat([pairs[source, d, arm] - pairs[source, d, 'Th0']
                                           for d in donors], axis=1).mean(axis=1)
        genes = pd.DataFrame(contrasts).loc[use]
        genes.index = genes.index.map(unique_symbol_map(hgnc, 'ensembl_gene_id'))
        responses[arm] = genes[genes.index.notna()].groupby(level=0, sort=True).median()
    return responses, layout


def unique_symbol_map(hgnc, key):
    approved = hgnc[hgnc['status'].eq('Approved')].dropna(subset=[key])
    return approved.loc[~approved[key].duplicated(keep=False)].set_index(key)['symbol']


def evaluate(study, source_contrast, cytokine, time, response, mapping, parse):
    symbols = response.index.to_numpy()
    universe = set(symbols)
    if len(universe) < TOP or not np.isfinite(response.to_numpy()).all():
        raise ValueError('Need a finite common gene universe of at least TOP genes')
    for source, targets in mapping.items():
        scores = response[source].to_numpy()
        other = response.drop(columns=source).mean(axis=1).to_numpy()
        models = {'type': scores, 'other_type_mean': other, 'half_pool': (scores + other) / 2,
                  'all_type_mean': response.mean(axis=1).to_numpy()}
        for direction, sign in [('Up', 1), ('Down', -1)]:
            shortlists = {name: set(symbols[np.lexsort((symbols, -sign * vals))[:TOP]])
                          for name, vals in models.items()}
            for target in targets:
                target_list = set(parse.loc[(cytokine, target, direction)].split(';'))
                detectable = target_list & universe
                for name, shortlist in shortlists.items():
                    yield (study, source_contrast, cytokine, time, source, target, direction, name,
                           len(universe), len(target_list), len(detectable), len(shortlist & detectable),
                           len(shortlist & detectable) / TOP, len(detectable) / len(universe))


def main(cache, out):
    cache.mkdir(parents=True, exist_ok=True)
    parse = pd.read_csv(cached(cache, 'parse_sets.csv')).set_index(['fg', 'cell_type', 'direction'])
    hgnc = pd.read_csv(cached(cache, HGNC_FILE), sep='\t', dtype=str,
                       usecols=['status', 'symbol', 'entrez_id', 'ensembl_gene_id'])
    array, sample_rows = array_responses(cached(cache, 'GSE17762_series_matrix.txt.gz'),
                                         cached(cache, 'GPL8601.soft'), hgnc)
    rows = []
    for hour, mapping in ARRAY_PANELS.items():
        rows.extend(evaluate('Waddell', 'IFN-gamma vs mock', ARRAY_CYTOKINE, hour,
                             array[hour], mapping, parse['pathway_genes']))
    bulk, bulk_samples = bulk_responses(cached(cache, BULK_FILE), hgnc)
    sample_rows.extend(bulk_samples)
    for arm, cytokine in BULK_CYTOKINES.items():
        rows.extend(evaluate('Cano-Gamez', f'{arm} cocktail vs Th0', cytokine, BULK_TIME,
                             bulk[arm], BULK_TYPES, parse['pathway_genes']))
    group = ['source_study', 'source_contrast', 'parse_cytokine', 'source_time']
    detail = pd.DataFrame(rows, columns=[*group, 'source_type', 'parse_subtype', 'direction', 'model',
                                        'source_genes', 'target_genes', 'detectable_target_genes',
                                        'hits_at_100', 'precision_at_100', 'random_expected_precision'])
    comparisons = ['precision_at_100', 'random_expected_precision']
    by_type = detail.groupby([*group, 'source_type', 'direction', 'model'])[comparisons].mean()
    macro = by_type.groupby([*group, 'direction', 'model']).mean().reset_index()
    out.mkdir(parents=True, exist_ok=True)
    detail.to_csv(out / 'by_subtype.csv', index=False, float_format='%.8f')
    macro.to_csv(out / 'macro.csv', index=False, float_format='%.8f')
    pd.DataFrame(sample_rows, columns=['source_study', 'source_time', 'source_type', 'arm',
                                       'sample_id', 'donor_id']).to_csv(out / 'source_samples.csv', index=False)
    print(macro.to_string(index=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    main(args.cache, args.out)
