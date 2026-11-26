#!/usr/bin/env python3
"""Does the screen-consensus conclusion change when the assays share a concentration window?

Usage: python dose_window.py CACHE [--results DIR] [--audit-only]

Requires the outputs of ../screen-consensus/prepare.py in CACHE (matched.csv, cell_crosswalk.csv,
drug_crosswalk.csv). Downloads the extra pinned files of sources.json (md5-verified, outside git).

Analyses (all fixed before any endpoint of this study was computed):

 1. RANGE AUDIT (metadata only, no refit). For every matched drug: the modal GDSC1/GDSC2 concentration
    window (MIN_CONC..MAX_CONC of the release-8.5 fitted table, cells in the matched cohort) and the PRISM
    dose ladder. Their intersection is the common window. cov_gX = log10 width of the common window /
    log10 span of the GDSC window X. A drug is "comparable" when cov_g1 and cov_g2 are both >= 0.9, i.e.
    both GDSC windows lie (almost) entirely inside the PRISM range and agree with each other. PRISM always
    integrates ~1.8 extra decades; that cannot be removed by stratification, only by truncation (analysis 2).
 2. STRATIFICATION OF THE PUBLISHED RESULT (no refit). Per-drug precision@10% from the previous study
    (../screen-consensus/results/per_drug.csv, published AUCs), split by window comparability.
 3. RAW COMMON-WINDOW REFIT. GDSC release-8.5 public raw plate intensities are normalised per plate
    (blank B -> 0, DMSO/untreated negative control -> 1; plates with Z' <= 0 or <4 control wells dropped),
    PRISM collapsed log2-fold-change is converted to viability (2**lfc). For each drug/cell the SAME
    estimator is applied to all three assays over the SAME log-dose window (common window above):
      common_4pl (PRIMARY, fixed in advance): 4-parameter log-logistic, top fixed at 1, bottom in [0,1],
        log10-EC50/Hill slope by grid search with closed-form bottom, fitted only on doses inside the
        window; AUC = mean fitted viability over the window. Needs >= 4 in-window doses in every assay and
        measured doses reaching both window edges (5% tolerance).
      common_interp  (sensitivity): no model; linear interpolation of dose-median viability, in-window doses.
      common_4pl_alldata (sensitivity): same 4PL fitted to ALL measured doses, integrated over the window.
    Control arms on the identical drug/cell pairs: published_subset (published AUCs) and refit_native (the
    same 4PL on all data integrated over each assay's own native range). native vs common isolates the
    effect of harmonising the window; published vs native isolates our refit/QC choices.
    Endpoint code is the previous study's evaluate.py (same precision@k, ties, bootstrap, seed).
This is a refit on raw data, NOT the GDSC NLME fit nor the PRISM drc fit; refit_validation.csv reports how
closely the refit reproduces the published AUC ranks.
"""
import argparse
import contextlib
import io
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
PRIOR = HERE.parent / 'screen-consensus'
sys.path.insert(0, str(PRIOR))
import evaluate  # noqa: E402  previous study's endpoint code (precision@k, ties, bootstrap)
import prepare  # noqa: E402  previous study's pinned download/md5 helpers

COMPARABLE = 0.9          # cov_g1, cov_g2 >= this => comparable windows
COVERAGE_SENSITIVITY = (0.75, 0.9, 0.95)
MIN_WIDTH = 1.0           # decades of common window needed for a refit
MIN_POINTS = 4            # in-window doses per assay
TOL = math.log10(1.05)    # 5% dose tolerance at window edges
FRACTION = 0.1
MIN_DRUG_PAIRS = 50
BOOT, SEED = 10000, 2026
HILL = np.array([0.5, 1, 2, 3, 5, 8])   # log10-dose Hill slopes searched
NEG_TAG = {1: 'NC-0', 2: 'NC-1'}         # untreated (GDSC1) / DMSO (GDSC2) negative control
LIB_TAG = r'^L\d+-D\d+-S$'
ARMS = ['published_subset', 'refit_native', 'common_4pl', 'common_interp', 'common_4pl_alldata']
PRIMARY = 'common_4pl'


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def sig4(x):
    return float(f'{x:.4g}')


