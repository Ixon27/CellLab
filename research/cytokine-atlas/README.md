# 세포 종류 간 정보를 섞으면 새로운 연구의 반응을 더 잘 맞힐까?

**확장판:** [영문 원고](manuscript.md) · [90개 후보·독립 사람 연구·재현 명령](../cytokine-effects/README.md) · [대표 그림](../cytokine-effects/results/validation.png). 같은 2,745개 유전자로 같은 대식세포 실험을 판별해도 후보를 4개에서 90개로 늘리면 정답은 3/4에서 1/4로 줄었다. 아래는 확장 전 유전자 목록 검증 결과다.

**연구 판단:** [영문 원고 초안](manuscript.md) · [대표 그림](results/external-validation.png). 먼저 [Wood 사람 단일세포 → Parse](../cytokine-single/results/macro.csv)에서 IL-2와 IL-4를 검증했다. 6명·4개 세포 종류에서 단순 변화량을 쓰면 대체로 1:1 혼합이 나았지만, [limma로 사람 간 변동까지 반영](results/moderated.csv)하면 IL-4에서는 단독 방법이 더 좋았다. [새 적응형 모델](adaptive-plan.md)은 미리 정한 통과 기준을 충족하지 못했다. [Parse를 전혀 거치지 않은 Wood → 외부 연구 3개](results/double_holdout.csv)에서는 둘의 차이가 6명 기준 0.17%p에 그쳤다. 따라서 신모델 우월성보다는 분석법과 검증 대상에 따라 결론이 달라지는 재현성 벤치마크로 투고하는 편이 타당하다.

연구 질문과 원래 결과는 [Kang → Parse 단일 자극 파일럿](../transcript-transfer/external-results.md). 여기서는 (1) 예측하는 쪽의 종·자극을 바꾸고 (2) 정답을 제공하는 쪽도 기존에 사용하지 않은 사람 연구로 바꿨다. 두 분석의 절대 수치는 직접 비교할 수 없다.

### 1. 새 원천 연구: 생쥐 → 사람

