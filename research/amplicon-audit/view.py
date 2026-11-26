"""Create an offline, read-only report from measured outputs; no external assets."""
import csv
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'results'


def rows(name):
    with (OUT / name).open() as f:
        return list(csv.DictReader(f))


def page():
    ref = {r['dataset']: r for r in rows('reference_merge.csv')}
    taxa = rows('taxa_headline.csv')
    parts = ['''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>16S·ITS 공개 표준시료 결과</title><style>html{color-scheme:light dark}body{font:16px/1.55 system-ui;max-width:52rem;margin:2rem auto;padding:0 1rem}details{margin:1em 0}summary{cursor:pointer;font-weight:bold}table{border-collapse:collapse}td,th{padding:.25em .8em;text-align:left;border-bottom:1px solid GrayText}</style><h1>들어 있던 미생물이 왜 결과에서 빠졌을까?</h1><p>공개 표준시료마다 같은 20,000쌍을 두 방식으로 처리했습니다. 시료 이름을 눌러 어느 단계에서 읽기 수가 줄었는지 확인하세요. 검출되지 않았다고 실제로 없었던 것은 아닙니다.</p>''']
    for r in rows('summary.csv'):
        ds = r['dataset']
        parts.append(f'<details><summary>{escape(ds)} · {escape(r["marker"])}</summary><dl><dt>자체 처리: 병합 / 입력</dt><dd>{int(r["merged"]):,} / {int(r["pairs"]):,}</dd><dt>표준 VSEARCH: 병합 / 같은 입력</dt><dd>{int(ref[ds]["merged"]):,} / {int(ref[ds]["pairs"]):,}</dd><dt>자체 처리: 품질·빈도 필터 후 남은 읽기</dt><dd>{int(r["reads_after_ee_and_min_count"]):,}</dd><dt>알려진 구성원 중 검출</dt><dd>{r["detected_ge1"]} / {r["expected_taxa"]}</dd></dl><table><thead><tr><th>공개 조성표의 분류군</th><th>자체 처리 후 배정된 읽기</th></tr></thead><tbody>')
        for t in taxa:
            if t['dataset'] == ds:
                parts.append(f'<tr><td>{escape(t["taxon"])}</td><td>{int(t["reads"]):,}</td></tr>')
        parts.append('</tbody></table></details>')
    parts.append('<p>두 방법의 병합 단계만 비교했습니다. 구성원 검출은 알려진 후보만 대상으로 한 자체 처리 결과이며 환경 시료 분류 정확도가 아닙니다. 두 ITS 시료는 같은 연구에서 왔습니다.</p></html>')
    (OUT / 'viewer.html').write_text('\n'.join(parts), encoding='utf-8')


if __name__ == '__main__':
    page()