# ------------------------------------------------------------------ sources
def pinned(cache):
    src = json.loads((PRIOR / 'sources.json').read_text())['files']
    own = json.loads((HERE / 'sources.json').read_text())['files']
    return src, own


def fetch(cache, src, own):
    paths = {}
    for key in ('gdsc1', 'gdsc2'):
        paths[key] = prepare.ensure(str(cache), key, src[key])
    for key, entry in own.items():
        paths[key] = prepare.ensure(str(cache), key, entry)
    return {k: Path(v) for k, v in paths.items()}


def gdsc_windows(cache, key, entry, path):
    """MIN_CONC/MAX_CONC of the fitted table (release 8.5). Read xlsx once, cache keyed by md5."""
    red = cache / f"{key}.windows.{entry['md5'][:8]}.csv"
    if red.exists():
        return pd.read_csv(red)
    import openpyxl
    log(f'reading {path} for concentration windows (slow, cached afterwards)')
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    ws.reset_dimensions()
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    cols = ['COSMIC_ID', 'DRUG_ID', 'MIN_CONC', 'MAX_CONC']
    idx = [header.index(c) for c in cols]
    df = pd.DataFrame([tuple(r[i] for i in idx) for r in it], columns=cols)
    df.to_csv(str(red) + '.part', index=False)
    Path(str(red) + '.part').replace(red)
    return df


def load_cohort(cache):
    need = ['matched.csv', 'cell_crosswalk.csv', 'drug_crosswalk.csv']
    missing = [n for n in need if not (cache / n).exists()]
    if missing:
        sys.exit(f'{missing} missing in {cache}; run ../screen-consensus/prepare.py first')
    matched = pd.read_csv(cache / 'matched.csv', keep_default_na=False)
    cells = pd.read_csv(cache / 'cell_crosswalk.csv', dtype=str, keep_default_na=False)
    drugs = pd.read_csv(cache / 'drug_crosswalk.csv', dtype=str, keep_default_na=False)
    matched = matched.merge(cells[['cell', 'cosmic_id']], on='cell', validate='m:1')
    matched['cosmic_id'] = matched.cosmic_id.astype(int)
    return matched, drugs


# ------------------------------------------------------------------ analysis 1: audit
def modal_window(win):
    keys = win[['MIN_CONC', 'MAX_CONC']].map(sig4)
    counts = pd.Series(list(map(tuple, keys.to_numpy()))).value_counts()
    (lo, hi), n = counts.index[0], counts.iloc[0]
    return lo, hi, n / len(win), len(counts)


def window_audit(matched, drugs, windows, prism_doses):
    rows = []
    for r in drugs.itertuples():
        cosmic = set(matched.loc[matched.drug == r.drug, 'cosmic_id'])
        row = dict(drug=r.drug, n_cells=len(cosmic))
        wins = {}
        for k in (1, 2):
            w = windows[k]
            w = w[(w.DRUG_ID == int(getattr(r, f'gdsc{k}_drug_id'))) & w.COSMIC_ID.isin(cosmic)]
            lo, hi, frac, nwin = modal_window(w)
            wins[k] = (lo, hi)
            row.update({f'g{k}_lo': lo, f'g{k}_hi': hi, f'g{k}_modal_frac': frac, f'g{k}_n_windows': nwin})
        d = prism_doses[r.drug]
        row.update(prism_lo=d.min(), prism_hi=d.max(), prism_n_doses=len(d), prism_screen=r.prism_screen)
        lo = max(wins[1][0], wins[2][0], d.min())
        hi = min(wins[1][1], wins[2][1], d.max())
        width = math.log10(hi / lo) if hi > lo else 0.0
        span = {k: math.log10(wins[k][1] / wins[k][0]) for k in (1, 2)}
        span_p = math.log10(d.max() / d.min())
        row.update(common_lo=lo, common_hi=hi, common_width_log10=width, span_g1=span[1], span_g2=span[2],
                   span_prism=span_p, cov_g1=width / span[1], cov_g2=width / span[2])
        row['cov_min'] = min(row['cov_g1'], row['cov_g2'])
        row['g1_g2_edge_gap_log10'] = max(abs(math.log10(wins[1][0] / wins[2][0])),
                                          abs(math.log10(wins[1][1] / wins[2][1])))
        row['prism_extra_decades'] = span_p - width
        row['comparable'] = bool(row['cov_min'] >= COMPARABLE)
        rows.append(row)
    return pd.DataFrame(rows)


