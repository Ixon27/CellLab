"""Paired-donor cytokine transfer, magnitude, lineage identity and source uncertainty."""
import argparse
from itertools import combinations, combinations_with_replacement, permutations, product
from math import factorial, prod
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csc_matrix
from scipy.stats import rankdata
from structured import learn


def source(cache):
    with np.load(cache/'wood_donor_lfc.npz',allow_pickle=False) as z:
        genes,types,targets,donors,ligands,lfc=(z[k] for k in ('symbols','source_types','target_types','donors','cytokines','lfc'))
    rg=pd.Index((cache/'depth_genes.txt').read_text().splitlines());ix=rg.get_indexer(genes);assert rg.is_unique and (ix>=0).all()
    meta=pd.read_csv(cache/'depth_meta.tsv',sep='\t');grp=meta.groupby(['donor','stim','minor_label_short']).indices
    def arr(k):return np.fromfile(cache/f'depth_{k}.i32',dtype='<i4')
    m=csc_matrix((arr('x'),arr('i'),arr('p')),shape=(len(rg),len(meta))); data={}
    for l,raw in zip(ligands,lfc,strict=True):
        counts=np.array([[[np.asarray(m[:,grp[d,s,t]].sum(axis=1)).ravel() for t in types] for d in donors] for s in ('Baseline',l.replace('-',''))]); libs=counts.sum(axis=-1,keepdims=True); c=counts[:,:,:,ix];log=np.log2((c+.5)/(libs+1)*1e6);np.testing.assert_allclose(log[1]-log[0],raw,atol=1e-10)
        keep=(c/libs*1e6>=1).sum(axis=(0,1,2))>=6;data[l]=(genes[keep],raw[:,:,keep])
    return data,targets


def other(x):return (x.sum(axis=-2,keepdims=True)-x)/(x.shape[-2]-1)


def models(x):
    own=x.mean(axis=0);p=other(own);m=len(p);a=own.mean(axis=0,keepdims=True);delta=own-p
    if len(x)>1:
        train=(x.sum(axis=0)-x)/(len(x)-1);base=other(train);d=train-base
        numer=(d*(x-base)).sum(axis=(0,2));den=(d*d).sum(axis=(0,2));w=np.clip(np.divide(numer,den,out=np.full(m,.5),where=den>0),0,1);shared=np.clip(numer.sum()/den.sum(),0,1) if den.sum()>0 else .5
    else:w=np.full(m,.5);shared=.5
    return {'own':own,'other':p,'half':(own+p)/2,'all':np.broadcast_to(a,own.shape),'zero':np.zeros_like(own),'cv_shared':p+shared*delta,'cv_lineage':p+w[:,None]*delta,'cv_matrix':learn(x)@own},np.r_[shared,w]


def rmse(e):return np.sqrt((e*e).mean(axis=1)).mean()


def centered(x):return x-x.mean(axis=0)


def max_type_accuracy(s,y):
    # Allow fractional credit for source ties; do not invent a winner in target ties.
    top=np.isclose(s,s.max(axis=0),rtol=0,atol=1e-12); lab=np.isclose(y,y.max(axis=0),rtol=0,atol=1e-12);valid=lab.sum(axis=0)==1
    return ((top[:,valid]&lab[:,valid]).sum(axis=0)/top[:,valid].sum(axis=0)).mean()


def rho(s,y):
    ranks=rankdata(s,axis=1); y=rankdata(y,axis=1);ranks-=ranks.mean(axis=1,keepdims=True);y-=y.mean(axis=1,keepdims=True);den=np.sqrt((ranks*ranks).sum(axis=1)*(y*y).sum(axis=1));return ((ranks*y).sum(axis=1)/den).mean() if np.all(den>0) else np.nan


def metrics(s,y):return (rmse(s-y),rmse(centered(s)-centered(y)),rho(s,y),max_type_accuracy(s,y))


