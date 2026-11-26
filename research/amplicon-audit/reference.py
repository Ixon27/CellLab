"""Run an independent default VSEARCH merger on the exact raw pairs in the pilot."""
import argparse
import csv
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from run import DATASETS, N_PAIRS, OUT, fastq_pairs, fetch_all


def benchmark(cache, binary):
    version = subprocess.run([binary, '--version'], capture_output=True, text=True, check=True)
    version_line = next(s for s in (version.stdout + version.stderr).splitlines() if s.startswith('vsearch v'))
    raw = fetch_all(cache)
    with (OUT / 'reference_merge.csv').open('w') as table, TemporaryDirectory() as tmp:
        writer = csv.writer(table)
        writer.writerow(['dataset', 'version', 'pairs', 'merged', 'merged_fraction'])
        fwd, rev, out = [Path(tmp) / n for n in ('fwd.fq', 'rev.fq', 'merged.fasta')]
        for ds in DATASETS:
            pairs = fastq_pairs(raw / ds / 'forward.fq.gz', raw / ds / 'reverse.fq.gz', N_PAIRS)
            with fwd.open('wb') as ff, rev.open('wb') as rf:
                for n, (s1, q1, s2, q2) in enumerate(pairs, start=1):
                    label = f'@{n}\n'.encode()
                    for stream, seq, quality in ((ff, s1, q1), (rf, s2, q2)):
                        stream.writelines((label, seq.encode(), b'\n+\n', quality, b'\n'))
            subprocess.run([binary, '--fastq_mergepairs', fwd, '--reverse', rev, '--fastaout', out, '--threads', '1'], check=True)
            with out.open('rb') as fh:
                merged = sum(line.startswith(b'>') for line in fh)
            writer.writerow([ds, version_line.split(',')[0], n, merged, merged / n])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('--vsearch', default='vsearch')
    args = p.parse_args()
    benchmark(args.cache, args.vsearch)