def boot_mean(x, rng):
    x = np.asarray(x, float)
    idx = rng.integers(len(x), size=(BOOT, len(x)))
    m = x[idx].mean(axis=1)
    return x.mean(), *np.quantile(m, [.025, .975])


def boot_diff(a, b, rng):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ma = a[rng.integers(len(a), size=(BOOT, len(a)))].mean(axis=1)
    mb = b[rng.integers(len(b), size=(BOOT, len(b)))].mean(axis=1)
    return a.mean() - b.mean(), *np.quantile(ma - mb, [.025, .975])


def spearman(a, b):
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 3:
        return np.nan
    return pd.Series(a[ok]).corr(pd.Series(b[ok]), method='spearman')


def prior_per_drug():
    path = PRIOR / 'results' / 'per_drug.csv'
    t = pd.read_csv(path)
    t = t[np.isclose(t.fraction, FRACTION)]
    p = t.pivot(index='drug', columns='model', values='precision')
    p['random'] = t[t.model == 'consensus'].set_index('drug').random
    p['n'] = t[t.model == 'consensus'].set_index('drug').n
    return p.reset_index()


def stratified_published(audit, prior):
    d = prior.merge(audit, on='drug', validate='1:1')
    d['gain_vs_gdsc1'] = d.consensus - d.gdsc1
    d['gain_vs_gdsc2'] = d.consensus - d.gdsc2
    d['gain_vs_mean_single'] = d.consensus - (d.gdsc1 + d.gdsc2) / 2
    rng = np.random.default_rng(SEED)
    out = []
    for thr in COVERAGE_SENSITIVITY:
        comp = d.cov_min >= thr
        for col in ['gain_vs_gdsc1', 'gain_vs_gdsc2', 'gain_vs_mean_single']:
            for name, sub in (('comparable', d[comp]), ('not_comparable', d[~comp])):
                if len(sub) >= 2:
                    m, lo, hi = boot_mean(sub[col], rng)
                else:
                    m = lo = hi = np.nan
                out.append(dict(threshold=thr, measure=col, stratum=name, drugs=len(sub), mean=m, low95=lo, high95=hi,
                                precision_consensus=sub.consensus.mean(), precision_gdsc1=sub.gdsc1.mean(),
                                precision_gdsc2=sub.gdsc2.mean(), chance=sub.random.mean(),
                                pairs=int(sub.n.sum())))
            a, b = d.loc[comp, col], d.loc[~comp, col]
            if len(a) >= 2 and len(b) >= 2:
                m, lo, hi = boot_diff(a, b, rng)
            else:
                m = lo = hi = np.nan
            out.append(dict(threshold=thr, measure=col, stratum='comparable - not_comparable', drugs=len(d),
                            mean=m, low95=lo, high95=hi))
    for col in ['gain_vs_gdsc1', 'gain_vs_gdsc2', 'gain_vs_mean_single']:
        out.append(dict(threshold=np.nan, measure=col, stratum='all drugs', drugs=len(d), mean=d[col].mean(),
                        low95=boot_mean(d[col], rng)[1], high95=boot_mean(d[col], rng)[2]))
        out.append(dict(threshold=np.nan, measure=col, stratum='spearman_vs_cov_min', drugs=len(d),
                        mean=spearman(d.cov_min.to_numpy(), d[col].to_numpy())))
    return pd.DataFrame(out), d


