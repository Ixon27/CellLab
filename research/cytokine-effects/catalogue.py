"""Rank every public cytokine reference against each external measured human response."""
import argparse
from pathlib import Path
import hashlib
import numpy as np
import pandas as pd
from scipy.stats import rankdata, spearmanr
from evaluate import source
from portability import kang,sibling
from prepare import HASH

TYPES=['CD14 monocyte','Naive B cell','Naive CD4 T cell','CD56dim NK cell']


def catalog(path):
    with path.open('rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest()!=HASH:raise ValueError(path)
    rows=[]
    for part in pd.read_csv(path,usecols=['cell_type','fg','bg','mode','gene','log2FoldChange'],chunksize=200_000):
        rows.append(part.loc[part.cell_type.isin(TYPES)&part.bg.eq('PBS')&part['mode'].eq('Pseudobulk'),['cell_type','fg','gene','log2FoldChange']]);
    f=pd.concat(rows,ignore_index=True);ls=sorted(f.fg.unique());assert len(ls)==90
    p=f.pivot(index='gene',columns=['fg','cell_type'],values='log2FoldChange').reindex(columns=pd.MultiIndex.from_product([ls,TYPES])).replace([np.inf,-np.inf],np.nan);return ls,p


def experiments(wood,ref,scache,xue,yuan):
    wooddata,types=source(wood)
    for l,(g,x) in wooddata.items():
        for i,t in enumerate(types):yield 'Wood','48h',l,t,g,x[:,i]
    mac=sibling('cytokine-macrophage');g,y,_,_=mac.target(xue)
    for i,l in enumerate(mac.ARMS.values()):yield 'Xue','72h',l,TYPES[0],g,y[:,i]
    cohort=sibling('cytokine-new-cohort')
    for h,(g,y) in cohort.yuan_targets(yuan).items():yield 'Yuan',f'{h}h','IL-4',TYPES[0],g,y
    g,x=kang(ref.parent)
    for i,t in enumerate(types):yield 'Kang','6h','IFN-beta',t,g,x[:,i]
    r=sibling('cytokine-sorted');h=pd.read_csv(r.cached(scache,r.HGNC_FILE),sep='\t',dtype=str,usecols=['status','symbol','entrez_id','ensembl_gene_id']);panels,_=r.array_responses(r.cached(scache,'GSE17762_series_matrix.txt.gz'),r.cached(scache,'GPL8601.soft'),h);a=panels['24 h'];
    for i,t in enumerate(['Monocyte','B Cell','CD4 Cell','NK Cell']):yield 'Waddell','24h','IFN-gamma',TYPES[i],a.index,a[[t]].to_numpy().T


def standardized_ranks(a):
    z=rankdata(a,axis=-1);z-=z.mean(axis=-1,keepdims=True);return z/np.linalg.norm(z,axis=-1,keepdims=True)


def run(wood,ref,scache,xue,yuan,out):
    out.mkdir(parents=True,exist_ok=True);ls,p=catalog(ref);complete=p.dropna();rows=[];all_scores=[]
    for study,time,l,t,g,ys in experiments(wood,ref,scache,xue,yuan):
        ix=complete.index.get_indexer(g);keep=(ix>=0)&np.isfinite(ys).all(axis=0);c=complete.iloc[ix[keep]].to_numpy().T.reshape(len(ls),len(TYPES),-1);i=TYPES.index(t);own=c[:,i];other=(c.sum(axis=1)-own)/3;truth=ls.index(l)
        response=ys[:,keep];panel={'group':response.mean(axis=0)}
        if len(response)>1:panel.update({str(i+1):v for i,v in enumerate(response)})
        for method,x in [('own',own),('other',other),('half',(own+other)/2)]:
            z=standardized_ranks(x)
            for d,y in panel.items():
                scores=z@standardized_ranks(y);score=scores[truth];n=(scores>score+1e-12).sum();tied=np.isclose(scores,score,atol=1e-12,rtol=0).sum();ranks=n+np.arange(1,tied+1);wrong=scores.copy();wrong[truth]=-np.inf;j=int(wrong.argmax());rows.append([study,time,l,t,d,method,len(y),len(ls),ls[int(scores.argmax())],ranks.mean(),np.mean(ranks==1),np.mean(ranks<=5),np.mean(1/ranks),score,ls[j],wrong[j]])
                if d=='group':all_scores.extend((study,time,l,t,method,guess,v) for guess,v in zip(ls,scores,strict=True))
    d=pd.DataFrame(rows,columns='study time ligand type donor model genes candidates top_guess rank top1 top5 mrr matched_rho best_wrong wrong_rho'.split());d.to_csv(out/'catalogue.csv',index=False);pd.DataFrame(all_scores,columns='study time ligand type model candidate spearman'.split()).to_csv(out/'catalogue_all_scores.csv',index=False);q=d[d.donor.eq('group')].groupby(['study','time','model','ligand'])[['top1','top5','mrr','rank']].mean().groupby(['study','time','model']).mean();q.to_csv(out/'catalogue_macro.csv');print(q.xs('own',level='model'));print(d.query("donor=='group' and model=='own'")[['study','time','ligand','type','genes','rank','top_guess']].to_string(index=False));
    # Post-hoc analogue versus specificity: same IL-4/IL-13 target donors, rank both components.
    mac=sibling('cytokine-macrophage');g,sy,_,donors=mac.target(xue);cols=[('IL-4',TYPES[0]),('IL-13',TYPES[0])];m=p[cols].reindex(g);stats=[]
    for tag,avail in [('paired_ligands',m.notna().all(axis=1).to_numpy()),('catalogue',g.isin(complete.index))]:
        x=m.to_numpy()[avail].T;y=sy[:,:,avail];a=list(mac.ARMS.values()).index('IL-4');b=list(mac.ARMS.values()).index('IL-13');
        for part,target,src in [('shared',(y[:,a]+y[:,b])/2,(x[0]+x[1])/2),('difference',y[:,a]-y[:,b],x[0]-x[1])]:
            cross=spearmanr(src,target.mean(axis=0)).statistic
            for i,donor in enumerate(donors):stats.append([tag,avail.sum(),part,donor,cross,spearmanr(target[i],np.delete(target,i,axis=0).mean(axis=0)).statistic])
    d=pd.DataFrame(stats,columns='universe genes component target_donor cross_study_rho within_xue_loo_rho'.split());d.to_csv(out/'near_neighbors.csv',index=False);print(d.groupby(['universe','component'])[['cross_study_rho','within_xue_loo_rho']].mean())

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for arg in ['wood','ref','sorted_cache','xue','yuan','out']:p.add_argument(arg,type=Path)
    a=p.parse_args();run(a.wood,a.ref,a.sorted_cache,a.xue,a.yuan,a.out)
