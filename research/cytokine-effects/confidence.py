"""Study-blocked confidence evaluation, not a calibrated probability of identification."""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

KEYS=['study','time','ligand','type']


def calls(scores):
    rows=[]
    for key,f in scores.groupby(KEYS):
        f=f.sort_values('spearman',ascending=False);truth=key[2];v=f.spearman.to_numpy();bad=f[f.candidate.ne(truth)].spearman.to_numpy();rank=f.candidate.tolist().index(truth)+1
        assert f.candidate.is_unique and v[0]>v[1]+1e-12 and bad[0]>bad[1]+1e-12
        rows.append([*key,len(f),rank,f.candidate.iloc[0],rank==1,v[0]-v[1],bad[0]-bad[1]])
    return pd.DataFrame(rows,columns=KEYS+['candidates','rank','guess','correct','gap','missing_class_gap'])


def threshold(d):
    w=1/d.groupby('study').study.transform('size');assert d.study.nunique()>=3
    for v in sorted(d.gap.unique()):
        accepted=d.gap>=v
        if d[accepted].study.nunique()>=3 and d[accepted].ligand.nunique()>=2 and (w[accepted]*d.correct[accepted]).sum()/w[accepted].sum()>=.8:return v
    return np.inf


def run(out):
    main=pd.read_csv(out/'catalogue_all_scores.csv').query("model=='own' and not (study=='Yuan' and time=='6h')");xue=main.query("study=='Xue'");restricted=calls(xue[xue.candidate.isin(xue.ligand.unique())]);pd.concat([restricted,calls(xue)]).to_csv(out/'fixed_genes.csv',index=False)
    d=calls(main);extra=calls(pd.read_csv(out/'nk_scores.csv'));frozen=threshold(d);rows=[]
    for study in [*d.study.unique(),*extra.study.unique()]:
        inside=study in d.study.values;v=threshold(d[d.study!=study]) if inside else frozen;test=(d if inside else extra).loc[lambda x:x.study==study].copy();test['threshold']=v;test['accept']=test.gap>=v;test['missing_accept']=test.missing_class_gap>=v;test['validation']='leave_study_out' if inside else 'frozen_NK';rows.append(test)
    full=pd.concat(rows,ignore_index=True);full.to_csv(out/'confidence.csv',index=False);s=full.assign(accepted_correct=full.accept&full.correct).groupby(['validation','study']).agg(queries=('guess','size'),forced_correct=('correct','sum'),accepted=('accept','sum'),accepted_correct=('accepted_correct','sum'),missing_false_accept=('missing_accept','sum'));s.to_csv(out/'confidence_macro.csv');print(s.to_string());print('Five-study threshold:',frozen);print(restricted[['ligand','rank','guess']].to_string(index=False));print(full[full.validation=='frozen_NK'][['study','time','ligand','rank','guess','accept']].to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('out',type=Path);run(p.parse_args().out)