# ------------------------------------------------------------------ analysis 3: raw curves
def reduce_raw(cache, k, entry, path, cells, drug_ids, flow):
    """Stream the public raw plate file, keep cohort wells + their plate controls, normalise per plate."""
    tag = f'{abs(hash(())) if False else ""}'
    sig = prepare.hashlib.md5(json.dumps([sorted(cells), sorted(drug_ids)]).encode()).hexdigest()[:8]
    dest = cache / f'gdsc{k}.viability.{entry["md5"][:8]}.{sig}.csv'
    qc_path = Path(str(dest) + '.qc.json')
    if dest.exists() and qc_path.exists():
        flow[f'gdsc{k}_plates'] = json.loads(qc_path.read_text())
        return pd.read_csv(dest)
    neg = NEG_TAG[k]
    cols = ['SCAN_ID', 'COSMIC_ID', 'TAG', 'DRUG_ID', 'CONC', 'INTENSITY']
    keep = []
    log(f'streaming {path.name} (GDSC{k} raw, several minutes, cached afterwards)')
    with zipfile.ZipFile(path) as z, z.open(z.namelist()[0]) as f:
        for chunk in pd.read_csv(f, usecols=cols, dtype={'TAG': str}, chunksize=2_000_000):
            chunk = chunk[chunk.COSMIC_ID.isin(cells)]
            ctrl = chunk.TAG.isin([neg, 'B'])
            lib = chunk.TAG.str.match(LIB_TAG) & chunk.DRUG_ID.isin(drug_ids)
            keep.append(chunk[ctrl | lib])
    d = pd.concat(keep, ignore_index=True)
    ctrl = d.TAG.isin([neg, 'B'])
    c = d[ctrl].groupby(['SCAN_ID', 'TAG']).INTENSITY.agg(['count', 'mean', 'std']).unstack()
    n_neg, n_blank = c['count'][neg], c['count']['B']
    m_neg, m_blank = c['mean'][neg], c['mean']['B']
    zprime = 1 - 3 * (c['std'][neg] + c['std']['B']) / (m_neg - m_blank)
    plates = pd.DataFrame(dict(neg=m_neg, blank=m_blank, ok=(n_neg >= 4) & (n_blank >= 4) & (m_neg > m_blank)
                               & (zprime > 0)))
    lib = d[~ctrl & d.SCAN_ID.isin(d[ctrl].SCAN_ID.unique())].copy()
    plates_with_lib = lib.SCAN_ID.unique()
    qc = dict(plates_with_cohort_titrations=int(len(plates_with_lib)),
              plates_failing_control_qc=int((~plates.loc[plates.index.intersection(plates_with_lib), 'ok']).sum()),
              plates_without_both_controls=int(len(set(plates_with_lib) - set(plates.index))),
              negative_control=neg, positive_control='B')
    lib = lib.join(plates[plates.ok], on='SCAN_ID', how='inner')
    lib['viab'] = (lib.INTENSITY - lib.blank) / (lib.neg - lib.blank)
    lib = lib[np.isfinite(lib.viab) & lib.CONC.notna()]
    lib['COSMIC_ID'] = lib.COSMIC_ID.astype(int)
    lib['DRUG_ID'] = lib.DRUG_ID.astype(int)
    lib['CONC'] = lib.CONC.map(sig4)
    out = lib.groupby(['DRUG_ID', 'COSMIC_ID', 'CONC'], as_index=False).agg(viab=('viab', 'median'), wells=('viab', 'size'))
    qc['wells_used'] = int(len(lib))
    qc['pair_doses'] = int(len(out))
    out.to_csv(str(dest) + '.part', index=False)
    Path(str(dest) + '.part').replace(dest)
    qc_path.write_text(json.dumps(qc))
    flow[f'gdsc{k}_plates'] = qc
    return out


def gdsc_curves(table):
    return {key: (np.log10(g.CONC.to_numpy()), g.viab.to_numpy())
            for key, g in table.sort_values('CONC').groupby(['DRUG_ID', 'COSMIC_ID'])}


def prism_curves(paths, drugs, matched):
    t = pd.read_csv(paths['prism_collapsed_treatments'], usecols=['column_name', 'broad_id', 'dose', 'screen_id'])
    t = t.merge(drugs[['drug', 'prism_broad_id', 'prism_screen']], left_on=['broad_id', 'screen_id'],
                right_on=['prism_broad_id', 'prism_screen'], validate='m:1')
    header = pd.read_csv(paths['prism_collapsed_lfc'], nrows=0).columns
    pos = {c: i for i, c in enumerate(header)}
    m = pd.read_csv(paths['prism_collapsed_lfc'], usecols=[0, *[pos[c] for c in t.column_name]], index_col=0)
    m = m[m.index.isin(set(matched.cell))]
    viab = np.exp2(m)
    curves, doses = {}, {}
    for drug, g in t.groupby('drug'):
        g = g.sort_values('dose')
        doses[drug] = g.dose.to_numpy()
        sub = viab[g.column_name.tolist()]
        for cell in set(matched.loc[matched.drug == drug, 'cell']):
            if cell in sub.index:
                y = sub.loc[cell].to_numpy()
                if np.isfinite(y).sum() >= MIN_POINTS:
                    ok = np.isfinite(y)
                    curves[(drug, cell)] = (np.log10(g.dose.to_numpy()[ok]), y[ok])
    return curves, doses


