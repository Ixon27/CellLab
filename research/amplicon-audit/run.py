#!/usr/bin/env python3
"""Pre-flight audit of public paired-end mock-community amplicon data: 16S V4 vs fungal ITS2.

Usage: python run.py [CACHE] [--pairs N] (uniform paired reservoir, default 20,000/library).

Inputs (downloaded into CACHE/raw if missing, every file must match its pinned SHA256):
  mockrobiota (caporaso-lab/mockrobiota @ MOCKROBIOTA_COMMIT): expected-sequences.fasta, taxonomy.tsv,
      dataset-metadata.tsv, sample-metadata.tsv for mock-12, mock-24, mock-25.
  Paired FASTQ from the public mockrobiota S3 bucket (sampling across the whole file).
Outputs: results/ next to this script (derived tables, one figure, provenance). No raw data is copied.

Exploratory preflight, not a replacement for DADA2, vsearch or QIIME 2. Reference-based orientation
and a marker-specific tail clip use knowledge unavailable in an uncharacterized sample.
Dependencies: NumPy, pandas, SciPy and matplotlib.
"""
import argparse
import gzip
import hashlib
import itertools
import json
import platform
import re
import random
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"

# ---------------------------------------------------------------- fixed design
N_PAIRS = 20_000
TRUNC_Q = 2                # truncate each read at its first base with Q <= 2 (or N), as DADA2 truncQ
MIN_LEN = 50               # reads shorter than this after truncation are discarded
MERGE_MIN_OVERLAP = 20
MERGE_MAX_MM_FRAC = 0.10   # mismatches allowed in the overlap
SEED_K = 12
NEAR_MAX_ED = 3            # variants within this many edits of an expected sequence are "near" (error-like)
CHIMERA_HALF_MAX_ED = 1
MIN_HALF = 40
HEADLINE = {"max_ee": 2.0, "min_count": 2}   # DADA2-style default maxEE=2, singleton removal; fixed up front
GRID_EE = (1.0, 2.0, 5.0)
GRID_MINC = (1, 2, 10)
PRIMER_AUDIT_READS = 20_000
ORIENT_AUDIT_READS = 5_000
ASSIGN_VOTE_FRAC = 0.5
ASSIGN_MAX_CAND = 8
TAIL_CLIP_ITS = 30         # see README: 3' LSU stretch that the ITS reference entries do not contain

MOCKROBIOTA_COMMIT = "b7a161a5f3648be789cde9b88159438cde9689d9"
MR = f"https://raw.githubusercontent.com/caporaso-lab/mockrobiota/{MOCKROBIOTA_COMMIT}/data/"
S3 = "https://s3-us-west-2.amazonaws.com/mockrobiota/latest/"

SHA = {
    "mock-12/forward.fq.gz": "3e9a140d0ab93d464f66d3d3522bfc87adf1d3df9104c3be44af868a86028166",
    "mock-12/reverse.fq.gz": "0faaf426dadcceedbda15d9d96dbf93d463495418cdbdef854176dc05cb9cbba",
    "mock-24/forward.fq.gz": "f77886334d7d20901a054c940fb48f5dbc891e31408a2e44ad0f0e7aa7d014c5",
    "mock-24/reverse.fq.gz": "88bc7a38daa78f1775c4a1842328de779f8f97987b7a460d4736828d60a494da",
    "mock-25/forward.fq.gz": "f01503ce0287a4b63136bb12ca8b16d3a0885897bdc2eb83fb90f731df57bc6a",
    "mock-25/reverse.fq.gz": "777e502e7c0f870b6cd6b3587c9d101d3c23d9784d240dd09a39e6ab6b461c46",
    "mock-12/expected-sequences.fasta": "09da75394f3e23c357388da626fbf8c604acf87b7854c0e69063aef91fb660d2",
    "mock-12/taxonomy.tsv": "83fa0062bcd1003a542c92c744a6a4c5a2daae6231a49e06ae6e9f419bd02ff1",
    "mock-12/dataset-metadata.tsv": "09d7c170470889b17e8769e0a7948c0f8b20e49c6d0a1cd858004308540e7aee",
    "mock-12/sample-metadata.tsv": "fa8e22c331608da9971cb1590512e942453519f6fcf56a66b8ad0f53f7bd923f",
    "mock-24/expected-sequences.fasta": "778f65d7608ecdbc4e0d82b5a311b77919d8a2397bfb970bed75de7dd9959e28",
    "mock-24/taxonomy.tsv": "ecc2383013200e2aa0bd9e6306a06768323b1e5d1c8cec58c015434ba968276b",
    "mock-24/dataset-metadata.tsv": "dc95ecf97f2ac965ad48e6b2771d9a4d9dd388e81e8de42f5a633dc513ff218c",
    "mock-24/sample-metadata.tsv": "8b1365c78246a582b279d1d6be082adf549ac5013d535fef706d878fdae7292c",
    "mock-25/expected-sequences.fasta": "778f65d7608ecdbc4e0d82b5a311b77919d8a2397bfb970bed75de7dd9959e28",
    "mock-25/taxonomy.tsv": "0a5a897d066f7ff8bf2f8d1db440d967c59bf8e287e48dfa879f3e297f1a13b0",
    "mock-25/dataset-metadata.tsv": "c2604e3be5fd44bb3b1bc99b7f0b886c0ed1fff453b23b288c64022dfc79df95",
    "mock-25/sample-metadata.tsv": "8b1365c78246a582b279d1d6be082adf549ac5013d535fef706d878fdae7292c",
}

