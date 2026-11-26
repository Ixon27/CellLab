"""Match a fourth assay; restrict both external evaluations to identical candidates."""
import argparse
import hashlib
from pathlib import Path
import subprocess
from urllib.request import urlretrieve

import pandas as pd


URL = 'https://zenodo.org/records/7826870/files/PSet_CTRPv2.rds'
HASH = '95c74304c08912f69d5e35e2863c1fe248cd0cbd21ade282a5e4e45200ee442e'


def unique_map(df, source, key):
    pairs = df[[source, key]].dropna().drop_duplicates()
    pairs = pairs[(pairs[source] != '') & (pairs[key] != '')]
    return pairs[~pairs[source].duplicated(False) & ~pairs[key].duplicated(False)]


def run(cache):
    rds = cache / 'CTRPv2.rds'
    if not rds.exists():
        urlretrieve(URL, rds)
    with rds.open('rb') as f:
        if hashlib.file_digest(f, 'sha256').hexdigest() != HASH:
            raise ValueError('CTRP archive mismatch')
    table = cache / 'ctrp_export.csv'
    subprocess.run(['Rscript', '--vanilla', Path(__file__).with_name('extract_ctrp.R'), rds, table], check=True)
    curves = pd.read_csv(table, keep_default_na=False)
    cells = pd.read_csv(cache/'cell_crosswalk.csv', dtype=str, keep_default_na=False)
    drugs = pd.read_csv(cache/'drug_crosswalk.csv', dtype=str, keep_default_na=False)
    # CTRP's ccl_name is the published CCLE-style stripped name. Do not invent aliases.
    cells['key'] = cells.depmap_stripped_name.str.strip().str.upper()
    curves['key'] = curves.ccl_name.str.strip().str.upper()
    cell_map = unique_map(curves, 'cellid', 'key').merge(unique_map(cells,'cell','key'), on='key', validate='1:1')
    # BRD parent IDs (not chemical lot suffixes). Reject collisions on either side.
    pattern = r'^(BRD-[A-Z][0-9]{8})(?:-|$)'
    drugs['brd'] = drugs.prism_broad_id.str.extract(pattern, expand=False)
    curves['brd'] = curves.broad_id.str.extract(pattern, expand=False)
    drug_map = unique_map(curves, 'drugid', 'brd').merge(unique_map(drugs, 'drug', 'brd'), on='brd', validate='1:1')
    responses = curves.merge(cell_map[['cellid','cell']], on='cellid', validate='m:1').merge(drug_map[['drugid','drug']], on='drugid', validate='m:1')
    ctrp = responses.groupby(['cell','drug'],as_index=False).ctrp.median()
    matched = pd.read_csv(cache/'matched.csv',keep_default_na=False).merge(ctrp, on=['cell','drug'],validate='1:1')
    matched.to_csv(cache/'fourway.csv', index=False)
    print(f'CTRP: {len(curves)} finite curves; {len(cell_map)} one-to-one cell identities; {len(drug_map)} one-to-one compound identities; {len(responses)} matched curves before replicate medians; {len(matched)} four-way cell/drug pairs.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    run(p.parse_args().cache)