def fit_4pl_auc(x, y, lo, hi):
    """Mean fitted viability over log10-dose [lo, hi] of f = bottom + (1-bottom)/(1+10**(h(x-e))).

    Top fixed at 1, bottom in [0, 1]; (e, h) on a grid, bottom closed-form least squares for each grid point.
    Deterministic; no optimiser failures."""
    e = np.arange(x.min() - 1.5, x.max() + 1.5 + 1e-9, 0.05)
    hh, ee = np.meshgrid(HILL, e, indexing='ij')
    hh, ee = hh.ravel(), ee.ravel()
    z = 1 - 1 / (1 + 10 ** (hh[:, None] * (x[None, :] - ee[:, None])))  # 0 -> no effect, 1 -> full effect
    d = y - 1
    num, den = z @ d, (z * z).sum(axis=1)
    c = np.clip(np.divide(num, den, out=np.zeros_like(num), where=den > 1e-12), -1, 0)
    j = int(np.argmin(d @ d - 2 * c * num + c * c * den))
    grid = np.linspace(lo, hi, 201)
    zs = 1 - 1 / (1 + 10 ** (hh[j] * (grid - ee[j])))
    return 1 + c[j] * zs.mean()


def interp_auc(x, y, lo, hi):
    o = np.argsort(x)
    return np.interp(np.linspace(lo, hi, 201), x[o], y[o]).mean()


def in_window(x, y, lo, hi):
    keep = (x >= lo - TOL) & (x <= hi + TOL)
    ok = keep.sum() >= MIN_POINTS and x.min() <= lo + TOL and x.max() >= hi - TOL
    return ok, x[keep], y[keep]


def refit_pairs(matched, audit, c1, c2, cp, drugs):
    ids = drugs.set_index('drug')
    win = audit.set_index('drug')
    rows, reasons = [], []
    for r in matched.itertuples():
        a = win.loc[r.drug]
        lo, hi = math.log10(a.common_lo), math.log10(a.common_hi)
        status = None
        data = {}
        for name, curve in (('g1', c1.get((int(ids.at[r.drug, 'gdsc1_drug_id']), r.cosmic_id))),
                            ('g2', c2.get((int(ids.at[r.drug, 'gdsc2_drug_id']), r.cosmic_id))),
                            ('p', cp.get((r.drug, r.cell)))):
            if curve is None:
                status = f'no_curve_{name}'
                break
            data[name] = curve
        rec = dict(drug=r.drug, cell=r.cell, status=status or 'ok')
        if status is None and a.common_width_log10 < MIN_WIDTH:
            rec['status'] = 'window_narrower_than_1_decade'
        elif status is None:
            sub = {}
            for name, (x, y) in data.items():
                ok, xs, ys = in_window(x, y, lo, hi)
                if not ok:
                    rec['status'] = f'insufficient_in_window_points_{name}'
                    break
                sub[name] = (xs, ys)
            if rec['status'] == 'ok':
                for name, (x, y) in data.items():
                    rec[f'native_{name}'] = fit_4pl_auc(x, y, x.min(), x.max())
                    rec[f'common_4pl_{name}'] = fit_4pl_auc(*sub[name], lo, hi)
                    rec[f'common_interp_{name}'] = interp_auc(*sub[name], lo, hi)
                    rec[f'common_4pl_alldata_{name}'] = fit_4pl_auc(x, y, lo, hi)
        rows.append(rec)
    return pd.DataFrame(rows)


