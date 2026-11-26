# 약물 순위표를 같은 농도 범위에서 다시 계산하면 결론이 달라지는가?

[이전 파일럿](../screen-consensus/manuscript.md)을 실제 농도별 측정값으로 확장했다. [Sanger GDSC 1·2 및 PRISM 파일/체크섬](sources.json); [Broad PRISM 데이터](https://doi.org/10.6084/m9.figshare.9393293). GDSC plate intensity를 대조 well 기준으로 정규화하고 PRISM의 공개 replicate-collapsed log₂ 변화량을 viability 척도로 변환했다. PRISM은 개별 원시 well을 재처리한 것이 아니다. 각 약물의 GDSC 대표 농도 구간 두 개와 PRISM 구간의 교집합을 정하고, 세 자료에 각각 구간 안 농도점이 4개 이상이며 원래 측정 구간이 양 끝을 포괄하는지 검사했다. 실제 농도 격자는 서로 다르므로 **동일 농도점** 실험이 아니다. 위쪽 점근선 1로 고정한 로지스틱 곡선을 적합하여 동일 로그 농도 구간의 평균 생존 신호로 세포주를 다시 순위화했다.

| 같은 43종 약물·10,266개 약물–세포주 쌍 | GDSC1 | GDSC2 | 두 순위 평균 |
|---|---:|---:|---:|
| 기존 공개 AUC | 24.6% | 24.7% | 26.2% |
| 같은 방식으로 재적합, 각 연구 원래 농도 범위 | 23.5% | 24.6% | 26.3% |
| 같은 방식으로 재적합, 공통 농도 범위 | 22.1% | 25.3% | 24.6% |

숫자는 각 약물에 대해 선택한 상위 10% 세포주 중 PRISM에서도 상위 10%인 비율의 약물별 평균이다. PRISM 정답 순위 **역시 각 arm에서 다시 계산**하므로 arm 간 차이는 예측기만 바꾼 효과가 아니다. 공통 구간에서 ‘통합 − GDSC2’는 −0.70%p(약물 단위 기술적 95% bootstrap 구간 −3.61~+1.92). 원래 구간과 비교한 이 차이의 변화도 −2.38%p(−5.18~+0.15)로, 농도가 결과 차이의 원인이라고 단정할 수 없다. 보간식에서는 통합이 numerically 더 높지만 두 단독 스크린을 유의하게 앞서지 않았다. 비교 가능 구간을 양 GDSC 범위의 ≥90%로 정의한 별도 층화에는 50개 중 해당 약물이 없어 평가 불가.

**한계:** 전체 48종 약물의 최초 주평가와 43종 재적합 코호트를 혼동하지 않는다. 공통 구간에 들어온 실제 관측점이 구간 끝에 정확히 있지 않을 수 있으며 일부 끝부분은 적합 곡선에 의존한다. GDSC의 두 스크린은 하나의 프로그램이다. 원 논문 저자들의 곡선 적합을 재현한 것이 아니다. CTRP는 앞 연구의 공개 AUC까지 평가했지만 여기서 원시 농도 재적합을 한 것은 **PRISM과 GDSC1/2만**이다. 단순 농도 조화는 [Chen et al., Bioinformatics](https://doi.org/10.1093/bioinformatics/btag382)의 선행 결과이므로 최초 주장 불가.

**재현:** `../screen-consensus/requirements.txt`가 설치된 환경에서 앞 연구의 `prepare.py CACHE`를 실행한 뒤, 이 폴더에서 `OPENBLAS_NUM_THREADS=1 python dose_window.py CACHE --results results`. 원본은 repo 밖 캐시. [약물별 제외](results/drug_status.csv) · [모델 비교](results/arm_comparison.csv) · [같은 약물에서 짝지은 차이](results/arm_contrasts.csv) · [원래 순위와 재적합 순위의 일치](results/refit_validation.csv).
