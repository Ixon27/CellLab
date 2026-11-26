"""Train on one source study and freeze lineage mixing in the other."""
import argparse
import importlib.util
from pathlib import Path
import numpy as np
import pandas as pd
from evaluate import source,models,learn,metrics,max_type_accuracy

ROOT=Path(__file__).resolve().parents[1]

def sibling(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/name/'run.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod


def kang(cache):
    r=sibling('transcript-transfer');r.fetch(cache);meta,g,mats=r.load(cache);types,donors,pb,keep,_=r.pseudobulk(meta,g,mats);x=r.lfc_tensor(types,donors,pb,keep);sym=g.loc[keep,'symbol'];valid=sym.notna()&~sym.duplicated(keep=False);order=[types.index(t) for t in ['CD14+ Monocytes','B cells','CD4 T cells','NK cells']];return sym[valid].to_numpy(str),x[:,order][:,:,valid.to_numpy()]


def run(wood,ref,out):
    data,types=source(wood);data['IFN-beta']=kang(ref.parent);effects=pd.read_csv(ref);rows=[];strata=[];weights=[]
    learned={l:learn(x) for l,(_,x) in data.items()}
    for l,(sy,x) in data.items():
        for i,t in enumerate(types):
            weights.append([l,t,*learned[l][i]])
        target=effects[effects.fg.eq(l)].pivot(index='gene',columns='cell_type',values='log2FoldChange').reindex(index=sy,columns=types).to_numpy().T;good=np.isfinite(target).all(axis=0);y=target[:,good];s,_=models(x);ss={k:s[k] for k in ['own','half','zero','cv_matrix']};
        for train,matrix in learned.items():
            if (l=='IFN-beta')!=(train=='IFN-beta'):ss['frozen_'+train]=matrix@s['own']
        ordered=np.sort(y,axis=0);margin=ordered[-1]-ordered[-2];winner=y.argmax(axis=0);levels=pd.qcut(margin,4,labels=False);unique=margin>1e-12
        for method,v in ss.items():
            est=v[:,good];score=metrics(est,y);bal=np.mean([max_type_accuracy(est[:,(winner==i)&unique],y[:,(winner==i)&unique]) for i in range(len(types))]);rows.append([l,method,len(margin),*score,bal]);
            for tag,mask in [*[(f'quartile_{i+1}',levels==i) for i in range(4)],('positive_max',ordered[-1]>0),('nonpositive_max',ordered[-1]<=0)]:
                mask=mask&unique
                if mask.any():strata.append([l,method,tag,mask.sum(),max_type_accuracy(est[:,mask],y[:,mask])])
    out.mkdir(parents=True,exist_ok=True);df=pd.DataFrame(rows,columns=['ligand','model','genes','rmse','centered_rmse','spearman','type_accuracy','balanced_type_accuracy']);df.to_csv(out/'portability.csv',index=False);pd.DataFrame(strata,columns=['ligand','model','stratum','genes','type_accuracy']).to_csv(out/'margin.csv',index=False);pd.DataFrame(weights,columns=['ligand','target_lineage',*types]).to_csv(out/'mixing_matrices.csv',index=False);print(df.to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('wood',type=Path);p.add_argument('ref',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.wood,a.ref,a.out)
