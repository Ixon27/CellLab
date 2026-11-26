"""Score independent mouse signatures against precomputed human signatures; see protocol.md."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np
import pandas as pd
from openpyxl import load_workbook

FILES = {
    'mouse-human.xlsx': ('https://www.immune-dictionary.org/static/dataFiles/SuppTable3_Cytokine_Signatures_Human.xlsx', '5d1eb0b2204e4c3168f492b01b02a0f6fc8471c8a828001665588109529ca3d1'),
    'parse_sets.csv': ('https://allenimmunology.org/public/publication/download/fab3f091-63cd-46d3-85fd-a4d5204af649/filesets/e7992b0c-e248-4f57-b16f-62784c48f15d/parse_cytokine_gsea_gene_sets.csv', '4804496ace266450d45c94e02711e76d927b6ad17b8dc11abdde02899732e0fd')}
MAP = {'B_cell':['Naive B cell','Memory B cell'], 'T_cell_CD4':['Naive CD4 T cell','Memory CD4 T cell'], 'T_cell_CD8':['Naive CD8 T cell','Memory CD8 T cell'], 'NK_cell':['CD56dim NK cell','CD56bright NK cell'], 'Monocyte':['CD14 monocyte','CD16 monocyte']}
MODELS = ['own','other','half']


def ligand(s):
    return s.lower().translate(str.maketrans({'-':'','α':'alpha','β':'beta','γ':'gamma','λ':'lambda','ε':'epsilon'}))


def score(cache, out):
    out.mkdir(parents=True, exist_ok=True); cache.mkdir(parents=True,exist_ok=True)
    for name,(url,digest) in FILES.items():
        dest=cache/name
        if not dest.exists(): urlretrieve(url,dest)
        if hashlib.sha256(dest.read_bytes()).hexdigest()!=digest: raise ValueError(name)
    human=pd.read_csv(cache/'parse_sets.csv'); human['lig']=human.fg.map(ligand)
    targets={(r.lig,r.cell_type,r.direction):set(r.pathway_genes.split(';')) for r in human.itertuples()}
    assert len(targets)==len(human)
    w=load_workbook(cache/'mouse-human.xlsx',read_only=True); parts=[]
    for t in MAP:
        ws=w[t]; ws.reset_dimensions(); rows=iter(ws.values); cols=next(rows)
        parts.append(pd.DataFrame(rows,columns=cols).assign(lineage=t))
    w.close(); mouse=pd.concat(parts).dropna(subset=['Gene_Human','Avg_log2FC']); mouse['lig']=mouse.Cytokine.map(ligand)
    mouse=mouse[mouse.groupby('Gene_Human').Gene.transform('nunique').eq(1)]
    audit=[]; scores=[]
    for l in sorted(set(mouse.lig)|set(human.lig)):
        m=mouse.loc[mouse.lig.eq(l)]; reason='included'
        if l=='ifnbeta': reason='discovery'
        elif set(m.lineage)!=set(MAP): reason='missing mouse lineage or ligand'
        elif not all((l,s,d) in targets for subs in MAP.values() for s in subs for d in ['Up','Down']): reason='missing human subtype or ligand'
        audit.append((l,reason));
        if reason!='included': continue
        mat=m.pivot_table(index='Gene_Human',columns='lineage',values='Avg_log2FC',aggfunc='mean',fill_value=0).sort_index()
        for t,subs in MAP.items():
            own=mat[t]; other=mat.drop(columns=t).mean(axis=1)
            for d,sign in [('Up',1),('Down',-1)]:
                lists=[]
                for v in (own,other,(own+other)/2):
                    val=sign*v; lists.append(val[val.gt(0)].sort_values(ascending=False,kind='stable').index[:100])
                k=min(map(len,lists))
                for budget,denom in [('fixed',100),('matched',k)]:
                    if budget=='matched' and k<10: continue
                    hits=[np.mean([len(set(lst[:denom]) & targets[l,s,d])/denom for s in subs]) for lst in lists]
                    scores.append([l,t,d,budget,denom,*hits])
    pd.DataFrame(audit,columns=['ligand','status']).to_csv(out/'eligibility.csv',index=False)
    df=pd.DataFrame(scores,columns=['ligand','lineage','direction','budget','k',*MODELS]);df.to_csv(out/'by_lineage.csv',index=False)
    dirs=df.groupby(['budget','ligand','direction'])[MODELS].mean(); result=dirs.groupby(['budget','ligand']).mean()
    result['half_minus_own']=result.half-result.own; result['other_minus_own']=result.other-result.own;result['half_minus_other']=result.half-result.other; result.to_csv(out/'by_ligand.csv');dirs.groupby(['budget','direction']).mean().to_csv(out/'direction.csv')
    for b in ['matched','fixed']:
        sub=result.loc[b]; diff=sub.half_minus_own;loo=(diff.sum()-diff)/(len(sub)-1)
        print(b,len(sub),len(df[df.budget==b]),sub.mean().round(4).to_dict(),'better/equal/worse',sum(diff>0),sum(diff==0),sum(diff<0),'leave-one-out',loo.min(),loo.max())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cache',type=Path);p.add_argument('out',type=Path);args=p.parse_args();score(args.cache,args.out)
