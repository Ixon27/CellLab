"""Use Parse effect estimates/SE to predict public experimental responses without target fitting."""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from evaluate import source,metrics,other
from portability import kang,sibling


def targets(wood,kcache,scache):
    src,ty=source(wood); direct={t:[t] for t in ty}
    for l,(g,x) in src.items():yield 'Wood',l,'48h',pd.DataFrame(x.mean(axis=0).T,index=g,columns=ty),direct
    g,x=kang(kcache); r=sibling('cytokine-sorted'); km=dict(zip(ty,[['CD14 monocyte'],r.ARRAY_TYPES['B Cell'],r.ARRAY_TYPES['CD4 Cell'],r.ARRAY_TYPES['NK Cell']],strict=True));yield 'Kang','IFN-beta','6h',pd.DataFrame(x.mean(axis=0).T,index=g,columns=ty),km
    h=pd.read_csv(r.cached(scache,r.HGNC_FILE),sep='\t',dtype=str,usecols=['status','symbol','entrez_id','ensembl_gene_id']);a,_=r.array_responses(r.cached(scache,'GSE17762_series_matrix.txt.gz'),r.cached(scache,'GPL8601.soft'),h)
    for time,z in a.items():yield 'Waddell','IFN-gamma',time,z,r.ARRAY_PANELS[time]
    b,_=r.bulk_responses(r.cached(scache,r.BULK_FILE),h)
    for arm,z in b.items():yield 'Cano-Gamez',r.BULK_CYTOKINES[arm],arm+'_16h_cocktail',z,r.BULK_TYPES


def estimators(x,se):
    v=se**2;w=1/v;sw=w.sum(axis=0);fixed=(w*x).sum(axis=0)/sw;q=(w*(x-fixed)**2).sum(axis=0);c=sw-(w*w).sum(axis=0)/sw;tau=np.maximum(0,(q-(len(x)-1))/c);wt=1/(v+tau);center=(wt*x).sum(axis=0)/wt.sum(axis=0);re=(tau*x+v*center)/(v+tau)
    return {'own':x,'half':(x+other(x))/2,'all':np.broadcast_to(x.mean(axis=0),x.shape),'zero':np.zeros_like(x),'fixed_inverse_variance':np.broadcast_to(fixed,x.shape),'random_effects_shrinkage':re},tau


def run(wood,scache,reference,out):
    df=pd.read_csv(reference);rows=[];flow=[]
    for st,l,contrast,tg,mapping in targets(wood,reference.parent,scache):
        eff=df[df.fg.eq(l)].pivot(index='gene',columns='cell_type',values=['log2FoldChange','lfcSE']);order=list(tg);needed=[s for t in order for s in mapping[t]]; aligned=eff.reindex(tg.index); a=aligned.log2FoldChange[needed];b=aligned.lfcSE[needed];valid=np.isfinite(a).all(axis=1)&np.isfinite(b).all(axis=1)&(b>0).all(axis=1)&np.isfinite(tg).all(axis=1);a=a[valid];b=b[valid];y=tg[valid].to_numpy().T;x=np.stack([a[list(mapping[t])].mean(axis=1) for t in order]);
        for mode in ['correlated','independent']:
            se=np.stack([b[list(mapping[t])].mean(axis=1) if mode=='correlated' else np.sqrt((b[list(mapping[t])]**2).sum(axis=1))/len(mapping[t]) for t in order]);scores,tau=estimators(x,se);flow.append([st,l,contrast,mode,len(order),len(tg),int(valid.sum()),np.mean(tau==0)])
            for name,s in scores.items():rows.append([st,l,contrast,mode,name,*metrics(s,y)])
    out.mkdir(parents=True,exist_ok=True);d=pd.DataFrame(rows,columns=['study','ligand','contrast','se_assumption','model','rmse','centered_rmse','spearman','type_accuracy']);d.to_csv(out/'reverse.csv',index=False);pd.DataFrame(flow,columns=['study','ligand','contrast','se_assumption','lineages','target_symbols','eligible','tau_zero_fraction']).to_csv(out/'reverse_flow.csv',index=False);print(d.query("se_assumption=='correlated' and model in ['own','half','random_effects_shrinkage']").to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for arg in ['wood','sorted_cache','ref','out']:p.add_argument(arg,type=Path)
    a=p.parse_args();run(a.wood,a.sorted_cache,a.ref,a.out)
