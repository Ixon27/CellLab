"""One descriptive figure: different biological questions in separate panels."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd

ROOT=Path(__file__).resolve().parent; OUT=ROOT/'results'

def draw():
    fig,axes=plt.subplots(1,3,figsize=(13.4,3.9),layout='constrained');ax=axes[0]
    wood=pd.read_csv(ROOT.parent/'cytokine-single/results/macro.csv')
    for ligand,color in [('IL-2','#2166ac'),('IL-4','#b35806')]:
        s=wood[wood.cytokine==ligand].groupby('donors')[['type','half_pool']].mean();ax.plot(s.index,100*(s.half_pool-s.type),marker='o',label=ligand,color=color)
    ax.set_title('A  Human PBMC to PBMC');ax.set_xlabel('Source donors (all available cells)');ax.set_ylabel('Half blend minus own type (pp)');ax.legend(frameon=False);ax.axhline(0,color='gray',lw=.8)
    h=pd.read_csv(OUT/'human_by_study.csv').query("control == 'matched'").sort_values('half_minus_own');ax=axes[1];ax.barh(h.study,100*h.half_minus_own,color='#45847d');ax.axvline(0,color='gray',lw=.8);ax.set_xlabel('Half blend minus own type (pp)');ax.set_title('B  Human PBMC to microarrays')
    c=pd.read_csv(OUT/'coverage.csv').set_index('tasks').loc[['same_tasks_matched','same_tasks_fixed']];ax=axes[2];ax.bar(['Equal list length','100 slots'],100*c.half_minus_own,color=['#777777','#9370aa']);ax.axhline(0,color='gray',lw=.8);ax.set_ylabel('Half blend minus own type (pp)');ax.set_title('C  Mouse to human, same 116 tasks')
    fig.savefig(OUT/'external-validation.png',dpi=180);plt.close(fig)

if __name__=='__main__':draw()