def uncertainty(x,y):
    n=len(x);bs=[];null=[]
    for ids in combinations_with_replacement(range(n),n):
        own=x[list(ids)].mean(axis=0);half=(own+other(own))/2;e1=own-y;e2=half-y;weight=factorial(n)/prod(factorial(v) for v in np.bincount(ids))/n**n
        bs.append((weight,rmse(e2)-rmse(e1),rmse(centered(e2))-rmse(centered(e1))))
    bs=np.asarray(bs); assert np.isclose(bs[:,0].sum(),1);bounds=[]
    for i in (1,2):
        order=np.argsort(bs[:,i]);cdf=np.cumsum(bs[order,0]);bounds.extend(bs[order[np.searchsorted(cdf,[.025,.975])],i])
    for signs in product([-1,1],repeat=n):
        own=(x*np.asarray(signs)[:,None,None]).mean(axis=0);null.append((rho(own,y),max_type_accuracy(own,y)))
    null=np.asarray(null);return [*bounds,*null[-1],*(null>=null[-1]-1e-12).mean(axis=0)]


def run(cache,ref,out):
    out.mkdir(exist_ok=True,parents=True);data,types=source(cache);df=pd.read_csv(ref); panels={l:d.pivot(index='gene',columns='cell_type',values='log2FoldChange').reindex(columns=types) for l,d in df.groupby('fg')};rows=[];weights=[];perm=[];ci=[];flow=[]
    for l,(genes,x) in data.items():
        otherlig=next(v for v in data if v!=l);aligned={v:panels[v].reindex(genes).to_numpy().T for v in data};same=np.isfinite(aligned[l]).all(axis=0);both=same & np.isfinite(aligned[otherlig]).all(axis=0);flow.append([l,len(genes),int(same.sum()),int(both.sum())]);
        for k in [1,2,4,len(x)]:
            for ids in combinations(range(len(x)),k):
                scores,ww=models(x[list(ids)]);subset='/'.join(map(str,ids));weights.append([l,k,subset,*ww])
                if k==len(x):scores['cross_ligand_matrix']=learn(data[otherlig][1])@scores['own']
                for test,tl,mask in [('matched',l,same)]+([('both_right',l,both),('both_wrong',otherlig,both)] if k==len(x) else []):
                    y=aligned[tl][:,mask];acc={}
                    for name,s in scores.items():
                        if k!=len(x) and test!='matched':continue
                        res=metrics(s[:,mask],y);acc[name]=res[-1];rows.append([l,k,subset,test,name,*res])
                    assert np.isclose(acc['own'],acc['half'])
        y=aligned[l][:,same];own=x.mean(axis=0)[:,same];ci.append([l,*uncertainty(x[:,:,same],y)])
        for p in permutations(range(len(types))):perm.append([l,'/'.join(types[list(p)]),p==tuple(range(len(types))),max_type_accuracy(own,y[list(p)])])
    def save(rows,cols,file):
        d=pd.DataFrame(rows,columns=cols.split('|'));d.to_csv(out/file,index=False);return d
    detail=save(rows,'ligand|donors|subset|target|model|rmse|centered_rmse|spearman|type_accuracy','subsets.csv');summary=detail.groupby(['ligand','donors','target','model'])[['rmse','centered_rmse','spearman','type_accuracy']].mean();summary.to_csv(out/'macro.csv');print(summary.xs((6,'matched'),level=('donors','target')))
    save(weights,'ligand|donors|subset|shared|'+'|'.join(types),'weights.csv');save(perm,'ligand|target_order|correct|type_accuracy','permutations.csv');print(save(flow,'ligand|source_filtered|matched|both_targets','flow.csv'));print(save(ci,'ligand|rmse_lo|rmse_hi|centered_lo|centered_hi|rho|type_accuracy|flip_p_rho|flip_p_type','uncertainty.csv'))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('wood',type=Path);p.add_argument('effects',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.wood,a.effects,a.out)
