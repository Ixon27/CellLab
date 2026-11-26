"""Evaluate frozen Parse votes on independent published human microarray gene lists."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd
from run import MAP, FILES

GMT='https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2025.1.Hs/c7.immunesigdb.v2025.1.Hs.symbols.gmt'
LIGS=['IL-2','IL-4','IL-12','IL-15']


def contrasts():
    for l in ('IL-2','IL-15'):
        yield f'GSE22886_UNSTIM_VS_{l.replace("-", "")}_STIM_NKCELL',l,'NK_cell'
    for dose in ('HIGH','LOW'):
        yield f'GSE12198_CTRL_VS_{dose}_IL2_STIM_NK_CELL','IL-2','NK_cell'
    for l in ('IL-4','IL-12'):
        for t in (2,6,48):
            yield f'GSE2770_UNTREATED_VS_{l.replace("-", "")}_TREATED_ACT_CD4_TCELL_{t}H',l,'T_cell_CD4'
    yield 'GSE20198_UNTREATED_VS_IL12_TREATED_ACT_CD4_TCELL','IL-12','T_cell_CD4'


def precision(scores, target):
    ordered=scores[scores.gt(0)].sort_values(ascending=False)
    if len(ordered)<=100: return ordered.index.isin(target).sum()/100
    cutoff=ordered.iloc[99]; high=ordered[ordered.gt(cutoff)]; tied=ordered[ordered.eq(cutoff)]
    return (high.index.isin(target).sum()+(100-len(high))*tied.index.isin(target).mean())/100


def run(cache,out):
    cache.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
    for name,(url,digest) in {'immune.gmt':(GMT,'b5a725afbc14a98b4ccfc1821fdcb76e4bc7fa44ffbebd4570c0aa7b0998c060'),'parse_sets.csv':FILES['parse_sets.csv']}.items():
        f=cache/name
        if not f.exists(): urlretrieve(url,f)
        if hashlib.sha256(f.read_bytes()).hexdigest()!=digest:raise ValueError(f)
    with (cache/'immune.gmt').open() as f:
        sets={row[0]:set(row[2:]) for row in (line.rstrip('\n').split('\t') for line in f)}
    h=pd.read_csv(cache/'parse_sets.csv').set_index(['fg','cell_type','direction']);source={}
    for l in LIGS:
        scores={}
        for t,subs in MAP.items():
            votes={}
            for s in subs:
                for direction,sign in [('Up',1),('Down',-1)]:
                    for gene in set(h.loc[(l,s,direction),'pathway_genes'].split(';')):votes[gene]=votes.get(gene,0)+sign/len(subs)
            scores[t]=pd.Series(votes)
        source[l]=pd.DataFrame(scores).fillna(0)
    rows=[]
    for name,l,t in contrasts():
        for direction,sign,suffix in [('Up',1,'DN'),('Down',-1,'UP')]:
            target=sets[name+'_'+suffix]
            for alt,m in source.items():
                own=m[t];other=m.drop(columns=t).mean(axis=1)
                for model,v in [('own',own),('other',other),('half',(own+other)/2)]:
                    rows.append([name.split('_')[0],name,l,t,direction,alt,model,len(target),precision(sign*v,target)])
    df=pd.DataFrame(rows,columns=['study','contrast','ligand','lineage','direction','source_ligand','model','target_size','hit']);df.to_csv(out/'human_tasks.csv',index=False)
    df['control']=np.where(df.ligand==df.source_ligand,'matched','wrong');summ=df.groupby(['study','control','model']).hit.mean().unstack();summ['half_minus_own']=summ.half-summ.own;summ.to_csv(out/'human_by_study.csv');print(summ);print(summ.groupby('control').mean()); df.groupby(['study','direction','control','model']).hit.mean().groupby(['direction','control','model']).mean().unstack().to_csv(out/'human_directions.csv')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.cache,a.out)
