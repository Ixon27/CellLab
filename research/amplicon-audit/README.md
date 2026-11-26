# 16S·ITS 분석: ‘미검출’과 ‘앞 단계에서 탈락’을 나눌 수 있는가?

이미 [nf-core/ampliseq](https://nf-co.re/ampliseq), [RAPID (16S·ITS DADA2 Shiny GUI)](https://www.ornl.gov/publications/rapid-an-interactive-r-shiny-platform-for-end-to-end-16s-rrna-and-its-amplicon-sequence-analysis-using-dada2), [MicrobiomeAnalyst 2.0](https://academic.oup.com/nar/article/51/W1/W310/7160190)이 있다. 단순히 두 마커를 지원하거나 버튼을 제공하는 것은 논문의 차별점이 아니다. 여기서는 정답 구성원이 공개된 시료에서 **어느 단계에서 정보가 손실되는가**를 측정한다. [실제 열어보는 결과 화면](results/viewer.html) · [설정별 결과](results/grid.csv) · [독립 표준 도구로 확인](results/reference_merge.csv).

[Mockrobiota 버전 고정 자료](https://github.com/caporaso-lab/mockrobiota/tree/b7a161a5f3648be789cde9b88159438cde9689d9/data): mock-12는 Callahan의 16S V4 라이브러리, mock-24·25는 Taylor의 같은 8종 곰팡이 다른 혼합물이다. 전 파일의 paired record를 순회해 시료당 20,000쌍을 균등 확률로 뽑았다(시드 2026). 파일 머리 부분만 사용하면 입력 순서에 민감하다. 두 merger에는 정확히 같은 쌍을 주었다.

| 라이브러리 | 자체 처리 병합 | VSEARCH 2.32 기본 병합 | 자체 처리 품질·빈도 필터 후 읽기 | 알려진 구성원 중 배정된 분류군 |
|---|---:|---:|---:|---:|
| mock-12, 16S | 16,516 | 12,262 | 13,730 | 13/26 |
| mock-24, ITS2 | 343 | 1 | 32 | 3/8 |
| mock-25, ITS2 | 540 | 35 | 14 | 3/8 |

**해석:** 두 구현 모두 이 두 ITS 라이브러리의 읽기 쌍 대부분을 병합하지 못했다. ‘이 시료에 다른 5종은 원래 없었다’는 틀린 결론이다. 두 merger의 기본 품질·겹침 기준은 동일하지 않으며 **더 많이 연결했다는 것만으로 더 정확하다고 할 수 없다.** 한쪽 읽기만으로 정보를 복구할 수 있는지는 검증하지 않았다. 마커·연구·시료가 뒤섞여 있으므로 일반적인 16S 대 ITS 우열 또는 문제의 생물학적 원인을 추론할 수 없다.

자체 처리: 앞부분의 일부 읽기로 알려진 참조 서열과 방향을 점검한 뒤 품질 절단·쌍 병합·빈도 필터·제한된 참조 목록에 배정한다. ITS 참조 끝 경계 차이를 완화하기 위해 병합 서열 뒤 30 nt를 비교에서 제외한 탐색적 규칙이다. 입력 읽기의 프라이머 상태 점검이 모든 라이브러리의 primer removal을 보장하지 않는다. DADA2의 오류 모델 학습·ASV 추론이 **아니며**, 키메라 유사 플래그도 정답 판정이 아니다. 알려진 구성원만을 후보로 주었기에 환경시료 특이도와 위양성률을 산출할 수 없다. mock-12의 공개 조성표는 27 strain에 사실상 같은 수치를 주므로 실제 DNA 혼합비로 검증되지 않은 조성 오차를 주 결과로 쓰지 않는다. 두 ITS 비율 비교도 생존 읽기 수가 적어 추론 대상이 아니다.

재현(Python 3.13): `pip install -r requirements.txt`; 이 폴더에서 `python run.py CACHE`; [VSEARCH 2.32.0](https://github.com/torognes/vsearch/releases/tag/v2.32.0) 설치 후 `python reference.py CACHE --vsearch /path/to/vsearch`; `python view.py`. 원자료는 CACHE에만 저장하고 체크섬과 설정은 [provenance](results/provenance.json)에 기록한다. GUI는 결과를 읽는 도구이며 임의 FASTQ 업로드·자동 분석 앱은 아니다.

**논문으로 가는 기준:** 이 세 시료는 발견용이다. 다른 연구의 공개 표준시료로 방법 선택 전에 검증 목록을 고정하고, paired-end와 single-end, 표준 DADA2 워크플로를 함께 비교한다. ‘미검출’ 경고가 실제로 누락된 구성원을 얼마나 잘 가려내는지, 경고하지 말아야 할 경우에도 얼마나 자주 경고하는지 독립 연구 단위로 측정해야 한다. GUI는 그 판단을 보여주는 수단이다.