# (fwd primer, rev primer) are the sequences stated in each mock's sample-metadata.tsv.
DATASETS = {
    "mock-12": dict(marker="16S V4", fwd="GTGCCAGCMGCCGCGGTAA", rev="GGACTACHVGGGTWTCTAAT",
                    tail_clip=0, name_aliases={},
                    study="Callahan 2016 'Extreme' mock, 27 strains, MiSeq 2x251 (doi:10.1038/nmeth.3869)"),
    "mock-24": dict(marker="ITS2 (fungal)", fwd="AACTTTYRRCAAYGGATCWCT", rev="AGCCTCCGCTTATTGATATGCTTAART",
                    tail_clip=TAIL_CLIP_ITS, name_aliases={"Tricholoma vacinnium": "Tricholoma vaccinum"},
                    study="Taylor 2016 'Mock A', 8 fungi, uneven, MiSeq 2x250 (doi:10.1128/AEM.02576-16)"),
    "mock-25": dict(marker="ITS2 (fungal)", fwd="AACTTTYRRCAAYGGATCWCT", rev="AGCCTCCGCTTATTGATATGCTTAART",
                    tail_clip=TAIL_CLIP_ITS, name_aliases={"Tricholoma vacinnium": "Tricholoma vaccinum"},
                    study="Taylor 2016 'Mock B', same 8 fungi, different uneven mixing (doi:10.1128/AEM.02576-16)"),
}

IUPAC = {"A": "A", "C": "C", "G": "G", "T": "T", "R": "AG", "Y": "CT", "S": "CG", "W": "AT", "K": "GT",
         "M": "AC", "B": "CGT", "D": "AGT", "H": "ACT", "V": "ACG", "N": "ACGT"}
COMP = str.maketrans("ACGTRYSWKMBDHVNacgtn", "TGCAYRSWMKVHDBNtgcan")
ERR = 10.0 ** (-(np.arange(256) - 33) / 10.0)   # phred+33 -> error probability


def rc(s):
    return s.translate(COMP)[::-1]


def iupac_re(p):
    return re.compile("".join(f"[{IUPAC[c]}]" if len(IUPAC[c]) > 1 else c for c in p))


def mm_iupac(p, s):
    return sum(1 for a, b in zip(p, s) if b not in IUPAC[a])


# ---------------------------------------------------------------- data access
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def url_of(rel):
    ds, name = rel.split("/")
    if name.endswith(".fq.gz"):
        return f"{S3}{ds}/mock-{'forward' if name.startswith('forward') else 'reverse'}-read.fastq.gz"
    if name in ("expected-sequences.fasta", "taxonomy.tsv"):
        return f"{MR}{ds}/source/{name}"
    return f"{MR}{ds}/{name}"


