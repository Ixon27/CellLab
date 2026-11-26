# Can a first reference count anchor label-free measurements in a new cell line?

CellLab research pilot, independent of the desktop application and private culture records. Estimate the **current number of fluorescently detected nuclei per field** from a phase-contrast image; this is neither a forecast nor a measurement of viability, confluence, drug response or differentiation. The immediate question is whether the image adds information beyond elapsed time under a change of cell line. The model is not intended for deployment.

## 파일럿 결과와 판단

분석 가능 영상 791장 중 A172 학습에 261장(9 wells), 같은 세포주의 미사용 well 확인에 87장(3 wells), A549 전이에 443장(15 wells)을 썼습니다. A549에서 초점 문제로 형광 기준값이 없는 7장은 제외했습니다. 첫 시점은 보정에만 쓰고 정확도는 이후 시점에서 계산했습니다. [전체 수치](results/summary.csv) · [짝지은 비교](results/contrasts.csv) · [well별 오차](results/well_scores.csv) · [15개 성장 곡선](results/transfer-trajectories.png)

| 후속 시점 평균절대오차 (핵/시야, 작을수록 좋음) | A172: 84장 | A549: 428장 |
|---|---:|---:|
| 첫 계수 × 시간별 예상 성장비 | 387.9 | 436.0 |
| 영상 질감 회귀 + 첫 계수 | 89.4 | 475.1 |
| 영상 CNN 단독 | 79.9 | 206.3 |
| 영상 CNN + 첫 계수 | 81.5 | 199.5 |

A549에서 첫 계수를 똑같이 제공해도 CNN은 시간·질감 기준선보다 오차가 작았습니다. 반면 CNN **자체에 첫 계수를 더하는 효과**는 작았습니다(보정 − 무보정 −6.8핵/시야, 탐색적 well-bootstrap 95% 구간 −14.7~+1.1). 보정형 CNN의 A549 well별 MAE는 47.6~410.2였습니다. 평균 부호 오차가 +4.1이라고 해서 개별 well이 정확한 것은 아닙니다. 초점 불량은 평가되지 않았고, 두 시리즈에서 얻은 결과로 기기·연구실 간 성능이나 처리 효과를 주장할 수 없습니다.

**권장 연구 질문:** 처리로 세포의 모양과 밀도가 달라져도, 위상차 영상에서 추정한 처리군–대조군 차이가 독립 측정한 핵 수 차이를 보존하는가? 이번 결과는 이 질문에 대한 답이 아니라 실험에 쓸 기준선입니다. CellLab에 등록된 TCMK-1을 첫 후보로 두되, 같은 시야의 독립 핵 수를 확보할 수 있을 때만 계수 연구로 진행합니다. 처리군과 동시 대조군을 여러 독립 배양 회차에 함께 배치하고, 촬영 전에 well·시야·처리·시점·배율·passage·기준 측정 ID를 고정합니다. 마지막 독립 기관/장비의 원본은 모델·판정 기준이 동결될 때까지 열지 않습니다. 이때 원본 해상도의 [Cellpose 계열 모델](https://www.cellpose.org/) 및 LIVECell 공개 모델도 동일 시야·동일 기준값으로 비교합니다. 보정이나 CNN이 실질적 이득이 없으면 더 단순한 방법을 채택합니다.

## Study design (defined before fitting)

- Data: [Edlund et al., Nature Methods (2021), Fig. 4](https://doi.org/10.1038/s41592-021-01249-6), [official LIVECell nuclear count benchmark](https://github.com/sartorius-research/LIVECell#comparison-to-fluorescence-based-object-counts). Use the full labeled phase-contrast fields and published nuclei counts, **not** fluorescence pixels as inputs. Images and labels are [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), not covered by the application code license. No raw data or weights redistributed here.
- Fixed split: A172 plate rows A/B/C for training (9 wells); row D for a same-line check (3 wells); all A549 for transfer (15 wells). Never split frames of a well across sets. Each cell line is also a separate acquisition series: this is **not** an external lab test or an isolated estimate of the effect of cell identity.
- Rescale the entire field to 160 × 128, then standardize each image. Do not crop and reuse the full-field count. Fit a small count-supervised CNN, ridge regression on multiscale image texture, and a clock-only growth curve using only A172 training wells. The cheap baselines matter: the clock can track growth without ever seeing cells.
- Two measurement budgets. Zero reference: use the raw prediction. One reference: measure the initial field once, then estimate each **later** count as `max(0, initial_count + prediction_now − prediction_initial)`. Apply the identical correction to the clock and texture models. Include a model that simply carries forward the initial count. The reference is from that same field; a whole-well counter value is not interchangeable. No subsequent target labels are used for calibration.
- Stronger no-image control: `initial_count × clock_now / clock_initial` permits different starting densities to scale the entire growth curve instead of adding the same predicted change to every well.
- Primary endpoint: follow-up mean absolute error (MAE, nuclei/field) averaged first within a well, then equally across wells on A549. Report signed bias and all per-well errors. Omit missing reference measurements; no imputation. Raw and anchored methods are scored on exactly the same visits; time zero never contributes a free correct prediction.
- Decision rule: support an advantage for the anchored CNN only if its paired mean MAE difference against **each** of additive clock, relative-growth clock, and anchored texture is negative, with the upper endpoint of each descriptive 95% well-bootstrap interval below zero. Resample whole wells, paired across methods (10,000 draws; seed 2026). Intervals are conditional on this plate/series, not independent studies. No retrospective model selection on A549.

## Reproduce

From this directory, using Python 3.13 with `requirements.txt` installed in a dedicated environment:

```sh
CACHE="$HOME/tmp/celllab-livecell-count"
python prepare.py "$CACHE"
OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=1 python fit.py "$CACHE"
python evaluate.py "$CACHE"
python figure.py "$CACHE"
```

`fields.npz` contains the analysis inputs; `cnn.pt` is the CPU model state. `predictions.csv` gives the raw outputs per image; `well_scores.csv`, `summary.csv` and `contrasts.csv` are the derived endpoints. `transfer-trajectories.png` shows all target wells, not a selected success. The source files are cached outside the application and verified against fixed checksums. No app database is read or modified.

## What would justify a paper?

The source paper already tested label-free counting on these two lines. Rerunning it with a smaller CNN is not a new method paper. The research opportunity is to test **when historical reference measurements help or mislead** under real changes of instrument, passage, cell morphology and treatment. Before a confirmatory study: freeze the prediction rule, define a practically meaningful error margin with the intended users, and use variance *between independent culture runs* to plan replication. Benchmark an established pretrained segmenter on identical native-resolution fields, compare zero vs one reference at matched cost, and hold out an entire laboratory or acquisition system. Report both the failure regimes and how often the measurement can be used within the chosen tolerance.

For a treatment experiment, predefine a contrast such as the treated–vehicle difference in change from baseline and compare the predicted difference to independent counts; do not infer treatment from filenames. For differentiation, use an independent endpoint such as a blinded marker measurement, not day number or treatment assignment as a proxy for success. Keep these as distinct biological questions. CellLab could capture well/field identity, timestamps, calibrated image scale, passage and blinded assay links; none of these integrations or external validations is claimed by this pilot.
