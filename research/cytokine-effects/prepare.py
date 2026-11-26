"""Prepare compact licensed local inputs; do not redistribute the full expression data."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlretrieve
import pandas as pd

URL='https://allenimmunology.org/public/publication/download/fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/87ce4a04-98f1-43b3-aea3-1fdc95272fea/parse_cytokine_deg_uncensored.csv'
HASH='551647522083735def165aadde5911296243a689e1feacc32a670a84d43dd832'
LIGANDS={'IL-2','IL-4','IL-10','IL-12','IL-13','IFN-gamma','IFN-beta'}

def prepare(cache):
    cache.mkdir(parents=True,exist_ok=True);raw=cache/'parse-effects.csv';f=raw if raw.exists() else raw.with_suffix('.part')
    if not raw.exists():urlretrieve(URL,f)
    with f.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=HASH:raise ValueError('Allen uncensored effect table checksum mismatch')
    if f!=raw:f.replace(raw)
    cols=['fg','bg','cell_type','n_fg','n_bg','gene','log2FoldChange','lfcSE','baseMean','padj','stat'];chunks=[]
    for part in pd.read_csv(raw,usecols=cols,chunksize=200_000):
        d=part[part.fg.isin(LIGANDS)&part.bg.eq('PBS')];
        if len(d):chunks.append(d)
    d=pd.concat(chunks);assert not d.duplicated(['fg','cell_type','gene']).any();d.to_csv(cache/'selected-effects.csv.gz',index=False);print(d.groupby('fg').size())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);prepare(p.parse_args().cache)
