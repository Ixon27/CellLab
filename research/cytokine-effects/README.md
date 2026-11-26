# 세포의 반응을 맞히는 것과 처리 이름을 맞히는 것은 다르다

[영문 원고](../cytokine-atlas/manuscript.md) · [대표 그림](results/validation.png) · [모든 연구의 정답 순위](results/confidence.csv). 원자료는 공개 실험에서만 가져왔다. 새로 사람을 모집하거나 세포 실험을 하지 않았다.

**질문.** 단핵구나 대식세포에 무엇을 처리했는지 모르는 상황에서, 여러 유전자의 변화만 보고 실제 자극을 찾을 수 있을까? 남의 실험에서 가장 닮은 반응을 찾는 것과 실제 처리 이름을 맞히는 것은 다르다. 예측 기준표는 [Parse/Allen 24 h 사람 혈액세포의 90가지 자극](https://apps.allenimmunology.org/aifi/resources/parse-10m-cytokines/downloads/). 기준표 밖의 실험을 정답으로 썼고, 참값은 후보 90개 중 **7종**에만 있다. 90종을 모두 검증했다는 뜻이 아니다.

| 외부 실험 | 사전에 알려준 것 | 결과 및 해석 |
|---|---|---|
| [Yuan, 새 단핵구 연구](../cytokine-new-cohort/README.md) | 세포 종류, 처리와 무처리 시점 | IL-4가 6 h와 24 h 모두 90개 중 1위. 같은 연구·같은 자극이므로 2회 독립 복제로 세지 않았다. |
| [Xue, 새 대식세포 연구](../cytokine-macrophage/README.md) | 후보 4개 대 90개. 3명의 같은 실험·같은 유전자 2,745개 | 4개 후보 중 3개 실험 정답 → 90개 중 1개 정답. IL-13은 1위, IL-4는 2위, IFN-γ는 5위, IL-10은 19위. |
| [GSE12198](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12198) 및 [GSE22886](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE22886), NK 세포 | 원 발현표에서 별도의 IL-2/15 처리군과 대조군 추출 | IL-2를 처리한 세 비교 모두 IL-15가 1위, IL-2가 2위. 실제 IL-15 처리도 IL-15가 1위. 두 연구의 여러 조건이지 별도 코호트 네 개가 아니다. |
| Wood, Kang, Waddell | 혈액세포 계열, 처리명 비공개 | 각각 5/8, 3/4, 0/4 1위 정답. Waddell은 정답이 2·3·6·9위. 연구별 차이가 크다. |

**확인한 대안 설명.** Xue에서 후보 개수만 바꾸었으므로 유전자 수 차이가 위의 성능 하락을 설명하지 않는다([동일 유전자 대조](results/fixed_genes.csv)). 실제 IL-4와 IL-13의 공통 반응은 사람 간에 재현되지만 두 처리 간 차이는 3명 각각의 반응에서 나머지 2명 평균과 음의 상관이었다([분해](results/near_neighbors.csv)). 이를 두 물질의 작용이 동일하다는 증거로 해석하지 않는다. 1·2위 격차가 크면 답하도록 한 규칙도 제외한 연구에서는 21번 중 2번 답하고 둘 다 틀렸다. 기존 5개 연구로 규칙을 고정하면 두 NK 연구의 4개 비교에서 전부 기권했다([연구 단위 검증](results/confidence_macro.csv)).

**유전자 변화량·순위는 별도 평가다.** Wood 6명의 효과를 다른 세포 종류와 반씩 섞으면 Parse로 예측할 때 오차가 줄었지만, 주고받는 연구를 바꾸면 오차가 오히려 늘었다. 같은 유전자의 어느 세포 종류가 가장 강하게 반응하는지는 균일한 절반 혼합으로 수학적으로 바꿀 수 없다. 기증자로 학습한 세포별 가중치도 두 자극 모두에서 판별력을 개선하지 못했다. [효과와 유형](results/macro.csv) · [기증자 재표집](results/uncertainty.csv) · [Kang으로 전달](results/portability.csv) · [Parse에서 역방향](results/reverse.csv) · [36개 Hallmark 경로](results/hallmarks.csv). [새 Yuan 표적](../cytokine-new-cohort/README.md)에서는 독립 선별한 단핵구 신호만으로도 강력한 기준선이었다. [쌍별 edgeR/limma 비교](../cytokine-count-model/README.md)에서 유전자의 발현 필터를 바꾸면 두 기준선의 격차도 변했다.

**계획과 한계.** [효과 평가](protocol.md), [기증자 불확실성](uncertainty-plan.md), [연구 간 가중치 이동](transfer-plan.md), [역방향](reverse-plan.md), [90개 후보](catalogue-plan.md), [사후 신뢰도 평가](confidence-plan.md). 외부 사전등록은 아니다. 공개 실험을 고를 때 자극 이름을 알았고, 이름을 점수 계산에는 쓰지 않았다. 세포 상태·분화·시간·플랫폼이 함께 달라 원인을 각각 분리할 수 없다. 같은 연구의 기증자·유전자·하위 세포를 독립 연구처럼 합산한 유의확률은 제시하지 않는다. 범용 판독기·환자 진단·최신 딥러닝 대비 우월성을 주장하지 않는다.

## 재현

[단일세포 자료 출처](../cytokine-single/sources.json), [어레이·벌크 자료](../cytokine-sorted/RESULTS.md). 아래 명령은 이 폴더에서 실행한다. 작업 환경: Python 3.13.12, NumPy 2.4.6, pandas 3.0.5, SciPy 1.18.0, Matplotlib 3.11.1. R 및 패키지 버전은 [count model](../cytokine-count-model/README.md). 원 공개자료의 이용 조건을 따를 것. Allen 파생 자료는 CC BY-NC 4.0, Hallmark는 MSigDB 이용 조건이 적용된다. 캐시는 저장소 밖에 두며 원 발현 행렬이나 유전자 집합 파일은 재배포하지 않는다.

```sh
W="$HOME/tmp/celllab-cytokine-single"; S="$HOME/tmp/celllab-cytokine-sorted"
R="$HOME/tmp/celllab-transcript-transfer"; E="$R/selected-effects.csv.gz"
X="$HOME/tmp/celllab-macrophage"; Y="$HOME/tmp/celllab-cytokine-new-cohort"
N="$HOME/tmp/celllab-nk-holdout"; export OPENBLAS_NUM_THREADS=1
# Fresh-cache prerequisites. Keep intermediate outputs outside the repository.
python3 ../cytokine-single/run.py "$W" "$W/benchmark-results"
Rscript ../cytokine-atlas/depth_extract.R "$W/seurat_v5_object.rds" "$W"
python3 ../cytokine-sorted/run.py "$S" "$S/benchmark-results"
python3 prepare.py "$R"  # 2.81 GB Allen release; verify before extraction
mkdir -p "$Y"
curl -fL 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/GSE252736/suppl/GSE252736_raw_counts.txt.gz' -o "$Y/GSE252736_raw_counts.txt.gz"
curl -fL 'https://data.broadinstitute.org/gsea-msigdb/msigdb/release/2025.1.Hs/h.all.v2025.1.Hs.symbols.gmt' -o "$R/hallmarks.gmt"
python3 ../cytokine-new-cohort/run.py "$Y" --wood-cache "$W" --allen "$R/parse-effects.csv" --out ../cytokine-new-cohort/results
python3 ../cytokine-macrophage/run.py "$X" "$E" ../cytokine-macrophage/results
python3 evaluate.py "$W" "$E" results
python3 portability.py "$W" "$E" results  # includes Kang download
python3 reverse.py "$W" "$S" "$E" results
python3 pathways.py "$W" "$E" "$R/hallmarks.gmt" results
python3 catalogue.py "$W" "$R/parse-effects.csv" "$S" "$X" "$Y" results
python3 nk_arrays.py "$N" "$R/parse-effects.csv" results
python3 confidence.py results
python3 figure.py
```

For the paired count model, use the [separate fresh-cache commands](../cytokine-count-model/README.md). `figure.py` needs only the distributed result CSVs. `catalogue_all_scores.csv` and `nk_scores.csv` contain only study-level similarities, not expression: one can inspect any correct or incorrect candidate without redownloading matrices. Individual and resampled summary scores are explicitly tagged; do not treat these rows as independent experiments.
