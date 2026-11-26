import argparse
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from human_targets import contrasts


def score(src,gmt,out):
    with gmt.open('rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest()!='b5a725afbc14a98b4ccfc1821fdcb76e4bc7fa44ffbebd4570c0aa7b0998c060': raise ValueError(gmt)
    with gmt.open() as f: targets={s[0]:set(s[2:]) for s in (line.rstrip('\n').split('\t') for line in f)}
    with np.load(src,allow_pickle=False) as z:
        lfcs=dict(zip(z['cytokines'].tolist(),z['lfc'],strict=True));genes=z['symbols'];types=list(z['source_types'])
    order=np.argsort(genes);genes=genes[order];records=[]
    for name,l,t in contrasts():
        if l not in lfcs:continue
        ct={'NK_cell':'NK','T_cell_CD4':'CD4_Tn'}[t]
        if ct not in types:print('not eligible',ct,name);continue
        data=lfcs[l][:,:,order];i=types.index(ct);n=len(data)
        for draw in [*range(n),None]:
            own=data.mean(axis=0) if draw is None else data[draw];other=np.delete(own,i,axis=0).mean(axis=0)
            for model,vec in [('own',own[i]),('other',other),('half',(own[i]+other)/2)]:
                for dr,sg,suff in [('Up',1,'DN'),('Down',-1,'UP')]:
                    selected=genes[np.argsort(-sg*vec,kind='stable')[:100]];target=targets[name+'_'+suff];records.append([name.split('_')[0],name,l,ct,n if draw is None else 1,dr,model,np.isin(selected,list(target)).mean()])
    out.mkdir(parents=True,exist_ok=True);d=pd.DataFrame(records,columns=['study','contrast','ligand','type','donors','direction','model','hit']);detail=d.groupby(['study','contrast','ligand','type','donors','direction','model']).hit.mean();detail.to_csv(out/'double_holdout_detail.csv');s=detail.groupby(['study','donors','model']).mean().unstack();s['half_minus_own']=s.half-s.own;s.to_csv(out/'double_holdout.csv');print(s);print(s.groupby('donors').mean())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('tensor',type=Path);p.add_argument('gmt',type=Path);p.add_argument('out',type=Path);a=p.parse_args();score(a.tensor,a.gmt,a.out)