def fetch_all(cache):
    raw = cache / "raw"
    for rel, want in SHA.items():
        p = raw / rel
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            print(f"downloading {url_of(rel)}", file=sys.stderr)
            urllib.request.urlretrieve(url_of(rel), p.with_suffix(p.suffix + ".part"))
            p.with_suffix(p.suffix + ".part").rename(p)
        got = sha256(p)
        if got != want:
            sys.exit(f"SHA256 mismatch for {rel}: {got} != {want}")
    return raw


def read_fasta(path):
    out = []
    for line in open(path):
        line = line.strip()
        if line.startswith(">"):
            out.append([line[1:], []])
        elif line:
            out[-1][1].append(line.upper())
    return [(h, "".join(s)) for h, s in out]


def fastq_pairs(p1, p2, n):
    if n < 1:
        raise ValueError("positive pair count required")
    rng, sample = random.Random(2026), []
    with gzip.open(p1, "rb") as f1, gzip.open(p2, "rb") as f2:
        for i, (left, right) in enumerate(zip(zip(*[iter(f1)]*4, strict=True), zip(*[iter(f2)]*4, strict=True), strict=True)):
            if left[0].split()[0].rsplit(b".",1)[0] != right[0].split()[0].rsplit(b".",1)[0]:
                raise ValueError("Unpaired FASTQ records")
            slot = i if i < n else rng.randrange(i+1)
            if slot >= n:
                continue
            pair = left[1].strip().decode(),left[3].strip(),right[1].strip().decode(),right[3].strip()
            if i < n: sample.append(pair)
            else: sample[slot] = pair
    yield from sample


# ---------------------------------------------------------------- expected community
def taxon_key(label):
    """Binomial (or 'Genus sp. X') from a strain/GenBank-style label; the same rule is used on both files."""
    toks = label.replace(",", " ").split()
    if toks and re.match(r"^[A-Z]{1,2}_?\d+(\.\d+)?$", toks[0]):   # GenBank/RefSeq accession header
        toks = toks[1:]
    if len(toks) > 1 and toks[1] == "sp.":
        return " ".join(toks[:3])
    return " ".join(toks[:2])


def load_expected(raw, ds, cfg):
    tax = pd.read_csv(raw / ds / "taxonomy.tsv", sep="\t")
    col = tax.columns[1]
    exp = defaultdict(float)
    for name, v in zip(tax["Taxonomy"], tax[col]):
        k = taxon_key(name)
        exp[cfg["name_aliases"].get(k, k)] += float(v)
    exp = dict(exp)
    refs = []
    for h, s in read_fasta(raw / ds / "expected-sequences.fasta"):
        k = taxon_key(h)
        refs.append(dict(header=h, taxon=cfg["name_aliases"].get(k, k), seq=s))
    return exp, refs


def locate_core(seq, fwd, rev, marker, maxmm=3):
    """Region of an expected full-length entry that the amplicon is expected to cover (primers excluded).
    16S: between the 515F site and the 806R site. ITS2: after the 5.8S forward-primer site to the end of
    the entry (the ITS4-side primer lies in 28S, which these entries do not contain)."""
    def best(p, s):
        L = len(p)
        sc = [(mm_iupac(p, s[i:i + L]), i) for i in range(len(s) - L + 1)]
        return min(sc) if sc else (99, -1)
    mm, i = best(fwd, seq)
    if mm > maxmm:
        return None
    start = i + len(fwd)
    if marker.startswith("16S"):
        mm2, j = best(rc(rev), seq)
        if mm2 > maxmm or j < start:
            return None
        return seq[start:j]
    return seq[start:]


# ---------------------------------------------------------------- edit distance (Myers / Hyyro bit-vector)
def myers_semiglobal(pat, text):
    """min over substrings of `text` of Levenshtein(pat, substring)."""
    m = len(pat)
    if m == 0:
        return 0
    peq = defaultdict(int)
    for i, c in enumerate(pat):
        peq[c] |= 1 << i
    mask = (1 << m) - 1
    hi = 1 << (m - 1)
    pv, mv, score = mask, 0, m
    best = m
    for c in text:
        eq = peq.get(c, 0)
        xv = eq | mv
        xh = (((eq & pv) + pv) ^ pv) | eq
        ph = mv | ~(xh | pv)
        mh = pv & xh
        if ph & hi:
            score += 1
        elif mh & hi:
            score -= 1
        ph = (ph << 1) & mask
        mh = (mh << 1) & mask
        pv = mh | ~(xv | ph)
        mv = ph & xv
        pv &= mask
        mv &= mask
        if score < best:
            best = score
    return best


