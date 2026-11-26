"""Plant chloroplast rbcL pilot: design on rice, select on six genera, test on six other genera."""
import argparse
import csv
import hashlib
import time
from collections import Counter
from pathlib import Path

import primer3
import requests
from Bio import SeqIO
from Bio.Seq import reverse_complement

HERE = Path(__file__).resolve().parent
TRAIN = {'Oryza', 'Triticum', 'Hordeum', 'Avena', 'Sorghum', 'Setaria'}
TEST = {'Zea', 'Panicum', 'Brachypodium', 'Festuca', 'Lolium', 'Poa'}
RICE = 'NC_001320.1'
# Published grass rbcL primers (Frontiers in Plant Science 2022, Table 1).
PUBLISHED = ('CCGCCTCATGGTATCCAAGTTGAAAG', 'ATTTCGCGTTCCCCTTCTAACTTACC')


def panel(cache):
    ids = (HERE / 'accessions.txt').read_text().splitlines()
    hashes = (HERE / 'batch-sha256.txt').read_text().splitlines()
    by_species = {}
    template = None
    seen = set()
    for i in range(0, len(ids), 12):
        expected = ids[i:i+12]
        p = cache / f'batch{i//12:02}.gb'
        if not p.exists():
            r = requests.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', params={
                'db':'nuccore', 'id':','.join(expected), 'rettype':'gbwithparts', 'retmode':'text'}, timeout=90)
            r.raise_for_status()
            p.write_bytes(r.content)
            time.sleep(.4)
        if hashlib.sha256(p.read_bytes()).hexdigest() != hashes[i//12]:
            raise ValueError(f'Source changed: {p}; inspect record revision before using')
        batch = list(SeqIO.parse(p, 'genbank'))
        if {x.id for x in batch} != set(expected):
            raise ValueError(f'Accession mismatch: {p}')
        for rec in batch:
            org = rec.annotations['organism'].split()
            if len(org) < 2 or org[0] not in TRAIN | TEST or not org[1].isalpha() or org[1] in {'sp','cf','x','aff'} or ' x ' in ' '.join(org):
                continue
            species = ' '.join(org[:2])
            if rec.id == RICE:
                template = str(next(f for f in rec.features if f.type == 'CDS' and f.qualifiers.get('gene') == ['rbcL']).extract(rec.seq)).upper()
            if species not in by_species or rec.id < by_species[species][0]:
                dna = str(rec.seq).upper()
                by_species[species] = (rec.id, dna, reverse_complement(dna))
            seen.add(rec.id)
    if not template:
        raise ValueError('Missing rice rbcL template')
    print(f'{len(ids)} accessions; {len(seen)} eligible records; {len(by_species)} distinct binomials')
    return template, by_species


def candidates(template):
    pairs = {}
    # Cover multiple parts of the gene rather than selecting variants of a single binding site.
    for start in range(0, len(template)-419, 120):
        design = primer3.bindings.design_primers({'SEQUENCE_TEMPLATE':template[start:start+420]},
            {'PRIMER_PRODUCT_SIZE_RANGE':[[180,350]], 'PRIMER_NUM_RETURN':10})
        for i in range(design['PRIMER_PAIR_NUM_RETURNED']):
            pair = tuple(design[f'PRIMER_{side}_{i}_SEQUENCE'] for side in ('LEFT','RIGHT'))
            pairs[pair] = min(pairs.get(pair,float('inf')),design[f'PRIMER_PAIR_{i}_PENALTY'])
    return pairs


def product(pair, record):
    """Require exactly one inward-facing exact product on the circular plastome, both strands."""
    left, right = pair
    end = reverse_complement(right)
    found = []
    for seq in record[1:]:
        extended = seq + seq[:1600]
        p = extended.find(left)
        while 0 <= p < len(seq):
            stop = p + 1600
            q = extended.find(end, p+len(left), stop)
            while q >= 0:
                amp = extended[p+len(left):q]
                if len(left)+len(amp)+len(end) >= 80:
                    found.append(amp)
                q = extended.find(end,q+1,stop)
            p = extended.find(left,p+1)
    if len(found) != 1:
        return ('multiple' if found else 'no_exact_pair'), ''
    if set(found[0])-set('ACGT'):
        return 'ambiguous_bases',''
    return 'ok', found[0]


def stats(calls, subset):
    freq = Counter(calls[s][1] for s in subset if calls[s][0]=='ok')
    return sum(freq.values()), sum(v==1 for v in freq.values())


def save(path, rows):
    with path.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)


def run(cache, out):
    cache.mkdir(parents=True,exist_ok=True); out.mkdir(parents=True,exist_ok=True)
    template, genomes = panel(cache)
    training = [s for s in genomes if s.split()[0] in TRAIN]
    test = sorted(set(genomes)-set(training))
    pairs = candidates(template)
    records, calls = [], {}
    for pair, penalty in pairs.items():
        hit = {s:product(pair,genomes[s]) for s in training}
        covered, distinct = stats(hit,training)
        calls[pair] = hit
        records.append(dict(left=pair[0],right=pair[1],penalty=penalty,train_n=len(training),covered=covered,distinct=distinct))
    ordered = sorted(records,key=lambda r:(r['penalty'],r['left'],r['right']))
    best = max(ordered,key=lambda r:(r['distinct'],r['covered']))
    models = {'primer3_penalty':(ordered[0]['left'],ordered[0]['right']), 'panel_selected':(best['left'],best['right']), 'published_grass_rbcL':PUBLISHED}
    summary,detail = [],[]
    for model,pair in models.items():
        hit = dict(calls.get(pair,{}))
        for s in genomes:
            if s not in hit: hit[s] = product(pair,genomes[s])
        for split,subset in [('design',training),('heldout',test)]:
            covered, distinct = stats(hit,subset)
            summary.append(dict(method=model,split=split,species=len(subset),genera=len({s.split()[0] for s in subset}),covered=covered,distinct_within_split=distinct))
            freq=Counter(hit[s][1] for s in subset if hit[s][0]=='ok')
            for s in sorted(subset):
                status,amp=hit[s]
                detail.append(dict(method=model,split=split,species=s,accession=genomes[s][0],status=status,insert_length=len(amp),unique_in_split=int(status=='ok' and freq[amp]==1)))
    save(out/'candidates.csv',ordered); save(out/'summary.csv',summary); save(out/'per_species.csv',detail)
    print(f'{len(pairs)} distinct Primer3 candidate pairs');print((out/'summary.csv').read_text())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('cache',type=Path);parser.add_argument('output',type=Path); args=parser.parse_args();run(args.cache,args.output)
