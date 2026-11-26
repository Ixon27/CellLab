"""Sensitivity of frozen grass primer pairs to the matching rule; not a PCR model."""
import argparse
import csv
from pathlib import Path
from Bio.Seq import reverse_complement
from run import HERE, PUBLISHED, TEST, panel, save, stats


def sites(text, word):
    # If two strings differ once, at least one of their two non-overlapping halves matches.
    mid = len(word)//2
    seen = set()
    for offset, seed in [(0,word[:mid]), (mid,word[mid:])]:
        pos = text.find(seed)
        while pos >= 0:
            j = pos-offset
            if 0 <= j <= len(text)-len(word) and j not in seen:
                candidate = text[j:j+len(word)]
                if all(c in 'ACGT' for c in candidate) and sum(a!=b for a,b in zip(word,candidate))<=1:
                    seen.add(j)
            pos = text.find(seed,pos+1)
    return sorted(seen)


def relaxed(record,pair):
    left,right=pair; end=reverse_complement(right); found=[]
    for seq in record[1:]:
        text=seq+seq[:1600]
        starts=sites(text,left); ends=sites(text,end)
        for p in starts:
            if p>=len(seq): break
            for q in ends:
                if 80<=q+len(end)-p<=1600 and q>=p+len(left): found.append(text[p+len(left):q])
    return ('ok',found[0]) if len(found)==1 and not set(found[0])-set('ACGT') else ('unresolved','')


def main(cache,out):
    _,records=panel(cache); test=[s for s in records if s.split()[0] in TEST]
    with (out/'candidates.csv').open() as f: rows=list(csv.DictReader(f))
    best=max(rows,key=lambda r:(int(r['distinct']),int(r['covered'])))
    pairs=[('primer3_penalty',(rows[0]['left'],rows[0]['right'])),('panel_selected',(best['left'],best['right'])),('published_grass_rbcL',PUBLISHED)]
    summary=[]
    for name,pair in pairs:
        calls={s:relaxed(records[s],pair) for s in test}; n,u=stats(calls,test)
        summary.append(dict(method=name,heldout_species=len(test),one_mismatch_covered=n,one_mismatch_distinct=u))
    save(out/'sensitivity.csv',summary); print((out/'sensitivity.csv').read_text())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args(); main(args.cache,args.output)