def lev_dp(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def selftest():
    rng = np.random.default_rng(1)
    for _ in range(300):
        t = "".join(rng.choice(list("ACGT"), rng.integers(5, 40)))
        p = "".join(rng.choice(list("ACGT"), rng.integers(3, 20)))
        want = min(lev_dp(p, t[i:j]) for i in range(len(t) + 1) for j in range(i, len(t) + 1))
        assert myers_semiglobal(p, t) == want, (p, t)


# ---------------------------------------------------------------- reference index and classifier
class Index:
    def __init__(self, refs, k=SEED_K):
        self.k = k
        self.refs = refs
        self.kmers = defaultdict(set)
        for ri, r in enumerate(refs):
            s = r["core"]
            for i in range(len(s) - k + 1):
                self.kmers[s[i:i + k]].add(ri)
        self.cache = {}

    def best(self, seq):
        """(min edit distance, tuple of reference indices achieving it) over vote-selected candidates."""
        if seq in self.cache:
            return self.cache[seq]
        votes = Counter()
        for i in range(0, len(seq) - self.k + 1, 4):
            for ri in self.kmers.get(seq[i:i + self.k], ()):
                votes[ri] += 1
        if not votes:
            res = (None, ())
        else:
            top = max(votes.values())
            cand = [ri for ri, v in votes.most_common(ASSIGN_MAX_CAND) if v >= ASSIGN_VOTE_FRAC * top]
            eds = {ri: myers_semiglobal(seq, self.refs[ri]["core"]) for ri in cand}
            m = min(eds.values())
            res = (m, tuple(sorted(ri for ri, e in eds.items() if e == m)))
        self.cache[seq] = res
        return res

    def classify(self, seq, tail_clip):
        core = seq[:len(seq) - tail_clip] if tail_clip else seq
        ed, rs = self.best(core)
        if ed is None:
            return "no_seed", ""
        taxa = sorted({self.refs[r]["taxon"] for r in rs})
        if ed <= NEAR_MAX_ED:
            if len(taxa) > 1:
                return "ambiguous", ";".join(taxa)
            return ("exact" if ed == 0 else "near"), taxa[0]
        if len(core) >= 2 * MIN_HALF:
            h = len(core) // 2
            e1, r1 = self.best(core[:h])
            e2, r2 = self.best(core[h:])
            if (e1 is not None and e2 is not None and e1 <= CHIMERA_HALF_MAX_ED and e2 <= CHIMERA_HALF_MAX_ED
                    and not set(r1) & set(r2)):
                return "chimera_like", ""
        return "other", ""


# ---------------------------------------------------------------- reads: truncate, merge
def trunc(seq, qual):
    q = np.frombuffer(qual, dtype=np.uint8)
    bad = (q <= 33 + TRUNC_Q) | (np.frombuffer(seq.encode(), dtype=np.uint8) == 78)
    n = int(np.argmax(bad)) if bad.any() else len(seq)
    return seq[:n], ERR[q[:n]]


def merge(a, pa, b, pb):
    """a: read in reference orientation (starts at amplicon start); b: reverse complement of the other read
    (ends at amplicon end). Returns (merged, overlap_len) or None."""
    k = SEED_K
    for off in range(0, min(len(b) - k, 8 * k) + 1, k):
        seed = b[off:off + k]
        pos = a.find(seed)
        tries = 0
        while pos >= 0 and tries < 4:
            start = pos - off                  # position in `a` where b[0] would sit
            tries += 1
            bs, ps = 0, pb
            if start < 0:
                bs = -start
                start = 0
            bb = b[bs:]
            pbb = pb[bs:]
            ov = min(len(a) - start, len(bb))
            if ov >= MERGE_MIN_OVERLAP:
                x = np.frombuffer(a[start:start + ov].encode(), dtype=np.uint8)
                y = np.frombuffer(bb[:ov].encode(), dtype=np.uint8)
                mism = int((x != y).sum())
                if mism <= MERGE_MAX_MM_FRAC * ov:
                    pick_b = pbb[:ov] < pa[start:start + ov]
                    cons = np.where(pick_b, y, x).tobytes().decode()
                    pe = np.minimum(pbb[:ov], pa[start:start + ov])
                    ee = float(pa[:start].sum() + pe.sum() + pbb[ov:].sum())
                    return a[:start] + cons + bb[ov:], ov, ee
            pos = a.find(seed, pos + 1)
    return None


# ---------------------------------------------------------------- audits
def primer_audit(raw, ds, cfg):
    rows = []
    pats = {"fwd": cfg["fwd"], "rev": cfg["rev"]}
    for rd in ("forward", "reverse"):
        n = 0
        starts = {k: 0 for k in pats}
        anywhere = {f"{k}{s}": 0 for k in pats for s in ("", "_rc")}
        res = {f"{k}{s}": iupac_re(p if s == "" else rc(p)) for k, p in pats.items() for s in ("", "_rc")}
        with gzip.open(raw / ds / f"{rd}.fq.gz", "rt") as f:
            for i, line in enumerate(f):
                if i % 4 != 1:
                    continue
                seq = line.strip()
                n += 1
                for k, p in pats.items():
                    if mm_iupac(p, seq[:len(p)]) <= 2:
                        starts[k] += 1
                for k, rg in res.items():
                    if rg.search(seq):
                        anywhere[k] += 1
                if n >= PRIMER_AUDIT_READS:
                    break
        row = dict(dataset=ds, read_file=rd, reads=n)
        row.update({f"starts_with_{k}_primer_le2mm": starts[k] / n for k in pats})
        row.update({f"exact_iupac_hit_{k}": v / n for k, v in anywhere.items()})
        rows.append(row)
    return rows


def orientation_audit(raw, ds, refs):
    """Does each read file run along (+) or against (-) the expected-sequence entries? 16-mers at read offsets
    0/30/60 are looked up in the expected entries and in their reverse complements."""
    k = 16
    plus, minus = set(), set()
    for r in refs:
        s = r["seq"]
        for i in range(len(s) - k + 1):
            plus.add(s[i:i + k])
        t = rc(s)
        for i in range(len(t) - k + 1):
            minus.add(t[i:i + k])
    rows = []
    for rd in ("forward", "reverse"):
        c = Counter()
        n = 0
        with gzip.open(raw / ds / f"{rd}.fq.gz", "rt") as f:
            for i, line in enumerate(f):
                if i % 4 != 1:
                    continue
                s = line.strip()
                n += 1
                offs = [s[o:o + k] for o in (0, 30, 60)]
                p = sum(x in plus for x in offs)
                m = sum(x in minus for x in offs)
                c["plus" if p > m else "minus" if m > p else "none"] += 1
                if n >= ORIENT_AUDIT_READS:
                    break
        rows.append(dict(dataset=ds, read_file=rd, reads=n, frac_plus=c["plus"] / n,
                         frac_minus=c["minus"] / n, frac_no_hit_or_tie=c["none"] / n))
    return rows


# ---------------------------------------------------------------- per-dataset pipeline
def run_dataset(raw, ds, cfg, n_pairs):
    exp, refs = load_expected(raw, ds, cfg)
    n_refs_all = len(refs)
    for r in refs:
        r["core"] = locate_core(r["seq"], cfg["fwd"], cfg["rev"], cfg["marker"])
    dropped = [r["header"] for r in refs if r["core"] is None]
    refs = [r for r in refs if r["core"] is not None]
    missing_taxa = sorted(set(exp) - {r["taxon"] for r in refs})
    unexpected_ref_taxa = sorted({r["taxon"] for r in refs} - set(exp))
    idx = Index(refs)
    prim = primer_audit(raw, ds, cfg)
    orient = orientation_audit(raw, ds, refs)
    o = {r["read_file"]: r for r in orient}
    # R1 along the expected entries -> A = R1, B = rc(R2); otherwise the files are swapped.
    swapped = o["forward"]["frac_minus"] > o["forward"]["frac_plus"]

    reads = defaultdict(list)       # merged sequence -> list of max(EE_a, EE_b)... stored as merged-EE
    n_pairs_seen = n_trunc_ok = n_merged = 0
    lens = []
    ov_lens = []
    for s1, q1, s2, q2 in fastq_pairs(raw / ds / "forward.fq.gz", raw / ds / "reverse.fq.gz", n_pairs):
        n_pairs_seen += 1
        a_seq, a_q = (s2, q2) if swapped else (s1, q1)
        b_seq, b_q = (s1, q1) if swapped else (s2, q2)
        a, pa = trunc(a_seq, a_q)
        bt, pbt = trunc(b_seq, b_q)
        if len(a) < MIN_LEN or len(bt) < MIN_LEN:
            continue
        n_trunc_ok += 1
        b = rc(bt)
        pb = pbt[::-1]
        m = merge(a, pa, b, pb)
        if m is None:
            continue
        n_merged += 1
        reads[m[0]].append(round(m[2], 3))
        lens.append(len(m[0]))
        ov_lens.append(m[1])

    # classify every distinct merged sequence that has >=2 reads passing the loosest EE (cheap and bounded);
    # singletons are only ever counted as "singleton_not_aligned".
    ee_max = max(GRID_EE)
    cls = {}
    for seq, ees in reads.items():
        if sum(e <= ee_max for e in ees) >= 2:
            cls[seq] = idx.classify(seq, cfg["tail_clip"])
    n_aligned_variants = len(cls)

    rows, taxa_rows = [], []
    for max_ee, minc in itertools.product(GRID_EE, GRID_MINC):
        c = Counter()
        obs = Counter()
        n_feat = defaultdict(int)
        for seq, ees in reads.items():
            n = sum(e <= max_ee for e in ees)
            if n == 0:
                continue
            if n < minc:
                c["below_min_count"] += n
                continue
            if seq not in cls:
                c["singleton_not_aligned"] += n
                continue
            kind, tx = cls[seq]
            c[kind] += n
            if kind in ("exact", "near"):
                obs[tx] += n
            if kind in ("other", "chimera_like", "no_seed"):
                n_feat[kind] += 1
        kept = sum(v for k, v in c.items() if k not in ("below_min_count",))
        assigned = sum(obs.values())
        e = np.array([exp.get(t, 0.0) for t in sorted(exp)])
        e = e / e.sum()
        ob = np.array([obs.get(t, 0) for t in sorted(exp)], dtype=float)
        of = ob / ob.sum() if ob.sum() else ob
        bc = float(np.abs(e - of).sum() / 2) if ob.sum() else np.nan
        det = int((ob >= 1).sum())
        det10 = int((ob >= 10).sum())
        nz = (ob > 0)
        logr = np.log2((of[nz]) / e[nz]) if nz.any() else np.array([])
        row = dict(dataset=ds, marker=cfg["marker"], max_ee=max_ee, min_count=minc,
                   headline=(max_ee == HEADLINE["max_ee"] and minc == HEADLINE["min_count"]),
                   pairs=n_pairs_seen, trunc_ok=n_trunc_ok, merged=n_merged,
                   merged_frac_of_pairs=n_merged / n_pairs_seen,
                   merged_frac_of_trunc_ok=n_merged / max(1, n_trunc_ok),
                   reads_after_ee_and_min_count=kept, frac_exact=c["exact"] / kept if kept else np.nan,
                   frac_near=c["near"] / kept if kept else np.nan,
                   frac_ambiguous=c["ambiguous"] / kept if kept else np.nan,
                   frac_chimera_like=c["chimera_like"] / kept if kept else np.nan,
                   frac_other=c["other"] / kept if kept else np.nan,
                   frac_no_seed=c["no_seed"] / kept if kept else np.nan,
                   frac_singleton_not_aligned=c["singleton_not_aligned"] / kept if kept else np.nan,
                   n_other_variants=n_feat["other"], n_chimera_like_variants=n_feat["chimera_like"],
                   expected_taxa=len(exp), detected_ge1=det, detected_ge10=det10,
                   bray_curtis_taxon=bc,
                   median_abs_log2_ratio=float(np.median(np.abs(logr))) if len(logr) else np.nan,
                   max_abs_log2_ratio=float(np.max(np.abs(logr))) if len(logr) else np.nan)
        rows.append(row)
        if row["headline"]:
            clen = {}
            for r in refs:
                clen.setdefault(r["taxon"], []).append(len(r["core"]))
            for t in sorted(exp):
                taxa_rows.append(dict(dataset=ds, taxon=t, expected_frac=exp[t] / sum(exp.values()),
                                      reads=int(obs.get(t, 0)),
                                      observed_frac=(obs.get(t, 0) / assigned) if assigned else np.nan,
                                      median_core_len=float(np.median(clen.get(t, [np.nan]))),
                                      n_refs=len(clen.get(t, []))))
    meta = dict(dataset=ds, marker=cfg["marker"], study=cfg["study"], fwd_primer=cfg["fwd"], rev_primer=cfg["rev"],
                files_swapped_relative_to_expected_entries=bool(swapped),
                refs_in_fasta=n_refs_all, refs_with_core=len(refs), refs_without_core=dropped,
                expected_taxa_without_any_ref_core=missing_taxa, ref_taxa_not_in_taxonomy_table=unexpected_ref_taxa,
                merged_len_median=float(np.median(lens)) if lens else None,
                merged_len_p5_p95=[float(np.percentile(lens, 5)), float(np.percentile(lens, 95))] if lens else None,
                overlap_median=float(np.median(ov_lens)) if ov_lens else None,
                distinct_merged_sequences=len(reads), distinct_aligned=n_aligned_variants,
                tail_clip=cfg["tail_clip"])
    return rows, taxa_rows, prim, orient, meta


# ---------------------------------------------------------------- reporting
def figure(taxa, path):
    groups = taxa.groupby("dataset")
    fig, axes = plt.subplots(1, groups.ngroups, figsize=(4.2 * groups.ngroups, 4.2))
    for ax, (ds, d) in zip(np.atleast_1d(axes), groups, strict=True):
        ok = d["reads"] > 0
        ax.loglog(d.loc[ok, "expected_frac"], d.loc[ok, "observed_frac"], "o", color="tab:blue")
        if (~ok).any():
            ax.plot(d.loc[~ok, "expected_frac"], [1e-5] * int((~ok).sum()), "rx", label="0 reads")
            ax.legend(loc="upper left", fontsize=7)
        lim = [1e-5, 1]
        ax.plot(lim, lim, "k:", lw=0.8)
        ax.set_xlim(2e-4, 1)
        ax.set_ylim(lim)
        ax.set_title(f"{ds} ({DATASETS[ds]['marker']})", fontsize=9)
        ax.set_xlabel("expected fraction (published)")
        ax.set_ylabel("observed fraction of assigned reads")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def df_md(df, floatfmt=3):
    return df.to_markdown(index=False, floatfmt=f".{floatfmt}g") if hasattr(df, "to_markdown") else df.to_string(index=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cache", nargs="?", default=str(Path.home() / "tmp" / "celllab-amplicon-audit"))
    ap.add_argument("--pairs", type=int, default=N_PAIRS)
    args = ap.parse_args()
    selftest()
    cache = Path(args.cache)
    raw = fetch_all(cache)
    OUT.mkdir(exist_ok=True)

    all_rows, all_taxa, all_prim, all_orient, metas = [], [], [], [], []
    for ds, cfg in DATASETS.items():
        print(f"== {ds} ({cfg['marker']})", file=sys.stderr)
        rows, taxa, prim, orient, meta = run_dataset(raw, ds, cfg, args.pairs)
        all_rows += rows
        all_taxa += taxa
        all_prim += prim
        all_orient += orient
        metas.append(meta)

    grid = pd.DataFrame(all_rows)
    taxa = pd.DataFrame(all_taxa)
    taxa["log2_obs_over_exp"] = np.log2(taxa["observed_frac"].where(taxa.reads > 0) / taxa["expected_frac"])
    prim = pd.DataFrame(all_prim)
    orient = pd.DataFrame(all_orient)
    grid.to_csv(OUT / "grid.csv", index=False)
    grid[grid["headline"]].to_csv(OUT / "summary.csv", index=False)
    taxa.to_csv(OUT / "taxa_headline.csv", index=False)
    prim.to_csv(OUT / "primer_audit.csv", index=False)
    orient.to_csv(OUT / "orientation_audit.csv", index=False)

    # mock-24 vs mock-25: same 8 species, different mixing; does the *ratio* of observed fractions track the
    # expected ratio? (independent of per-taxon bias that is constant across the two libraries)
    a = taxa[taxa.dataset == "mock-24"].set_index("taxon")
    b = taxa[taxa.dataset == "mock-25"].set_index("taxon")
    cross = pd.DataFrame({
        "expected_log2_ratio_24_over_25": np.log2(a.expected_frac / b.expected_frac),
        "observed_log2_ratio_24_over_25": np.log2(a.observed_frac.where(a.reads > 0) / b.observed_frac.where(b.reads > 0)),
        "reads_24": a.reads, "reads_25": b.reads}).reset_index()
    cross["bias_shift_log2"] = cross["observed_log2_ratio_24_over_25"] - cross["expected_log2_ratio_24_over_25"]
    cross.to_csv(OUT / "its_cross_library_ratio.csv", index=False)
    ok = np.isfinite(cross["observed_log2_ratio_24_over_25"])
    r_cross = float(np.corrcoef(cross.loc[ok, "expected_log2_ratio_24_over_25"],
                                cross.loc[ok, "observed_log2_ratio_24_over_25"])[0, 1]) if ok.sum() > 2 else None

    # does the per-taxon over/under-recovery follow amplicon length (merge-failure bias)?
    from scipy.stats import spearmanr
    lenrows = []
    for ds, d in taxa.groupby("dataset"):
        dd = d[np.isfinite(d["log2_obs_over_exp"])]
        rho = spearmanr(dd["median_core_len"], dd["log2_obs_over_exp"]) if len(dd) > 3 else None
        lenrows.append(dict(dataset=ds, n_taxa=len(dd), spearman_len_vs_log2ratio=float(rho.statistic) if rho else None,
                            p=float(rho.pvalue) if rho else None))
    lenb = pd.DataFrame(lenrows)
    lenb.to_csv(OUT / "length_bias.csv", index=False)

    figure(taxa, OUT / "expected_vs_observed.png")
    prov = dict(python=sys.version.split()[0], platform=platform.platform(), numpy=np.__version__,
                pandas=pd.__version__, mockrobiota_commit=MOCKROBIOTA_COMMIT, pairs_per_dataset=args.pairs,
                sha256=SHA, datasets=metas, its_cross_library_pearson_log2ratio=r_cross,
                constants=dict(TRUNC_Q=TRUNC_Q, MIN_LEN=MIN_LEN, MERGE_MIN_OVERLAP=MERGE_MIN_OVERLAP,
                               MERGE_MAX_MM_FRAC=MERGE_MAX_MM_FRAC, NEAR_MAX_ED=NEAR_MAX_ED, HEADLINE=HEADLINE,
                               GRID_EE=GRID_EE, GRID_MINC=GRID_MINC, TAIL_CLIP_ITS=TAIL_CLIP_ITS))
    (OUT / "provenance.json").write_text(json.dumps(prov, indent=2, default=str))

    h = grid[grid["headline"]].drop(columns=["headline", "marker"])
    lines = ["# Amplicon pre-flight audit: generated report", "",
             f"Uniform sample of {args.pairs} read pairs per mock (seed 2026). Headline setting: maxEE {HEADLINE['max_ee']}, "
             f"min count {HEADLINE['min_count']}.", "",
             "## Orientation of the read files relative to the published expected sequences", "",
             orient.to_string(index=False), "",
             "## Primer state (sample-metadata primers searched in the first reads)", "",
             prim.to_string(index=False), "",
             "## Headline pipeline outcome", "", h.T.to_string(), "",
             "## Per-taxon expected vs observed (headline setting)", "", taxa.to_string(index=False), "",
             "## ITS mock-24 vs mock-25 library-ratio check", "", cross.to_string(index=False), "",
             f"Pearson r of log2 ratios (observed vs expected): {r_cross}", "",
             "## Amplicon length vs recovery", "", lenb.to_string(index=False), "",
             "## Dataset facts", "", json.dumps(metas, indent=1, default=str)]
    (OUT / "report.md").write_text("\n".join(lines))
    print((OUT / "report.md").read_text())


if __name__ == "__main__":
    main()
