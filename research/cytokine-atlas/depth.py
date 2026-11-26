"""Balanced repeated subsampling with a fixed cell budget, see depth-plan.md."""
import argparse
from itertools import combinations
from pathlib import Path
import hashlib
import numpy as np
import pandas as pd
from scipy.sparse import csc_matrix

TYPES={'mono':'CD14 monocyte','B_n':'Naive B cell','CD4_Tn':'Naive CD4 T cell','CD8_Tn':'Naive CD8 T cell','NK':'CD56dim NK cell'}
LIG=['IL-2','IL-4']

def run(cache,ref,out,shuffle=False):
    null_rng=np.random.default_rng(429)
    with ref.open('rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest()!='4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd': raise ValueError(ref)
    sets=pd.read_csv(ref).set_index(['fg','cell_type','direction']);g=np.array((cache/'depth_genes.txt').read_text().splitlines());idx=pd.Index(g);gi=np.flatnonzero(~idx.duplicated(keep=False)&(g!=''));gi=gi[np.argsort(g[gi])];symbols=g[gi]
    meta=pd.read_csv(cache/'depth_meta.tsv',sep='\t'); donors=list(range(640,646)); conds=['Baseline','IL2','IL4']
    def arr(k):return np.fromfile(cache/f'depth_{k}.i32',dtype='<i4')
    matrix=csc_matrix((arr('x'),arr('i'),arr('p')),shape=(len(g),len(meta)));groups=meta.groupby(['donor','stim','minor_label_short']).indices
    mins={t:min(len(groups.get((d,c,t),[])) for d in donors for c in conds) for t in TYPES};types=[t for t in TYPES if mins[t]>=10];budgets=[6*(mins[t]//6) for t in types];assert len(types)>=2
    truth={(l,t,d):np.isin(symbols,sets.loc[l,TYPES[t],d].pathway_genes.split(';')) for l in LIG for t in types for d in ['Up','Down']};rng=np.random.default_rng(2026);rows=[]
    for k in [1,2,3,6]:
        subs=list(combinations(donors,k));assert 60%len(subs)==0
        for rep,ix in enumerate(np.concatenate([rng.permutation(len(subs)) for _ in range(60//len(subs))])):
            logmean=np.zeros((3,len(types),len(gi)))
            for d in subs[ix]:
                selected={}
                for ci,c in enumerate(conds):
                    for ti,t in enumerate(types):
                        selected[ci,ti]=rng.choice(groups[d,c,t],budgets[ti]//k,replace=False)
                for ti,t in enumerate(types):
                    arms=[selected[ci,ti] for ci in range(3)]
                    if shuffle: arms=np.split(null_rng.permutation(np.concatenate(arms)),3)
                    for ci,sel in enumerate(arms):
                        cnt=np.asarray(matrix[:,sel].sum(axis=1)).ravel();logmean[ci,ti]+=np.log2((cnt[gi]+0.5)/(cnt.sum()+1)*1e6)/k
            for li,l in enumerate(LIG):
                own=logmean[li+1]-logmean[0];other=(own.sum(axis=0)-own)/(len(types)-1)
                for model,score in [('own',own),('other',other),('half',(own+other)/2)]:
                    for ti,t in enumerate(types):
                        for dr,sign in [('Up',1),('Down',-1)]:
                            top=np.argsort(-sign*score[ti],kind='stable')[:100];rows.append([k,rep,l,t,budgets[ti],dr,model,truth[l,t,dr][top].mean()])
    out.mkdir(parents=True,exist_ok=True);prefix='depth_null' if shuffle else 'depth'
    d=pd.DataFrame(rows,columns=['donors','draw','ligand','lineage','cells_per_condition','direction','model','hit']);detail=d.groupby(['donors','ligand','lineage','cells_per_condition','direction','model']).hit.mean();detail.to_csv(out/f'{prefix}_by_type.csv');macro=detail.groupby(['donors','ligand','direction','model']).mean().unstack();macro.to_csv(out/f'{prefix}_macro.csv');print(macro);print('cells per condition',dict(zip(types,budgets)))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('ref',type=Path);p.add_argument('out',type=Path);p.add_argument('--shuffle',action='store_true');a=p.parse_args();run(a.cache,a.ref,a.out,a.shuffle)
