"""Post-hoc established-method sensitivity at six donors, not an optimized classifier."""
import argparse
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import numpy as np
import pandas as pd
from scipy.sparse import csc_matrix


from human_targets import contrasts

def run(cache,ref,out):
    with np.load(cache/'wood_donor_lfc.npz',allow_pickle=False) as z:
        data,genes,types,donors,ligands,targets=(z[k] for k in ('lfc','symbols','source_types','donors','cytokines','target_types'))
    rawgenes=pd.Index((cache/'depth_genes.txt').read_text().splitlines()); assert rawgenes.is_unique
    ix=rawgenes.get_indexer(genes);assert (ix>=0).all()
    meta=pd.read_csv(cache/'depth_meta.tsv',sep='\t');grp=meta.groupby(['donor','stim','minor_label_short']).indices
    def arr(k):return np.fromfile(cache/f'depth_{k}.i32',dtype='<i4')
    m=csc_matrix((arr('x'),arr('i'),arr('p')),shape=(len(rawgenes),len(meta)));sets=pd.read_csv(ref).set_index(['fg','cell_type','direction']);rows=[]
    with (ref.parent/'immune.gmt').open() as f:
        archives={s[0]:s[2:] for s in (line.rstrip('\n').split('\t') for line in f)}
    direct=[]
    for li,l in enumerate(ligands):
        c=np.array([[[np.asarray(m[:,grp[d,stim,t]].sum(axis=1)).ravel() for t in types] for d in donors] for stim in ('Baseline',l.replace('-',''))]);total=c.sum(axis=-1,keepdims=True);log=np.log2((c[:,:,:,ix]+.5)/(total+1)*1e6);np.testing.assert_allclose(log[1]-log[0],data[li],atol=1e-10)
        keep=(c[:,:,:,ix]/total*1e6>=1).sum(axis=(0,1,2))>=6;sy=genes[keep];own=data[li][:,:,keep];other=(own.sum(axis=1,keepdims=True)-own)/(len(types)-1);blocks=np.concatenate([own.transpose(1,0,2),other.transpose(1,0,2),((own+other)/2).transpose(1,0,2)])
        with TemporaryDirectory() as td:
            tmp=Path(td);f=tmp/'donor';s=tmp/'t';blocks.astype('<f8').tofile(f);subprocess.run(['Rscript',Path(__file__).with_name('moderated.R'),f,str(len(donors)),str(len(sy)),str(len(blocks)),s],check=True);moderated=np.fromfile(s,dtype='<f8').reshape(len(blocks),len(sy));assert np.isfinite(moderated).all()
        for mode,score in [('mean_LFC',blocks.mean(axis=1)),('moderated_t',moderated)]:
            for b,v in enumerate(score):
                ti=b%len(types);method=['own','other','half'][b//len(types)]
                for dr,sign in [('Up',1),('Down',-1)]:
                    top=sy[np.lexsort((sy,-sign*v))[:100]];tg=sets.loc[(l,targets[ti],dr),'pathway_genes'].split(';');rows.append([l,types[ti],dr,mode,method,len(sy),np.isin(top,tg).mean()])
                    for name,lig,t in contrasts():
                        if l==lig and types[ti]=={'T_cell_CD4':'CD4_Tn','NK_cell':'NK'}[t]:
                            hit=np.isin(top,archives[name+('_DN' if dr=='Up' else '_UP')]).mean()
                            direct.append([name.split('_')[0],name,dr,mode,method,hit])
    df=pd.DataFrame(rows,columns=['ligand','lineage','direction','rank','model','genes','hit']);df.to_csv(out/'moderated_by_type.csv',index=False);q=df.groupby(['ligand','rank','model']).hit.mean().unstack();q.to_csv(out/'moderated.csv');print(q)
    direct=pd.DataFrame(direct,columns=['study','contrast','direction','rank','model','hit'])
    s=direct.groupby(['study','rank','model']).hit.mean().unstack();s.to_csv(out/'moderated_double_holdout.csv');print(s)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('ref',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.cache,a.ref,a.out)
