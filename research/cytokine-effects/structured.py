"""Tiny simplex regression: enumerate active faces, solve equality-constrained LS."""
from itertools import combinations
import numpy as np


def learn(x):
    n,m,_=x.shape
    if n==1: return np.eye(m)*.5+(1-np.eye(m))*(.5/(m-1))
    train=(x.sum(axis=0)-x)/(n-1)
    gram=np.einsum('dtg,dug->tu',train,train); cross=np.einsum('dtg,dug->tu',train,x)
    best=np.full(m,np.inf);weights=np.zeros((m,m))
    for k in range(1,m+1):
        for face in combinations(range(m),k):
            idx=np.asarray(face); g=gram[np.ix_(idx,idx)]; b=cross[idx]; system=np.ones((k+1,k+1));system[:k,:k]=g;system[-1,-1]=0
            sol=np.linalg.lstsq(system,np.vstack((b,np.ones(m))),rcond=None)[0][:-1];obj=(sol*(g@sol-2*b)).sum(axis=0);keep=(obj<best)&(sol.min(axis=0)>=-1e-9)&np.isclose(sol.sum(axis=0),1)
            for i in np.flatnonzero(keep):
                best[i]=obj[i];weights[i]=0;weights[i,idx]=np.maximum(sol[:,i],0);weights[i]/=weights[i].sum()
    assert np.isfinite(best).all() and np.allclose(weights.sum(axis=1),1);return weights
