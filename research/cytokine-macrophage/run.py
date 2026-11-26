"""Can independent peripheral blood signatures identify a blinded macrophage stimulus?"""
import argparse
import csv
import gzip
import hashlib
from itertools import combinations, permutations
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd
from scipy.stats import rankdata

FILES={'array.gz':('https://ftp.ncbi.nlm.nih.gov/geo/series/GSE46nnn/GSE46903/matrix/GSE46903_series_matrix.txt.gz','2f97da65f77cdf46bd3d73d85a34282acbffc33ee879bcbbb53f2bd740499e0f'),'platform.gz':('https://ftp.ncbi.nlm.nih.gov/geo/platforms/GPL6nnn/GPL6947/annot/GPL6947.annot.gz','244c4ef6394abd8c87309318f3f27e9e63c45d2d1c3e89303818f1f63a290824')}
ARMS={'IL4':'IL-4','IL13':'IL-13','IL10':'IL-10','IFNg':'IFN-gamma'}
TYPES=['CD14 monocyte','Naive B cell','Naive CD4 T cell','CD56dim NK cell']


def target(cache):
    cache.mkdir(parents=True,exist_ok=True)
    for n,(url,h) in FILES.items():
        p=cache/n
        if not p.exists():urlretrieve(url,p)
        with p.open('rb') as f:
            if hashlib.file_digest(f,'sha256').hexdigest()!=h:raise ValueError(p)
    meta={}
    with gzip.open(cache/'array.gz','rt') as f:
        for r in csv.reader(f,delimiter='\t'):
            if not r:continue
            if r[0]=='!series_matrix_table_begin':break
            if r[0] in ('!Sample_description','!Sample_geo_accession'):meta[r[0]]=r[1:]
            if r[0]=='!Sample_characteristics_ch1':meta[r[1].split(': ',1)[0]]=[s.split(': ',1)[-1] for s in r[1:]]
        meta=pd.DataFrame(meta).rename(columns={'!Sample_geo_accession':'gsm','!Sample_description':'lineage','activation stimuli':'arm','initial differentiation':'priming'});meta=meta.query("lineage=='Macrophage' and priming=='GM-CSF' and time=='72h'");meta=meta[meta.arm.isin(['con',*ARMS])];donors=sorted(d for d,g in meta.groupby('donor') if set(g.arm)=={'con',*ARMS});assert donors==['BC58','BC76','BC78'];meta=meta[meta.donor.isin(donors)];values=pd.read_csv(f,sep='\t',comment='!',usecols=['ID_REF',*meta.gsm],index_col='ID_REF')
    with gzip.open(cache/'platform.gz','rt') as f:
        for line in f:
            if line.strip()=='!platform_table_begin':break
        ann=pd.read_csv(f,sep='\t',comment='!',usecols=['ID','Gene symbol'],index_col='ID')['Gene symbol'].dropna().astype(str);ann=ann[ann.str.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*')];assert ann.index.is_unique
    values=values.assign(gene=ann.reindex(values.index)).dropna().groupby('gene',sort=True).median();effects=[]
    for d in donors:
        g=meta[meta.donor==d];base=values[g[g.arm=='con'].gsm].mean(axis=1);effects.append(np.stack([(values[g[g.arm==arm].gsm].mean(axis=1)-base).to_numpy() for arm in ARMS]))
    return values.index,np.stack(effects),meta.sort_values(['donor','arm']),donors


def normrank(a):
    v=rankdata(a,axis=1);v-=v.mean(axis=1,keepdims=True);return v/np.linalg.norm(v,axis=1,keepdims=True)


def match(c,p):
    byrow=c[np.arange(len(p)),p][:,None];above=(c>byrow+1e-12).sum(axis=1);tied=np.isclose(c,byrow,atol=1e-12,rtol=0).sum(axis=1);top=np.mean((above==0)/tied);mrr=np.mean([np.mean(1/(a+np.arange(1,t+1))) for a,t in zip(above,tied,strict=True)]);diag=byrow.mean();return diag,(c.sum()-byrow.sum())/(c.size-len(p)),top,mrr


def run(cache,ref,out):
    tg,all_y,meta,donors=target(cache);f=pd.read_csv(ref);pred=np.stack([f[f.fg.eq(l)].pivot(index='gene',columns='cell_type',values='log2FoldChange').reindex(index=tg,columns=TYPES).to_numpy().T for l in ARMS.values()]);good=np.isfinite(pred).all(axis=(0,1))&np.isfinite(all_y).all(axis=(0,1));pred=pred[:,:,good];ys=all_y[:,:,good];sy=tg[good].to_numpy();own=pred[:,0];other=pred[:,1:].mean(axis=1);rows=[];details=[];end=[];n=len(ARMS);names=list(ARMS.values())
    for k in [1,2,3]:
        for ix in combinations(range(len(donors)),k):
            donor='/'.join(donors[i] for i in ix);y=ys[list(ix)].mean(axis=0);yr=normrank(y)
            for method,x in [('own',own),('other',other),('half',(own+other)/2)]:
                c=yr@normrank(x).T;diag,wrong,top,mrr=match(c,list(range(n)));null=[match(c,p)[0] for p in permutations(range(n))];rows.append([donor,k,method,diag,wrong,diag-wrong,top,mrr,np.mean(np.asarray(null)>=diag-1e-12)])
                for i,actual in enumerate(names):
                    for j,guess in enumerate(names):details.append([donor,method,actual,guess,c[i,j]])
                    for sign,dr in [(1,'Up'),(-1,'Down')]:
                        predidx=np.lexsort((sy,-sign*x[i]))[:100];real=np.lexsort((sy,-sign*y[i]));real=real[sign*y[i,real]>0][:500];end.append([donor,method,actual,dr,len(real),len(set(predidx)&set(real))/100,np.sqrt(np.mean((x[i]-y[i])**2))])
    out.mkdir(parents=True,exist_ok=True);meta.to_csv(out/'samples.csv',index=False);summ=pd.DataFrame(rows,columns=['donors','n_donors','method','matched_rho','wrong_rho','gap','top1','mrr','mapping_tail']);summ.to_csv(out/'retrieval.csv',index=False);d=pd.DataFrame(details,columns=['donors','method','target','guess','rho']);d.to_csv(out/'confusions.csv',index=False);pd.DataFrame(end,columns=['donors','model','ligand','direction','target_genes','hits_per_100','rmse']).to_csv(out/'direction.csv',index=False);pd.DataFrame([[len(meta),len(tg),len(sy)]],columns=['samples','array_genes','common_genes']).to_csv(out/'coverage.csv',index=False);print(summ.query("method=='own' or n_donors==3").to_string(index=False));print(d.query("donors==@donor and method=='own'").pivot(index='target',columns='guess',values='rho'));print('common',len(sy))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('ref',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.cache,a.ref,a.out)
