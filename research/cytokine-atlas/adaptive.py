"""Donor-only shrinkage with a locked evaluation against untouched target lists."""
import argparse
import hashlib
from itertools import combinations
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

SIBLING=Path(__file__).resolve().parents[1]/'transcript-transfer'
sys.path.insert(0,str(SIBLING))
from external import HASH, TYPES, URL
from run import fetch, load, pseudobulk, lfc_tensor


def evaluate(lfc, genes, types, mapping, target, ligand, sizes):
    lfc=np.asarray(lfc,dtype=float); genes=np.asarray(genes,dtype=str); types=list(types)
    assert lfc.ndim==3 and lfc.shape[1:]==(len(types),len(genes)) and len(types)>=2 and len(genes)>=100
    assert np.isfinite(lfc).all() and len(set(genes))==len(genes)
    # Give tied scores stable gene-symbol ordering.
    idx=np.argsort(genes);genes=genes[idx];lfc=lfc[:,:,idx]
    other=(lfc.sum(axis=1,keepdims=True)-lfc)/(len(types)-1);diff=lfc-other
    truth={}
    for t in types:
        for d in ['Up','Down']:
            truth[t,d]=np.mean([np.isin(genes,target.loc[(ligand,s,d),'pathway_genes'].split(';')) for s in mapping[t]],axis=0)
    rows=[]
    for k in sizes:
        for ids in combinations(range(len(diff)),k):
            sub=diff[list(ids)]; dm=sub.mean(axis=0); pooled=other[list(ids)].mean(axis=0)
            if k>1:
                signal=(dm*dm).sum(axis=1); noise=sub.var(axis=0,ddof=1).sum(axis=1)/k
                w=np.maximum(0,1-np.divide(noise,signal,out=np.ones_like(noise),where=signal>0))
            else:w=np.full(len(types),0.5)
            for method,weights in [('own',np.ones_like(w)),('other',np.zeros_like(w)),('half',np.full_like(w,0.5)),('adaptive',w)]:
                scores=pooled+weights[:,None]*dm
                if method=='own': scores=lfc[list(ids)].mean(axis=0)
                for i,t in enumerate(types):
                    for d,sign in [('Up',1),('Down',-1)]:
                        top=np.argsort(-sign*scores[i],kind='stable')[:100]; rows.append([ligand,k,'/'.join(map(str,ids)),t,d,method,weights[i],truth[t,d][top].mean()])
    return pd.DataFrame(rows,columns=['ligand','donors','subset','lineage','direction','model','weight','precision'])


def main(a):
    from urllib.request import urlretrieve
    f=a.cache/'parse_sets.csv'
    if not f.exists():urlretrieve(URL,f)
    if hashlib.sha256(f.read_bytes()).hexdigest()!=HASH:raise ValueError('unexpected target')
    target=pd.read_csv(f).set_index(['fg','cell_type','direction'])
    if a.tensor:
        with np.load(a.tensor,allow_pickle=False) as z:
            genes=z['symbols'];types=z['source_types'].tolist()
            mapping={t:[s] for t,s in zip(types,z['target_types'].tolist(),strict=True)}
            panels=list(zip(z['cytokines'].tolist(),z['lfc'],strict=True))
    else:
        fetch(a.cache);meta,g,mats=load(a.cache);types,donors,pb,keep,_=pseudobulk(meta,g,mats);lfc=lfc_tensor(types,donors,pb,keep);sym=g.loc[keep,'symbol'];valid=sym.notna() & ~sym.duplicated(keep=False);lfc=lfc[:,:,valid.to_numpy()];genes=sym[valid].to_numpy();mapping=TYPES;ligand='IFN-beta'
        panels=[(ligand,lfc)]
    a.out.mkdir(parents=True,exist_ok=True)
    for ligand,lfc in panels:
        sizes=sorted(set([1,2,len(lfc)]+([4] if len(lfc)>=4 else [])))
        d=evaluate(lfc,genes,types,mapping,target,ligand,sizes)
        detail=d.groupby(['ligand','donors','lineage','direction','model'])[['weight','precision']].mean()
        detail.to_csv(a.out/f'{ligand}_adaptive_by_type.csv')
        summary=detail.groupby(['ligand','donors','direction','model']).precision.mean().unstack()
        summary.to_csv(a.out/f'{ligand}_adaptive.csv');print(summary.to_string())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('out',type=Path);p.add_argument('--tensor',type=Path);main(p.parse_args())
