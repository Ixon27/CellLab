"""Functional and lineage-centered concordance with a fixed public gene-set collection."""
import argparse
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata
from evaluate import source, models, centered, rho

HASH='f22066af72e215ccb7b89d88e492c07e1eef17534c2ca7b0f9902cfecbbdd8e9'

def pathway(s,sets):
    ranks=(rankdata(s,axis=1)-.5)/s.shape[1]-.5
    return np.stack([ranks[:,mask].mean(axis=1) for mask in sets],axis=1)


def run(wood,ref,gmt,out):
    assert hashlib.sha256(gmt.read_bytes()).hexdigest()==HASH
    with gmt.open() as f:lists={r[0]:set(r[2:]) for r in (line.rstrip().split('\t') for line in f)}
    data,types=source(wood);df=pd.read_csv(ref);panels={l:d.pivot(index='gene',columns='cell_type',values='log2FoldChange').reindex(columns=types) for l,d in df.groupby('fg')};rows=[];detail=[]
    for l,(genes,x) in data.items():
        ys={tl:panels[tl].reindex(genes).to_numpy().T for tl in data};keep=np.logical_and.reduce([np.isfinite(y).all(axis=0) for y in ys.values()]); masks={name:np.flatnonzero(np.isin(genes[keep],list(names))) for name,names in lists.items()};masks={k:v for k,v in masks.items() if len(v)>=15};scores,_=models(x)
        for name,s in scores.items():
            est=pathway(s[:,keep],masks.values());
            for tl,y in ys.items():
                truth=pathway(y[:,keep],masks.values());rows.append([l,tl,name,len(masks),rho(est,truth),rho(centered(est),centered(truth))]);
                if name=='own' and tl==l:
                    for j,(p,mask) in enumerate(masks.items()):
                        for i,t in enumerate(types):detail.append([l,t,p,len(mask),est[i,j],truth[i,j]])
    out.mkdir(parents=True,exist_ok=True);d=pd.DataFrame(rows,columns=['source','target','model','pathways','rho','centered_rho']); d.to_csv(out/'hallmarks.csv',index=False);pd.DataFrame(detail,columns=['ligand','type','pathway','genes','source_rank_score','target_rank_score']).to_csv(out/'hallmark_detail.csv',index=False);print(d[d.model.isin(['own','half','cv_matrix'])].to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for arg in ['wood','ref','gmt','out']:p.add_argument(arg,type=Path)
    a=p.parse_args();run(a.wood,a.ref,a.gmt,a.out)
