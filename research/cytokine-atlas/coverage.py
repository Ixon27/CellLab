"""Post-hoc: compare budgets on identical tasks; isolate shortlist extension and selection."""
import argparse
from pathlib import Path
import pandas as pd


def decompose(out):
    data=pd.read_csv(out/'by_lineage.csv');keys=['ligand','lineage','direction']
    fixed=data[data.budget.eq('fixed')].set_index(keys);matched=data[data.budget.eq('matched')].set_index(keys)
    fair=fixed.loc[matched.index]; cols=['own','other','half']
    rows=[]
    for label,frame in [('all_fixed',fixed),('same_tasks_fixed',fair),('same_tasks_matched',matched),('excluded_tasks_fixed',fixed.drop(index=matched.index))]:
        q=frame[cols].groupby(['ligand','direction']).mean().groupby('ligand').mean().mean();rows.append([label,len(frame),len(frame.index.unique('ligand')),*(q[c] for c in cols),q.half-q.own]);
    d=pd.DataFrame(rows,columns=['tasks','n','ligands',*cols,'half_minus_own']);d.to_csv(out/'coverage.csv',index=False);print(d.to_string(index=False));print('matched median k',matched.k.median());print('both directions', (matched.reset_index().groupby('ligand').direction.nunique()==2).sum())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('out',type=Path);decompose(p.parse_args().out)
