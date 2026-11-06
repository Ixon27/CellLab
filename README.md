<p align="center">
  <img src="assets/app-icon.svg" width="96" height="96" alt="CellLab 앱 아이콘">
</p>

# CellLab

**세포 stock·계대 계보, 배양 조건, Bradford/BCA 정량, Western blot 기록을 한곳에서 관리하는 macOS·Windows 앱.**

[![Latest release](https://img.shields.io/github/v/release/Ixon27/CellLab)](https://github.com/Ixon27/CellLab/releases/latest) [![Release build](https://github.com/Ixon27/CellLab/actions/workflows/release.yml/badge.svg)](https://github.com/Ixon27/CellLab/actions/workflows/release.yml) [![MIT License](https://img.shields.io/github/license/Ixon27/CellLab)](LICENSE)

실험 기록은 내 컴퓨터에만 저장됩니다. AI는 **문헌·분양처 페이지에서 배양 조건을 추출할 때만** 쓰며, **본인의 Claude 또는 Codex 계정**으로 실행합니다. 나머지 기능은 AI 없이 동작합니다.

## 주요 기능

| 기능 | 내용 |
|---|---|
| **세포주·stock·계대 계보** | Cellosaurus 검색으로 세포주 등록(종·조직·분양처·주의 사항 자동 입력). 입고 바이알, 해동 배양, 계대 자식 배양, 동결 lot을 계보 그래프로 표시. passage·confluency·세포 수·viability·자유 항목 기록, 혈구계산기 세포 수·접종 부피 계산, 바이알 재고·배지 교체 경과·최대 passage 경고(대시보드). |
| **배양 조건·SOP·문헌 비교** | 배양 조건 세트(배지·혈청·첨가물·항생제·계대 시약·동결 배지 등)를 선택 목록·직접 입력으로 작성. 분양처 페이지(또는 붙여넣은 내용)와 Europe PMC 오픈 액세스 논문 Methods에서 AI가 조건을 추출하고, 원문 문장 근거와 함께 논문별 비교표로 보여 줌. 선택한 조건으로 부착·부유 세포 SOP 템플릿을 채움. |
| **Bradford·BCA 정량** | 표준·마이크로·BCA(562 nm) 프리셋, 선형/2차 적합, R², blank 보정, 반복값 제외, CV·범위 경고, 희석배수를 반영한 원액 농도(µg/mL, µg/µL), 엑셀 붙여넣기, 표준곡선 차트. |
| **Western blot 실행·기록** | 겔 조성표(원문·현장 TEMED 배수), 로딩 계산(프리셋: 프로토콜 v1.1 20 µg/25 µL, 실험실 노트 20 µg/15 µL), Bradford 결과 가져오기, lane map, 항체·ECL 계산, 단계 체크리스트와 타이머, 23항목 실험 기록란, 마크다운 복사. |
| **프로토콜 라이브러리** | .docx/.md/.txt 가져오기(표 포함), 편집·미리보기, draft/확정 상태, 이전 버전 보기·복원. 기본 프로토콜: Western blot v1.1, Western blotting(실험실 노트), 부착·부유 세포 배양 SOP — 모두 draft. |

세포주를 열면 **계보·기록** 작업 공간이 먼저 표시됩니다. 왼쪽의 배양 계보와 최신순 날짜별 기록표, 오른쪽의 **오늘의 기록**과 선택한 배양의 confluency 추이·상세 기록, 하단의 실제 동결·stock 재고를 함께 확인할 수 있습니다. 그래프·기록표·대상 선택은 같은 배양을 가리키며 선택한 대상은 URL의 `node`에 유지됩니다. 기록표는 배양·기록 종류로 필터링할 수 있고 일반 기록은 수정·삭제할 수 있습니다. 계대·동결 기록은 계보 보호를 위해 직접 수정·삭제할 수 없습니다.

빠른 기록에서 수행 일시, confluency, 수행자(자유 항목), 메모를 저장하거나 계대·동결·해동 작업 창을 열 수 있습니다. 종료된 배양의 새 작업과 소진된 바이알의 해동은 비활성화됩니다. 배양·바이알 정보와 배양 조건 연결은 선택 패널의 **정보 수정 · 배양 조건 연결**을 펼쳐 수정합니다. 넓은 화면에서는 두 열로, 좁은 화면에서는 한 열로 배치되며 빈 기록·관찰값은 실제 데이터가 생길 때까지 빈 상태로 표시합니다.

화면은 Ghostex 원본의 258px 사이드바·46px 분할 제목 표시줄과 차가운 반투명 유리 소재를 사용합니다. 사이드바의 Local 표시는 실제 로컬 저장 방식이며, 아이콘 바로가기로 실험 모듈을 열고 세포주를 펼쳐 실제 배양으로 바로 이동할 수 있습니다. 상단의 화면 모드 버튼은 계보 그래프에도 적용됩니다. 세포주 삭제는 **정보** 탭에서 이름을 다시 입력해 확인합니다.

## 저장 위치

| OS | 위치 |
|---|---|
| macOS | `~/Library/Application Support/cell-lab` (`cell-lab.db`) |
| Windows | `%APPDATA%\cell-lab` |

앱 로그는 macOS `~/Library/Logs/cell-lab/desktop.log`, Windows `%APPDATA%\cell-lab\logs\desktop.log`에 남습니다.

## 외부 서비스

- **Cellosaurus**(세포주 정보), **Europe PMC**(논문 검색·전문), 분양처 웹페이지에 세포주 이름·카탈로그 번호로 조회합니다. 설정의 연락처 이메일을 넣으면 요청 헤더에 연락처로만 전달됩니다.
- Cellosaurus에는 배지 정보가 없습니다. 배양 조건은 분양처 페이지·문헌 추출·직접 입력으로만 채우며, 출처 없는 값은 넣지 않습니다.
- KCLB처럼 자동으로 읽을 수 없는 분양처 페이지는 내용을 복사해 붙여넣어 추출합니다.
- AI 추출 시 선택한 자료의 근거 문장이 선택한 AI 제공자에게 전송됩니다. 결과는 반드시 원문 근거와 대조해 확인하세요.

## 소스에서 실행 · 빌드

macOS 또는 Windows, **Node.js 24 이상**, npm이 필요합니다.

```bash
git clone https://github.com/Ixon27/CellLab.git
cd CellLab
npm ci
npm run desktop              # 전용 앱 창으로 실행
npm run install:app          # macOS: 빌드 → ~/Applications/CellLab.app 설치 + 바탕화면 바로가기
```

```bash
npm run dev                  # 웹 개발: localhost:5183, API: 127.0.0.1:4327
npm run typecheck
npm test
npm run pack:mac             # macOS: 현재 CPU용 .app → release/
npm run dist:mac             # macOS: DMG + ZIP → release/
npm run dist:win             # Windows: x64 설치 파일 → release/
```

로그인 키체인에 `CellLab Local Signing` 코드 서명 인증서가 있으면 `install:app`이 설치본을 그 인증서로 다시 서명합니다(선택).

### 환경 변수

| 변수 | 용도 |
|---|---|
| `CELL_LAB_DB_DIR` | 데이터베이스 폴더 (개발·테스트용 분리) |
| `CELL_LAB_FILES` | 첨부 파일 폴더 |
| `CELL_LAB_USER_DATA` | 데스크톱 앱 데이터 폴더 |
| `CELL_LAB_DEBUG_PORT` | 데스크톱 앱 원격 디버깅 포트 (1024–65535) |

### 프로토콜 docx 변환

```bash
npx tsx scripts/convert-docx.ts <입력.docx> <출력.md>
```

`seed/protocols/western-blot-v1-1.md`는 이 스크립트로 만든 결과입니다. 손으로 고치지 말고 변환기(`src/server/protocol-import.ts`)를 고칩니다.

### Release

`package.json` 버전과 같은 `v*` 태그를 push하면 GitHub Actions가 macOS(arm64·x64)·Windows 설치 파일을 빌드하고, 패키지 앱을 새 사용자로 실행해 확인한 뒤 Release에 올립니다. 릴리스 노트는 README의 `## <버전> 변경 사항` 절에서 가져옵니다.

## 0.1.0 변경 사항

- 첫 버전: 세포주·stock 계보, 배양 조건·SOP·문헌/분양처 비교, Bradford·BCA 정량, Western blot 실행·기록, 프로토콜 라이브러리.
- 계보·기록 작업 공간: 배양 그래프, 날짜별 기록표, 오늘의 빠른 기록, confluency 추이, 동결·stock 재고를 연결하고 선택한 배양을 URL에 유지합니다.
- 차가운 반투명 유리 소재의 새 화면 디자인과 세포주·배양 바로가기, 넓은 화면의 두 열 배치 및 좁은 화면의 한 열 배치를 제공합니다.
- 내장 프로토콜은 모두 **draft**입니다. 실제 실험 전에 분양처 지침·실험실 SOP와 대조하고, AI 추출 결과는 반드시 원문 근거로 확인하세요.
- macOS 배포본은 ad-hoc 서명만 적용하며 **Apple 공증을 받지 않았습니다**. Windows 설치 파일도 서명되지 않았습니다.

## 라이선스

[MIT](LICENSE)