def arm_table(matched, fits, arm):
    pubs = matched[['drug', 'cell', 'tissue', 'gdsc1', 'gdsc2', 'prism']].copy()
    if arm == 'published_subset':
        t = pubs
    else:
        stem = {'refit_native': 'native'}.get(arm, arm)
        cols = {f'{stem}_g1': 'gdsc1', f'{stem}_g2': 'gdsc2', f'{stem}_p': 'prism'}
        t = pubs[['drug', 'cell', 'tissue']].merge(fits[['drug', 'cell', *cols]].rename(columns=cols), on=['drug', 'cell'])
    return t.sort_values(['drug', 'cell'])


def run_arm(table, dest, cache_dir, name):
    path = cache_dir / f'{name}.csv'
    table.to_csv(path, index=False, float_format='%.8g')
    with contextlib.redirect_stdout(io.StringIO()):
        evaluate.write_metrics(path, dest / name, 'prism')
    return pd.read_csv(dest / name / 'per_drug.csv')


def agreement(table):
    rows = []
    for drug, g in table.groupby('drug'):
        rows.append(dict(drug=drug, n=len(g),
                         rho_g1_prism=spearman(g.gdsc1.to_numpy(), g.prism.to_numpy()),
                         rho_g2_prism=spearman(g.gdsc2.to_numpy(), g.prism.to_numpy()),
                         rho_g1_g2=spearman(g.gdsc1.to_numpy(), g.gdsc2.to_numpy())))
    return pd.DataFrame(rows)


def arm_contrasts(per_drug, audit, agree):
    """Paired drug-level contrasts between arms; all = every analysed drug."""
    rng = np.random.default_rng(SEED)
    prec = {}
    for arm, t in per_drug.items():
        t = t[np.isclose(t.fraction, FRACTION)]
        prec[arm] = t.pivot(index='drug', columns='model', values='precision')
    comp = audit.set_index('drug').comparable
    out = []

    def add(label, series, arm_a, arm_b):
        for stratum, mask in (('all', slice(None)), ('comparable', comp.reindex(series.index).fillna(False)),
                              ('not_comparable', ~comp.reindex(series.index).fillna(True))):
            s = series[mask] if not isinstance(mask, slice) else series
            if len(s) >= 2:
                m, lo, hi = boot_mean(s.to_numpy(), rng)
            else:
                m = lo = hi = np.nan
            out.append(dict(contrast=label, arm_a=arm_a, arm_b=arm_b, stratum=stratum, drugs=len(s), mean=m,
                            low95=lo, high95=hi, improved=int((s > 1e-10).sum()), worse=int((s < -1e-10).sum())))

    for arm, p in prec.items():
        add('consensus - gdsc1', p.consensus - p.gdsc1, arm, '')
        add('consensus - gdsc2', p.consensus - p.gdsc2, arm, '')
        add('consensus - mean(gdsc1,gdsc2)', p.consensus - (p.gdsc1 + p.gdsc2) / 2, arm, '')
    ref = prec['published_subset']
    for arm, p in prec.items():
        if arm == 'published_subset':
            continue
        for model in ('gdsc1', 'gdsc2', 'consensus'):
            add(f'precision {model}', p[model] - ref[model], arm, 'published_subset')
        for col, name in (('gdsc1', 'consensus - gdsc1'), ('gdsc2', 'consensus - gdsc2')):
            add(f'gain change: {name}', (p.consensus - p[col]) - (ref.consensus - ref[col]), arm, 'published_subset')
    nat = prec['refit_native']
    for arm in ('common_4pl', 'common_interp', 'common_4pl_alldata'):
        p = prec[arm]
        for col, name in (('gdsc1', 'consensus - gdsc1'), ('gdsc2', 'consensus - gdsc2')):
            add(f'gain change: {name}', (p.consensus - p[col]) - (nat.consensus - nat[col]), arm, 'refit_native')
    ag = []
    for arm, a in agree.items():
        ag.append(a.assign(arm=arm))
    ag = pd.concat(ag)
    base = agree['published_subset'].set_index('drug')
    for arm, a in agree.items():
        if arm == 'published_subset':
            continue
        a = a.set_index('drug')
        for col in ('rho_g1_prism', 'rho_g2_prism', 'rho_g1_g2'):
            add(f'rank agreement change: {col}', a[col] - base[col], arm, 'published_subset')
    return pd.DataFrame(out), ag


