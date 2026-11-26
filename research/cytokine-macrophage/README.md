# 독립 연구에서 실제로 쓴 자극의 이름을 맞힐 수 있는가?

[원자료: Xue et al., Immunity, GSE46903](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE46903) · [평가 전 규칙](protocol.md). 세포에 무엇을 처리했는지 알려주지 않고 발현 변화만으로 자극 이름을 고르는 과제다. Xue의 GM-CSF 분화 사람 대식세포 중 동일한 3명에게 IL-4, IL-13, IL-10, IFN-γ와 무처리 대조가 전부 존재하는 72시간 패널을 골랐다. 총 15개 배열. 연구자가 제공한 정규화값에서 기증자별·시간별 대조를 빼고 평균했다. 전향적 맹검 실험이 아니라, 공개 실험의 라벨을 예측 점수 계산에 쓰지 않는 후향 평가다.

예측용 기준표는 별도 연구 Parse 24 h 말초혈액이다. 4개 자극·4개 세포 종류·배열 사이에 모두 있는 2,964개 기호만 사용했다. CD14 단핵구를 대식세포에 가장 가까운 유형으로 매핑했지만 동일 세포 상태가 아니다. 네 후보 중 유전자 반응 순위 상관이 가장 높은 것을 각 행에서 독립적으로 선택했다. 강제로 일대일 매칭하지 않았다.

- **4개 중 3개 정답**, 기증자별 2/4, 3/4, 3/4. 실제 IL-4를 IL-13으로 잘못 불렀다(상관 0.207 대 정답 0.189). IL-10도 1위는 맞지만 상관이 0.027에 불과했다. 모든 자극을 맞히겠다는 사전 통과 기준은 실패했다.
- 자기 유형으로 올바른 자극과의 평균 상관 0.178, 다른 자극 평균 −0.010. 평균 대각선 점수가 가능한 라벨 순열 24개 중 1위였다. 이 숫자가 개별 자극을 완벽히 식별했다는 뜻은 아니다. 1:1 혼합도 3/4, 다른 세포만 사용하면 2/4였다.
- 3명 × 4자극을 독립 코호트 12개라고 부를 수 없다. 완전 교차 패널은 네 자극에 한정되며 유사한 자극이 늘면 문제는 더 어려워진다. [90개 후보 전체를 사용한 추가 시험](../cytokine-effects/results/catalogue_macro.csv).

[모든 라벨 간 점수](results/confusions.csv) · [기증자/조합별 결과](results/retrieval.csv) · [비교에 들어간 샘플](results/samples.csv) · [유전자 목록/오차 결과](results/direction.csv). 원시 발현표나 개인 데이터는 배포하지 않는다.

재현: `../cytokine-effects/prepare.py`로 `REF/selected-effects.csv.gz`를 생성한 뒤, 이 폴더에서 `python run.py "$HOME/tmp/celllab-macrophage" "$REF/selected-effects.csv.gz" results`. `run.py`가 GEO 시리즈와 GPL6947 annotation을 내려받고 SHA-256을 대조한다. Python·라이선스·전체 명령은 [통합 안내](../cytokine-effects/README.md) 참고.
