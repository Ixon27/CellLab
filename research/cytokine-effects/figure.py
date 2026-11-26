"""Generate the manuscript figure from the distributed aggregate CSVs."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def draw(root):
    direct=pd.read_csv(root/'macro.csv').query("donors==6 and target=='matched'");reverse=pd.read_csv(root/'reverse.csv').query("study=='Wood' and se_assumption=='correlated'");fixed=pd.read_csv(root/'fixed_genes.csv');rank=pd.read_csv(root/'confidence.csv');near=pd.read_csv(root/'near_neighbors.csv').query("universe=='catalogue'");fig,axes=plt.subplots(2,2,figsize=(9,6.4),layout='constrained');a,b,c,d=axes.flat;blue='#286799';orange='#ad4a21'
    for i,(label,df) in enumerate([('Wood → Parse',direct),('Parse → Wood',reverse)]):
        q=df.pivot(index='ligand',columns='model',values='rmse');a.bar(np.arange(2)+(i-.5)*.34,(q.half-q.own).reindex(['IL-2','IL-4']),.33,label=label,color=[blue,orange][i]);
    a.axhline(0,color='gray',lw=.8);a.set(xticks=[0,1],xticklabels=['IL-2','IL-4'],ylabel='RMSE change: blend minus own',title='A   Pooling reverses with direction');a.legend(frameon=False,fontsize=8)
    ys=np.arange(4);names=['IL-13','IL-4','IFN-gamma','IL-10'];q=fixed.pivot(index='ligand',columns='candidates',values='rank').loc[names];b.hlines(ys,q[4],q[90],color='0.7');b.scatter(q[4],ys,s=76,facecolors='white',edgecolors=blue,label='4 candidates');b.scatter(q[90],ys,s=18,color=orange,label='90 candidates');b.set(xlabel='Rank of correct label (1 = best)',yticks=ys,yticklabels=['IL-13','IL-4','IFN-γ','IL-10'],xticks=[1,5,10,15,19],title='B   Same 2,745 macrophage genes');b.invert_yaxis();b.legend(frameon=False,fontsize=8,loc='center right')
    order=['Wood','Kang','Yuan','Xue','Waddell','GSE12198','GSE22886'];g=rank.groupby('study').correct.agg(['sum','size']).loc[order];ys=np.arange(len(g));c.barh(ys,g['size'],color='#e6e8eb');c.barh(ys,g['sum'],color=blue);c.set(yticks=ys,yticklabels=order,xlabel='Number of contrasts (blue = correct at rank 1)',title='C   Forced calls among 90 candidates',xticks=[0,2,4,6,8]);c.invert_yaxis()
    for i,part in enumerate(['shared','difference']):
        z=near[near.component.eq(part)];d.scatter(np.full(len(z),i)-.08,z.within_xue_loo_rho,s=28,color=blue,label='Within Xue (held-out donor)' if i==0 else None);d.scatter(i+.08,z.cross_study_rho.iloc[0],marker='D',s=35,color=orange,label='Across studies' if i==0 else None)
    d.axhline(0,color='gray',lw=.8);d.set(xlim=(-.5,1.5),ylim=(-.8,1.08),ylabel='Spearman correlation',xticks=[0,1],xticklabels=['Shared response','IL-4 minus IL-13'],title='D   Shared versus distinguishing genes');d.legend(frameon=False,fontsize=8,loc='upper right')
    for ax in axes.flat:ax.spines[['top','right']].set_visible(False);ax.title.set_fontsize(11)
    fig.savefig(root/'validation.png',dpi=170);plt.close(fig)

if __name__=='__main__':draw(Path(__file__).resolve().parent/'results')