def arm_summary(dest):
    rows = []
    for arm in ARMS:
        s = pd.read_csv(dest / arm / 'summary.csv')
        s = s[np.isclose(s.fraction, FRACTION)].set_index('model')
        rows.append(dict(arm=arm, drugs=int(s.drugs.iloc[0]), pairs=int(s.pairs.iloc[0]),
                         gdsc1=s.at['gdsc1', 'precision'], gdsc2=s.at['gdsc2', 'precision'],
                         consensus=s.at['consensus', 'precision'], chance=s.at['gdsc1', 'random']))
    prior = pd.read_csv(PRIOR / 'results' / 'summary.csv')
    prior = prior[np.isclose(prior.fraction, FRACTION)].set_index('model')
    rows.insert(0, dict(arm='prior_all_drugs (published AUC, not rerun)', drugs=int(prior.drugs.iloc[0]),
                        pairs=int(prior.pairs.iloc[0]), gdsc1=prior.at['gdsc1', 'precision'],
                        gdsc2=prior.at['gdsc2', 'precision'], consensus=prior.at['consensus', 'precision'],
                        chance=prior.at['gdsc1', 'random']))
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cache', type=Path)
    ap.add_argument('--results', type=Path, default=HERE / 'results')
    ap.add_argument('--audit-only', action='store_true', help='metadata audit + stratification of published results only')
    args = ap.parse_args()
    cache = args.cache.expanduser().resolve()
    res = args.results
    res.mkdir(parents=True, exist_ok=True)
    flow = {}

    src, own = pinned(cache)
    paths = fetch(cache, src, own)
    matched, drugs = load_cohort(cache)
    windows = {k: gdsc_windows(cache, f'gdsc{k}', src[f'gdsc{k}'], paths[f'gdsc{k}']) for k in (1, 2)}
    t = pd.read_csv(paths['prism_collapsed_treatments'], usecols=['broad_id', 'dose', 'screen_id'])
    t = t.merge(drugs[['drug', 'prism_broad_id', 'prism_screen']], left_on=['broad_id', 'screen_id'],
                right_on=['prism_broad_id', 'prism_screen'])
    prism_doses = {d: np.sort(g.dose.to_numpy()) for d, g in t.groupby('drug')}

    # ---- 1. audit  ---- 2. stratification of published results
    audit = window_audit(matched, drugs, windows, prism_doses)
    audit.to_csv(res / 'window_audit.csv', index=False, float_format='%.6g')
    prior = prior_per_drug()
    strat, merged = stratified_published(audit, prior)
    strat.to_csv(res / 'stratified_published.csv', index=False, float_format='%.6g')
    flow['audit'] = dict(drugs=len(audit), comparable=int(audit.comparable.sum()),
                         prior_drugs_with_audit=len(merged), prior_drugs_comparable=int(merged.comparable.sum()),
                         median_prism_extra_decades=float(audit.prism_extra_decades.median()),
                         drugs_with_several_gdsc_windows=int(((audit.g1_n_windows > 1) | (audit.g2_n_windows > 1)).sum()))
    print('Window audit: ', flow['audit'])
    show = strat[(strat.threshold == COMPARABLE) | strat.threshold.isna()]
    print(show[['measure', 'stratum', 'drugs', 'mean', 'low95', 'high95']].to_string(index=False))
    if args.audit_only:
        (res / 'flow.json').write_text(json.dumps(flow, indent=1, default=float))
        return

    # ---- 3. raw curves
    cells = set(matched.cosmic_id)
    tabs = {}
    for k in (1, 2):
        ids = set(drugs[f'gdsc{k}_drug_id'].astype(int))
        tabs[k] = reduce_raw(cache, k, own[f'gdsc{k}_raw'], paths[f'gdsc{k}_raw'], cells, ids, flow)
        w = windows[k]
        raw_rng = tabs[k].groupby(['DRUG_ID', 'COSMIC_ID']).CONC.agg(['min', 'max']).reset_index()
        chk = raw_rng.merge(w, on=['DRUG_ID', 'COSMIC_ID'])
        flow[f'gdsc{k}_raw_range_matches_fitted_window_frac'] = float((
            (np.abs(np.log10(chk['min'] / chk.MIN_CONC)) < TOL) & (np.abs(np.log10(chk['max'] / chk.MAX_CONC)) < TOL)).mean())
    c1, c2 = gdsc_curves(tabs[1]), gdsc_curves(tabs[2])
    cp, _ = prism_curves(paths, drugs, matched)
    log('refitting curves')
    fits = refit_pairs(matched, audit, c1, c2, cp, drugs)
    fits.to_csv(res / 'refit_pairs.csv.gz', index=False, float_format='%.6g')
    ok = fits[fits.status == 'ok']
    per_drug_n = ok.groupby('drug').size()
    keep = per_drug_n[per_drug_n >= MIN_DRUG_PAIRS].index
    status = audit[['drug', 'n_cells', 'common_lo', 'common_hi', 'common_width_log10', 'comparable']].copy()
    status['pairs_matched'] = status.drug.map(matched.groupby('drug').size())
    for s in sorted(fits.status.unique()):
        status[s] = status.drug.map(fits[fits.status == s].groupby('drug').size()).fillna(0).astype(int)
    status['analysed'] = status.drug.isin(keep)
    status.to_csv(res / 'drug_status.csv', index=False)
    flow['refit'] = dict(pairs_matched=len(fits), pairs_by_status=fits.status.value_counts().to_dict(),
                         drugs_analysed=len(keep), pairs_analysed=int(per_drug_n[keep].sum()))
    if len(keep) < 3:
        sys.exit(f'only {len(keep)} drugs have >= {MIN_DRUG_PAIRS} refit pairs; see drug_status.csv')
    fits = ok[ok.drug.isin(keep)]
    sub = matched.merge(fits[['drug', 'cell']], on=['drug', 'cell'], validate='1:1')
    arm_dir = cache / 'dose-window-arms'
    arm_dir.mkdir(exist_ok=True)
    tables = {arm: arm_table(sub, fits, arm) for arm in ARMS}
    per_drug = {arm: run_arm(tables[arm], res / 'arms', arm_dir, arm) for arm in ARMS}
    for arm in ARMS:
        (res / 'arms' / arm).mkdir(parents=True, exist_ok=True)
    summary = arm_summary(res / 'arms')
    summary.to_csv(res / 'arm_comparison.csv', index=False, float_format='%.6g')
    agree = {arm: agreement(tables[arm]) for arm in ARMS}
    contrasts, ag = arm_contrasts(per_drug, audit[audit.drug.isin(keep)], agree)
    contrasts.to_csv(res / 'arm_contrasts.csv', index=False, float_format='%.6g')
    ag.to_csv(res / 'rank_agreement.csv', index=False, float_format='%.6g')
    # does our refit reproduce the published ranks? (per drug Spearman, same pairs)
    pub = tables['published_subset'].set_index(['drug', 'cell'])
    val = []
    for arm in ARMS[1:]:
        t = tables[arm].set_index(['drug', 'cell'])
        for col in ('gdsc1', 'gdsc2', 'prism'):
            r = [spearman(t.loc[g.index, col].to_numpy(), g[col].to_numpy()) for _, g in pub.groupby(level='drug')]
            val.append(dict(arm=arm, assay=col, drugs=len(r), median_rho=float(np.nanmedian(r)),
                            q25=float(np.nanquantile(r, .25)), q75=float(np.nanquantile(r, .75))))
    pd.DataFrame(val).to_csv(res / 'refit_validation.csv', index=False, float_format='%.4g')
    (res / 'flow.json').write_text(json.dumps(flow, indent=1, default=float))
    pd.set_option('display.width', 200)
    print(summary.to_string(index=False))
    focus = contrasts[(contrasts.stratum == 'all') & contrasts.contrast.str.startswith(('gain change', 'consensus - g'))]
    print(focus[['contrast', 'arm_a', 'arm_b', 'drugs', 'mean', 'low95', 'high95']].to_string(index=False))
    print(pd.DataFrame(val).to_string(index=False))


if __name__ == '__main__':
    main()
