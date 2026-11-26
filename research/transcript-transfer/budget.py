"""Exploratory equal-cell-budget control for the external Parse signature test."""
from pathlib import Path
import argparse
import numpy as np
import pandas as pd
from external import TYPES, HASH, URL, fetch, load, pseudobulk, sha256, urlretrieve


def run(cache,out,per_donor):
    fetch(cache); source=cache/'parse_sets.csv'
    if not source.exists(): urlretrieve(URL,source)
    if sha256(source)!=HASH: raise ValueError('Signature file changed')
    ext=pd.read_csv(source).query("fg=='IFN-beta'").set_index(['cell_type','direction'])
    meta,genes,mats=load(cache); types,donors,_,keep,_=pseudobulk(meta,genes,mats)
    keep &= genes.symbol.notna() & ~genes.symbol.duplicated(keep=False); symbols=genes.loc[keep,'symbol'].to_numpy()
    bins={}; budgets={}; targets={}
    for cond,(matrix,bcs) in zip(('ctrl','stim'),mats):
        index={b:i for i,b in enumerate(bcs)}
        groups=meta[(meta.multiplets=='singlet') & (meta.stim==cond) & meta.cell.isin(types)].groupby(['cell','ind'])
        for (ct,d),g in groups:
            bins[ct,d,cond]=np.array([index[b[:-1] if cond=='stim' and b.endswith('-11') else b] for b in g.barcode])
    for ct in types:
        # Same number of cells per type/condition for every k; divisible by eight.
        budgets[ct]=min(128,8*(min(len(bins[ct,d,c]) for d in donors for c in ['ctrl','stim'])//8))
        for direction in ['Up','Down']:
            targets[ct,direction]=[set(ext.loc[(s,direction),'pathway_genes'].split(';')) for s in TYPES[ct]]
    print('Cells per condition, constant across donor counts:',budgets)
    rng=np.random.default_rng(2026); rows=[]
    for rep in range(64):
        perm=rng.permutation(donors)
        for k in [1,2,4,8]:
            normalized=[]
            for cond,(matrix,_) in zip(('ctrl','stim'),mats):
                log_cpm=[]
                for ct in types:
                    size=budgets[ct] if per_donor else budgets[ct]//k
                    cols=np.concatenate([rng.choice(bins[ct,d,cond],size,replace=False) for d in perm[:k]])
                    counts=np.asarray(matrix[:,cols].sum(axis=1)).ravel()
                    log_cpm.append(np.log2((counts[keep]+.5)/(counts.sum()+1)*1e6))
                normalized.append(np.stack(log_cpm))
            effects=normalized[1]-normalized[0]
            for i,ct in enumerate(types):
                for model,score in [('type',effects[i]),('pooled',np.delete(effects,i,axis=0).mean(axis=0))]:
                    for direction,sign in [('Up',1),('Down',-1)]:
                        hits=set(symbols[np.lexsort((symbols,-sign*score))[:100]])
                        precision=np.mean([len(hits&t)/100 for t in targets[ct,direction]])
                        rows.append((rep,k,ct,budgets[ct]*(k if per_donor else 1),direction,model,precision))
    scores=pd.DataFrame(rows,columns=['draw','donors','cell_type','cell_budget','direction','model','precision']);out.mkdir(parents=True,exist_ok=True)
    prefix='fixed_per_donor' if per_donor else 'fixed_cells'
    by_type=scores.groupby(['donors','cell_type','cell_budget','direction','model']).precision.mean();by_type.to_csv(out/f'{prefix}_by_type.csv')
    macro=by_type.groupby(['donors','direction','model']).mean().unstack('model');macro['type_minus_pooled']=macro.type-macro.pooled;macro.to_csv(out/f'{prefix}_macro.csv');print(macro.to_string())


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('out',type=Path);p.add_argument('--per-donor',action='store_true');a=p.parse_args();run(a.cache,a.out,a.per_donor)
