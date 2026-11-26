"""External test: Kang donor subsets versus frozen Parse/Allen IFN-beta signatures."""
import argparse
from itertools import combinations
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd
from run import fetch, load, pseudobulk, lfc_tensor, sha256

URL = 'https://allenimmunology.org/public/publication/download/fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/e7992b0c-e248-4f57-b16f-62784c48f15d/parse_cytokine_gsea_gene_sets.csv'
HASH = '4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd'
# Use a fixed coarse-to-fine mapping. Score both representative subtypes separately,
# then average within each source type (no double weighting of lymphocytes).
TYPES = {'CD14+ Monocytes':['CD14 monocyte'], 'FCGR3A+ Monocytes':['CD16 monocyte'],
         'B cells':['Naive B cell','Memory B cell'], 'NK cells':['CD56dim NK cell','CD56bright NK cell'],
         'CD4 T cells':['Naive CD4 T cell','Memory CD4 T cell'], 'CD8 T cells':['Naive CD8 T cell','Memory CD8 T cell']}


def run(cache,out):
    fetch(cache); f=cache/'parse_sets.csv'
    if not f.exists(): urlretrieve(URL,f)
    if sha256(f)!=HASH: raise ValueError('Parse signature version changed')
    ext=pd.read_csv(f).query("fg == 'IFN-beta'").set_index(['cell_type','direction'])
    meta,genes,mats=load(cache); types,donors,pb,keep,_=pseudobulk(meta,genes,mats)
    tensor=lfc_tensor(types,donors,pb,keep); symbols=genes.loc[keep,'symbol'];valid=symbols.notna() & ~symbols.duplicated(keep=False)
    tensor=tensor[:,:,valid.to_numpy()]; symbols=symbols[valid].to_numpy(); rows=[]
    for k in [1,2,4,8]:
        for ids in combinations(range(len(donors)),k):
            response=tensor[list(ids)].mean(axis=0)
            for i,ct in enumerate(types):
                pooled=np.delete(response,i,axis=0).mean(axis=0)
                for direction,sign in [('Up',1),('Down',-1)]:
                    for model,score in [('type',response[i]),('pooled',pooled)]:
                        # Gene symbol breaks score ties. Top 100 fixed without target ranking.
                        shortlist=set(symbols[np.lexsort((symbols,-sign*score))[:100]])
                        for sub in TYPES[ct]:
                            target=set(ext.loc[(sub,direction),'pathway_genes'].split(';'))
                            rows.append((k,','.join(str(donors[j]) for j in ids),ct,sub,direction,model,len(shortlist & target)/100))
    d=pd.DataFrame(rows,columns=['donors','subset','source_type','target_subtype','direction','model','precision'])
    out.mkdir(parents=True,exist_ok=True)
    detail=d.groupby(['donors','source_type','target_subtype','direction','model']).precision.mean().reset_index();detail.to_csv(out/'parse_by_type.csv',index=False)
    macro=detail.groupby(['donors','source_type','direction','model']).precision.mean().groupby(['donors','direction','model']).mean().unstack('model');macro['type_minus_pooled']=macro.type-macro.pooled
    macro.to_csv(out/'parse_macro.csv');print(macro.to_string());print(f'{len(symbols)} unique source genes; {len(donors)} original donors; independent target uses published lists, not new donor splits.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);p.add_argument('out',type=Path);a=p.parse_args();run(a.cache,a.out)