[생쥐 림프절 Cui atlas](https://doi.org/10.1038/s41586-023-06816-9)의 저자 제공 사람 유전자 기호 매핑을 사용. [사람 Parse/Allen 상·하향 목록](https://apps.allenimmunology.org/aifi/resources/parse-10m-cytokines/downloads/)을 예측했다. 5개 계열, 같은 자극·계열·방향끼리 평가. 발견용 IFN-β는 제외했다. [평가 전 규칙](protocol.md) · [대상/탈락 사유](results/eligibility.csv) · [자극별 수치](results/by_ligand.csv).

| 비교 | 자극 | 조건 수 | 해당 세포만 | 다른 세포만 | 절반 혼합 |
|---|---:|---:|---:|---:|---:|
| 세 방법이 같은 수의 유전자를 추천 (최소 10개) | 19 | 116 | 14.89% | 12.00% | 14.58% |
| 항상 100자리 부여, 빈자리도 오답 | 22 | 220 | 6.94% | 8.47% | 9.99% |

같은 추천 개수일 때 혼합 − 해당 세포는 −0.31%p. 자극별로 6개 개선, 3개 동률, 10개 악화. 하나의 자극을 뺀 평균 차이는 −0.55~−0.07%p. 추천 개수의 중앙값 85.5; 19개 자극 중 양 방향 모두가 남은 자극은 14개였다. 원천에는 저자가 선별한 유전자만 있어 정보가 없는 유전자를 0으로 **점수화**하지만 효과가 0으로 측정된 것은 아니다.

**왜 100자리에서는 반대로 보이는가?** 사후에 똑같은 116개 조건만 남겨도 고정 100자리에서는 혼합이 +2.32%p, 같은 추천 개수에서는 −0.31%p다. 따라서 적어도 일부 이득은 같은 길이 목록의 순서를 더 잘 맞히는 것과 구별된다. [분해표](results/coverage.csv). 마우스 in vivo와 사람 PBMC in vitro, 처리 시간·조직·종·기초 상태가 함께 달라 순수 종 효과가 아니다. [인간 cytokine dictionary 선행연구](https://pubmed.ncbi.nlm.nih.gov/41446101/)에서도 사람–생쥐 비교를 수행했으므로 이 비교 자체가 새 발견은 아니다.

### 2. 새 정답 연구: 사람 → 다른 사람 연구의 세포 반응

이번에는 Parse를 예측에만 사용하고, [ImmuneSigDB](https://www.gsea-msigdb.org/gsea/msigdb/human/collections.jsp#C7)에서 선별한 **서로 다른 GEO accession 네 개**의 사람 마이크로어레이 결과를 정답으로 사용했다. 총 4자극(IL-2/4/12/15), 2개 계열(NK·CD4), 11개 시간·용량 대비의 상·하향을 모두 평가했다. 4개 자극이 각 연구에 모두 있는 요인설계는 아니다. 원시 마이크로어레이 재분석이 아니다. 굵은 화살표 같은 방향으로 정의: `CTRL_VS_STIM_DN`은 처리 후 올라간 유전자. Parse는 크기 없는 유전자 목록이라 동점 내 균등 추첨의 기대 적중률을 사용했다. [고정한 설계](human-target-protocol.md) · [전체 결과](results/human_by_study.csv).

| 외부 연구와 비교 조건 | 해당 세포만 | 절반 혼합 |
|---|---:|---:|
| [GSE12198](https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-GEOD-12198), NK IL-2 저/고용량 7일 | 1.29% | 0.78% |
| [GSE20198](https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-GEOD-20198), 활성화 CD4 IL-12 | 2.09% | 0.63% |
| [GSE22886](https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-GEOD-22886), NK IL-2/15 | 10.90% | 8.39% |
| [GSE2770](https://www.ebi.ac.uk/biostudies/arrayexpress/studies/E-GEOD-2770), 활성화 CD4 IL-4/12 시간대별 | 1.71% | 2.17% |
| accession 동일 가중 평균 | **4.00%** | **2.99%** |

잘못된 자극 세 개로 바꾼 대조의 평균은 각각 2.41%, 2.15%. 해당 세포만 쓰더라도 가장 큰 자극 특이 신호는 GSE22886에 몰렸다. GSE12198에서는 맞는 자극이 틀린 자극 평균보다 못했다. 면역세포 계열·배양 시간과 대조 유무가 달라 생물학적으로 완전히 일치하는 재실험은 아니다. GSE20198·2770 참여자의 독립성을 accession만으로 보증하지 않는다. 연구 4개로 유의한 범용 순위나 기술 플랫폼 효과를 주장하지 않는다. 동점 처리, 표적 유전자 기호·플랫폼 불일치 및 파생 목록의 크기 차이도 영향을 미친다.

### 재현

Python 3.13, pandas 3.0.5, numpy 2.4.6, openpyxl 3.1.5. `adaptive.py`의 원천 계수 분석은 [형제 폴더 requirements](../transcript-transfer/requirements.txt)도 필요하다. 각 명령은 이 폴더에서 실행한다. 공개 입력은 저장소 밖에 캐시하고 코드가 SHA-256을 검사한다. 원본·유전자 목록은 재배포하지 않는다. MSigDB 및 Parse 데이터 자체의 이용조건은 저자의 조건을 따른다.

```sh
CACHE="$HOME/tmp/celllab-transcript-transfer"
python run.py "$CACHE" results
python coverage.py results
python human_targets.py "$CACHE" results
python adaptive.py "$CACHE" results
```

### Wood 독립검증·대조군·그림 재현

`cytokine-single`은 SeuratObject 5.4.0 및 Matrix 1.7-4로 공개 RDS를 읽는다. 아래는 이 폴더에서 실행한다. `CACHE`는 위 명령과 동일. 표준 통계 기준선에는 R 4.5.2에서 limma 3.66.0, statmod 1.5.2를 사용했다. 원본 체크섬은 [Wood 명세](../cytokine-single/sources.json), 별도 정제세포 분석은 [방법과 명령](../cytokine-sorted/RESULTS.md) 참고.

```sh
WOOD="$HOME/tmp/celllab-cytokine-single"
python ../cytokine-single/run.py "$WOOD" ../cytokine-single/results
python adaptive.py "$CACHE" results --tensor "$WOOD/wood_donor_lfc.npz"
python double_holdout.py "$WOOD/wood_donor_lfc.npz" "$CACHE/immune.gmt" results
Rscript depth_extract.R "$WOOD/seurat_v5_object.rds" "$WOOD"
python depth.py "$WOOD" "$CACHE/parse_sets.csv" results
python depth.py "$WOOD" "$CACHE/parse_sets.csv" results --shuffle
python moderated.py "$WOOD" "$CACHE/parse_sets.csv" results
python figure.py
```

`moderated.py`는 두 독립 추출 경로(전체 세포 합산과 donor tensor)에서 계산한 처리 효과가 일치하는지 먼저 검사한다. [세포 수 고정](depth-plan.md)과 달리 `--shuffle` 및 limma 분석은 주 결과를 본 뒤 추가한 민감도 분석이며 사전등록이라 부르지 않는다.
