"""Reanalyse public MAS5 matrices, with both chips for GSE22886 treated as one assay."""
import argparse
import csv
import gzip
import hashlib
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd
from catalogue import catalog, standardized_ranks, TYPES

HASHES = {
    'GPL570.annot.gz': 'd7cd44352127b1e34f3a720ebea86093ef255a38f1612a85a2962b71bde8f394',
    'GPL96.annot.gz': '88e0b22362bac779eb220b3b185c80faa6510a92b9358eaad159a561ab4351c4',
    'GPL97.annot.gz': '57f68da95e962424620581ba7d9615fce57452770726d49c4266a621ac8d07f5',
    'GSE12198_series_matrix.txt.gz': 'e37009c707effabade7c6a7e2998061a2774afdf5ecd9bba6987e7831a64b1ad',
    'GSE22886-GPL96_series_matrix.txt.gz': 'e6c36eb59f9daaf68a281fb215a7bacabe3d6e78259a4809aa1325617295f535',
    'GSE22886-GPL97_series_matrix.txt.gz': '658451b88866e25f0c5c55555a6d32bb876fabeaa9dc78091b06a09aca6cc563',
}


def fetch(cache, name):
    p = cache/name
    if not p.exists():
        acc = name.split('.')[0] if name.startswith('GPL') else name.split('-')[0].split('_')[0]
        group = 'platforms/GPLnnn' if name.startswith('GPL') else 'series/'+acc[:-3]+'nnn'
        folder = 'annot' if name.startswith('GPL') else 'matrix'
        urlretrieve(f'https://ftp.ncbi.nlm.nih.gov/geo/{group}/{acc}/{folder}/{name}',p)
    if hashlib.sha256(p.read_bytes()).hexdigest()!=HASHES[name]: raise ValueError(p)
    return p


def panel(cache, name, chip, arms):
    with gzip.open(fetch(cache,chip+'.annot.gz'),'rt') as f:
        for line in f:
            if line.startswith('ID\t'): break
        ann=pd.read_csv(f,sep='\t',names=line.strip().split('\t'),usecols=['ID','Gene symbol'],dtype=str,comment='!',index_col='ID')['Gene symbol'].dropna()
    ann=ann[ann.str.fullmatch(r'[\w.\-]+')]
    with gzip.open(fetch(cache,name),'rt') as f:
        for line in f:
            if line.startswith('!Sample_title\t'): titles=next(csv.reader([line],delimiter='\t'))[1:]
            if line.startswith('!Sample_geo_accession\t'): accessions=next(csv.reader([line],delimiter='\t'))[1:]
            if line.startswith('!series_matrix_table_begin'):break
        data=pd.read_csv(f,sep='\t',index_col=0,comment='!');assert list(data)==accessions
    selected={arm:[acc for title,acc in zip(titles,accessions,strict=True) if title.startswith(prefix)] for arm,prefix in arms.items()}; assert all(selected.values())
    # Both submitters specified MAS5 global scaling, not log2. Do not pair replicate suffixes.
    effects={arm:np.log2(data[ids].clip(lower=1)).mean(axis=1) for arm,ids in selected.items()}
    return pd.DataFrame({arm:v-effects['control'] for arm,v in effects.items() if arm!='control'}).groupby(ann).median(),selected


def run(cache,ref,out):
    cache.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
    candidates,full=catalog(ref);library=full.dropna().xs(TYPES[-1],axis=1,level=1).reindex(columns=candidates)
    rows=[];samples=[]
    experiments=[('GSE12198',[('GSE12198_series_matrix.txt.gz','GPL570')],{'control':'Primary human NK cell,','low':'NK cell stimulated by low dose IL2,','high':'NK cell stimulated by high dose IL2,'},{'low':'IL-2','high':'IL-2'}),('GSE22886',[(f'GSE22886-GPL{g}_series_matrix.txt.gz',f'GPL{g}') for g in [96,97]],{'control':'NKcell-control-','IL2':'NKcell-IL2stimulated-','IL15':'NKcell-IL15stimulated-'},{'IL2':'IL-2','IL15':'IL-15'})]
    for study,chips,arms,truth in experiments:
        tables=[]
        for filename,chip in chips:
            effects,ids=panel(cache,filename,chip,arms);tables.append(effects);samples.extend((study,chip,condition,acc) for condition,ls in ids.items() for acc in ls)
        measured=pd.concat(tables).groupby(level=0).mean().dropna();g=library.index.intersection(measured.index);ranked=standardized_ranks(library.loc[g].to_numpy().T)
        for arm,ligand in truth.items():
            scores=ranked@standardized_ranks(measured.loc[g,arm].to_numpy());rows.extend((study,arm,ligand,TYPES[-1],'own',c,len(g),v) for c,v in zip(candidates,scores,strict=True))
    d=pd.DataFrame(rows,columns='study time ligand type model candidate genes spearman'.split());d.to_csv(out/'nk_scores.csv',index=False);pd.DataFrame(samples,columns=['study','platform','arm','accession']).to_csv(out/'nk_samples.csv',index=False);print(d.sort_values('spearman',ascending=False).groupby(['study','time']).head(1).to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('ref',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.cache,a.ref,a.out)
