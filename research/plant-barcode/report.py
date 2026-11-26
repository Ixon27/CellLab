"""Build an offline, read-only evidence viewer; no web server or remote API."""
import csv
import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def rows(name):
    with (ROOT/'results'/name).open() as f:
        return list(csv.DictReader(f))


def build():
    detail = rows('per_species.csv')
    blocks = []
    for r in sorted(detail,key=lambda x:(x['species'],x['method'])):
        tag = r['status'] if r['status']!='ok' else ('unique_insert' if r['unique_in_split']=='1' else 'shared_insert')
        blocks.append('<tr data-method="{}" data-split="{}" data-status="{}"><td>{}</td><td><a href="https://www.ncbi.nlm.nih.gov/nuccore/{}">{}</a></td><td>{}</td><td>{}</td></tr>'.format(*map(html.escape,[r['method'],r['split'],tag,r['species'],r['accession'],r['accession'],tag,r['insert_length'] if r['status']=='ok' else '—'])))
    opts=''.join(f'<option>{html.escape(s)}</option>' for s in sorted({r['method'] for r in detail}))
    doc='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>벼과 바코드 검증</title><style>html{color-scheme:light dark}body{font:16px/1.5 system-ui;max-width:62rem;margin:2rem auto;padding:0 1rem}select{font:inherit}label{display:inline-block;margin:0 1rem .5rem 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.3rem;border-bottom:1px solid GrayText}output{display:block;margin:1rem 0;font-weight:bold}</style>
<h1>벼과 엽록체 바코드: 어느 종이 빠지는가?</h1><p>프라이머가 정확히 일치하고 산물이 하나일 때만 검출로 셉니다. <b>unique_insert</b>는 같은 평가군 안에서만 구분되는 종입니다. 실제 PCR 성공률·특이도가 아닙니다.</p>
<label>방법 <select id="method">OPTIONS</select></label><label>평가군 <select id="split"><option value="heldout">설계에서 제외한 속</option><option value="design">설계에 사용한 속</option></select></label><label>결과 <select id="status"><option value="all">모두</option><option value="unique_insert">검출·구별</option><option value="shared_insert">검출·다른 종과 같은 서열</option><option value="no_exact_pair">정확 일치 산물 없음</option><option value="multiple">산물 여러 개</option><option value="ambiguous_bases">불확실한 염기</option></select></label>
<output id="count" aria-live="polite"></output><table><thead><tr><th>종</th><th>RefSeq</th><th>판정</th><th>프라이머 제외 길이(bp)</th></tr></thead><tbody>ROWS</tbody></table>
<script>const el=id=>document.getElementById(id);function update(){let shown=0,total=0;for(const r of document.querySelectorAll('tbody tr')){const group=r.dataset.method===el('method').value&&r.dataset.split===el('split').value;total+=group;const keep=group&&(el('status').value==='all'||r.dataset.status===el('status').value);r.hidden=!keep;shown+=keep}el('count').textContent=`${total}종 중 ${shown}종 표시`};el('method').value='panel_selected';for(const s of document.querySelectorAll('select'))s.addEventListener('change',update);update()</script></html>'''
    (ROOT/'results'/'viewer.html').write_text(doc.replace('OPTIONS',opts).replace('ROWS','\n'.join(blocks)),encoding='utf-8')


if __name__=='__main__': build()
