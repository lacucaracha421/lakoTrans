# 반복 초기화와 중복 처리 수정

2026-10-03. 기준 `f72a5895`(v3.1.0), 작업 브랜치
`codex/runtime-efficiency-fixes`. 수정은 [v3.1.1](release-notes/v3.1.1.md)에 반영한다.
모델 자산의 별도 릴리스는 포함하지 않는다.

## 수정 범위

| 경로                        | 변경                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #136 기존 블록 유지 번역    | 모든 대상의 최신 편집 입력을 먼저 인계받고 OCR을 배치로 완료한 뒤 번역한다. 같은 페이지를 다시 인계받지 않는다. 체크포인트 재검사 후 실제 추가 OCR이 필요할 때만 번역 세션을 종료한다.                                                                    |
| EFF-1 새 워크플로 원문 제거 | erase 단계가 기존 native workload를 소유한다. 각 페이지는 같은 모델을 빌리고 단계 종료 시 실제 정리를 기다린다.                                                                                                                                           |
| EFF-2 MCP 선택 번역         | 선택 작업에서 endpoint를 재사용한다. 상위 workflow가 소유한 같은 종류의 workload는 명시적으로 빌린다.                                                                                                                                                     |
| EFF-3 MCP 선택 OCR          | crop을 준비한 뒤 한 번의 OCR batch로 읽는다. 같은 페이지는 디코드를 공유하고 다음 페이지에서 교체한다. 알려진 블록과 자유 영역의 서로 다른 탐지 계약은 유지한다.                                                                                          |
| EFF-4 MCP 워크플로 OCR      | 화 안의 미완료 OCR 페이지를 첫 native 작업에서 함께 준비한다. 추가 페이지도 기존 예약·편집 인계를 거치고 저장·receipt는 각 단일 페이지 작업을 사용한다. 배치 후와 나중에 결과를 소비할 때 원본·revision·문맥을 다시 검사한다. 화별 cache 경계는 유지한다. |
| EFF-5 C23 GPU 글꼴 분석     | 줄·글자·복구 단계에서 Hayai 자식을 재사용한다. GPU는 항상 한 자식이며 기존 CPU 풀 정책은 유지한다.                                                                                                                                                        |
| EFF-6 기존 블록 crop        | 기존 known-block-crop 계약으로 확정된 영역 안의 재탐지를 생략한다. padding·크기·블록 기하는 유지한다.                                                                                                                                                     |
| EFF-7 규칙·검토             | 단계 안에서 숨은 Chromium을 재사용한다. preparePage가 실제 페이지·폰트·레이아웃을 준비하고 불필요한 PNG 캡처를 생략한다.                                                                                                                                  |
| EFF-8 MCP 일괄 출력         | 배치와 workflow 출력 단계가 renderer를 공유한다. 출력별 권한·원본·revision·시간 제한·PSD 계약과 부분 결과는 유지한다.                                                                                                                                     |

범위 밖의 단일 요청은 기존처럼 요청 종료 시 정리한다. 빈 작업은 자원을 생성하지
않고 취소·실패·정리 오류는 기존 소유권과 오류 전파 경계를 따른다.
사용자 library·원본·출력·설정은 수정하지 않는다.

## 실제 실행 근거

격리된 `.tmp/runtime-efficiency-real-20261003`에 결과를 보존했다.

- RTX 4090 / Hayai GPU / Gemma 12B QAT / rtx50 런타임의 동일 합성 4페이지에서
  기존 keep 모드의 OCR 프로세스와 Gemma endpoint가 각각 **4회 → 1회**.
  수정 후 약 **39.4초**, 네 페이지 모두 `こんにちは → 안녕하세요`였다.
  이전 약 192초에는 최초 런타임 설치가 포함되므로 개선 배수를 계산하지 않는다.
  사용자 신고의 RTX 5060 Ti 16GB와 다른 장비다.
- C23 GPU transport는 기존 단발 실행과 줄·글자·두 복구 배치를 비교했다.
  **8개 OCR JSON 전체 payload 동일**, 재사용 PID 하나. 배치 8, 최대 생성 96토큰,
  256 patch와 device 계약을 보존한다. `font-transport2/verification.json`.
  첫 검증기의 cp949 읽기 실패는 UTF-8 지정 후 재실행했다. 전체 폰트 모델의
  품질 재평가로 세지 않는다.
- 가로쓰기·여러 줄·세로쓰기 합성 crop은 실제 detector+Hayai와 known-block
  경로에서 같은 정답을 반환했다. `crop-quality/verification.json`.
  실제 만화 전체 분포의 품질 평가를 대신하지 않는다.
- 실제 Electron production renderer에서 정상 번역·원문과 동일한 번역·빈 번역을
  비교했다. 이전 PNG 렌더 후 계측과 새 준비 후 계측의 결과 및 다시 캡처한 픽셀이
  동일했다. `renderer/verification.json`, PNG 3개를 보존한다. 합성 입력은
  인페인팅을 제외하므로 배경 원문이 남아 있다.

회귀 검증에는 모델 획득/반환, 페이지 실패, 상위 workflow 재사용, OCR 결과 누락,
취소 중 정리 장벽, 원본 교체, renderer 취소와 분리 호출을 포함한다.
기존 감사는 `.bug-hunter/runtime-efficiency-20261003`, 최종 검사 기록은
`.bug-hunter/runtime-efficiency-fixes-20261003`에서 관리한다.

최종 `npm run check`의 26개 검사가 모두 통과했다. 테스트 10,050개 통과,
8개 건너뜀, 실패 0개이며 기존 커버리지 기준, production 빌드, 실제 페이지
픽셀 비교와 이미지 프로토콜 검사도 통과했다. 내장 자산 36개 검증도 완료했다.

## 계약과 rollback

C23 모델 bytes·공개 tag·cache version은 유지한다. Python transport의 SHA-256만
앱 권위인 `fontChapterC18Manifest.json.runtimeSources`에 반영한다.
되돌릴 때 transport와 source binding을 함께 되돌린다.

새 OCR 조정자가 library gateway와 McpEditError를 직접 사용하는 실측 consumer
상한은 각각 81과 246이다. 전역 예산이나 기존 알고리즘은 바꾸지 않는다.
새 두 모듈의 최초 Windows 커버리지는 `.tmp/runtime-efficiency-initial-coverage.json`,
SHA-256 `f1d5d2f9c07350dae0f81b54f0fd38ac0b03395f41fd065b3376f74c9a0e3645`에서 등록했다.
기존 커버리지 기준과 역사 artifact/provenance는 유지한다.

Rollback은 이 수정의 source·tests·source binding·새 모듈 inventory를 함께 되돌린다.
배포 자산, library 또는 기존 결과물을 지우는 절차는 없다.

## 2026-10-07 이미지·데이터 경로 추가 최적화

기준 `b3aa5184`, 브랜치 `codex/efficiency-preserve-quality`. #138에서 시작한
전수 선별의 확인 항목 20개 중 19개를 적용한다. 이번 변경의 앱/모델 릴리스는
수행하지 않았다. 감사와 검증 기록은 `.bug-hunter/efficiency-20261007`에 있다.

| 확인 항목                  | 적용 경계                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RENDER-1, RENDER-2         | 목록·작업 버튼·기록은 CSS 크기와 화면 배율에 맞는 서명된 파생 PNG를 요청한다. 큰 효과음 편집 화면과 상세 뷰어는 원본 요청을 유지한다.                                                        |
| RENDER-3                   | 블록 보관함의 Artwork만 화면 근처에서 마운트한다. 포커스된 카드는 화면 밖에서도 유지하며 카드 컨트롤과 편집기 원본은 그대로다. 보이는 카드의 원본 이미지·마스크·효과를 임의 축소하지 않는다. |
| RENDER-4                   | 분리 패널의 글꼴 계산용 주변 블록에서 generatedLettering을 제외한다. 선택된 블록의 편집 데이터는 완전하게 전달한다.                                                                          |
| RENDER-5                   | 자동 저장은 동일한 CAS·활동 잠금·트랜잭션으로 저장하고, 변경 페이지와 화 헤더만 응답한다. 기존 전체 응답 API도 유지한다.                                                                     |
| RENDER-6                   | 다중 글꼴 크기 변경에서 원래 페이지의 공통 계산을 한 번 수행한다.                                                                                                                            |
| MAIN-2                     | 보호 마스크의 영역 부분만 만들고 원본을 먼저 crop한 뒤 보호 픽셀을 처리한다. 전체 페이지 PNG 중간 변환을 제거한다.                                                                           |
| MAIN-3                     | 한 출력 요청의 커스텀 폰트 목록을 재사용한다. 개별 폰트 파일의 존재·안전한 경로 검사는 유지한다.                                                                                             |
| MAIN-4                     | 화 요약만 최대 4,096개 캐시하며 dev/ino/size/mtimeNs/ctimeNs로 재검증한다. 차가운 전체 목록 읽기도 동시 수를 제한한다.                                                                       |
| MAIN-5                     | 알고 있는 workId를 화 열기에 전달하고 기존 소유권 검사로 검증한다.                                                                                                                           |
| MAIN-6                     | 페이지 글꼴·원문 크기 분석이 한 번 디코딩한 BGRA를 공유한다. 워커 전송에는 독립 복사본을 사용해 다른 소비자의 버퍼를 detach하지 않는다.                                                      |
| FOLLOWUP-1                 | 마스크 미리보기는 같은 BGRA 픽셀을 nativeImage에 직접 전달해 전체 PNG encode/decode를 생략한다.                                                                                              |
| FOLLOWUP-2                 | 내보내기 선택기는 블록·인라인 이미지 없는 표시용 페이지 메타데이터만 요청한다. 실제 출력은 저장된 전체 페이지를 다시 읽는다.                                                                 |
| RUNTIME-EFF-1              | 프로덕션 폰트 실행은 사용하지 않는 진단 overlay를 만들지 않고 필요한 페이지의 probe만 준비한다. 연구 도구의 기본 진단 출력은 유지한다.                                                       |
| RUNTIME-EFF-2              | 글자 검증·군집·복구는 한 페이지의 RGB/L 래스터만 보유한다. 기존 처리 순서와 텐서를 유지한다.                                                                                                 |
| RUNTIME-EFF-3              | 짧은 singleton 글자 crop을 페이지별로 모아 같은 페이지를 반복 디코딩하지 않는다. 판정 순서는 유지한다.                                                                                       |
| RUNTIME-EFF-4              | 실제 모델 검토가 없는 singleton에는 crop·PNG·base64 작업을 생략한다. 외부 이미지 전처리·Codex·강화 이미지 등 기존 의미가 있는 준비는 유지한다.                                               |
| SHARED-EFF-1, SHARED-EFF-2 | 조건 일괄 편집의 인덱스와 matcher를 한 평가 동안 재사용한다. 중복 ID의 첫 위치, 누락 fallback, 정규식 lastIndex 격리를 보존한다.                                                             |

썸네일 생성은 원래 서명 URL을 같은 origin의 격리된 Chromium에서 읽는다.
브라우저의 EXIF/색상 해석과 투명도를 보존하고, 원본 파일을 쓰거나 바꾸지 않는다.
동시에 한 래스터만 처리하며 숨김 창은 유휴 30초 또는 앱/주 창 종료에서 정리한다.
완성된 PNG 캐시는 최대 128개/24 MiB이며 원본 버전과 요청 크기를 키로 사용한다.
크기 인자는 HMAC에 포함되므로 임의 변경·중복 query·만료된 원본 URL은 거부된다.
APNG, WebP, ICC/cICP/cHRM, 불확실한 헤더, 32M 픽셀 초과 등은 원본으로 돌아간다.
확대 크기가 파생 이미지 상한을 넘을 때도 원본을 사용한다.

MAIN-1의 MCP 미리보기 3200px 중간 캡처는 **적용하지 않았다**. 실제 production
PageArtwork의 3001×4003 합성 페이지를 1600px로 출력해 비교했을 때 47.3%의 픽셀이
달랐고 미세 선이 부드러워졌다. RGB 평균 절대 차이는 3.57/255였다. 사용자 요청의
화질 보존을 우선해 이 후보의 제품 변경과 전용 테스트를 되돌렸다. 비교 PNG와
실험 패치는 감사 아티팩트로만 보존한다.

실제 Electron 검증에서는 3001×4003 PNG가 128px 요청에서 96×128 PNG로 전달됐고,
원본 70,553바이트 대비 4,603바이트였다. 투명도와 EXIF6 JPEG 방향을 검사했으며
원본 요청·ICC·APNG fallback은 바이트가 동일했다. 모든 이미지에서 압축 바이트가
줄어든다는 뜻은 아니다. 이 경로의 핵심은 목록에서 디코딩하는 픽셀 수를 줄이는 것이다.
블록 보관함 QA는 82개 중 16~24개 Artwork만 마운트했고 스크롤·포커스·원본 편집을
확인했다. 출력 선택기는 120페이지 fixture로 1600×1000/820×900에서 확인했다.

보호 영역 crop은 기존 전체 처리 후 crop한 결과와 픽셀이 동일하다. Python의
페이지 RGB/L·glyph tensor, 조건 편집 135가지 출력과 이동한 스키마 215개 입력을
비교했다. C23 모델 자산·공개 tag/cache version은 유지하며 변경된 Python 소스의
`fontChapterC18Manifest.json.runtimeSources` binding만 갱신한다. 되돌릴 때도 해당
소스와 binding을 함께 되돌린다.

기존 파일의 커버리지 하한은 낮추지 않았다. 기존 sealed baseline에 있던 누락
4개 항목을 그대로 복원하고 새 6개 모듈의 최초 전체 Windows 실측만 추가했다.
이전 accepted capture는 감사 디렉터리에 SHA-256 이름으로 보존하고, 기존 capture
행도 그대로 유지한다. browser 모듈의 함수는 문자열로 격리 브라우저/VM에 전달되므로
Vitest의 원래 소스 커버리지에는 실행이 귀속되지 않는다. 직렬화된 스크립트의
16개 테스트, 이전/이후 46개 입력 비교와 실제 Electron smoke로 별도 검증했다.
구조 예산은 변경된 세 모듈의 실측 import/consumer 수만 반영했다.

실제 UI 캡처는 `C:/tmp/efficiency-export-wide.png`,
`C:/tmp/efficiency-export-narrow.png`, `C:/tmp/efficiency-sidebar-wide.png`,
`C:/tmp/efficiency-sidebar-narrow.png`, `C:/tmp/efficiency-library-wide-v2.png`,
`C:/tmp/efficiency-library-keyboard-narrow.png`,
`C:/tmp/efficiency-library-editor-narrow.png`,
`C:/tmp/efficiency-library-en-narrow.png`에 보존했다. 임시 QA 엔트리는 제거했다.
최종 썸네일 Electron 결과는
`C:/tmp/efficiency-native-final-20261007/electron-smoke-result.json`에 있다.

최종 `npm run check`의 동일 실행 스크립트 `node scripts/check.cjs`는 27개 gate를
모두 통과했다. Vitest 10,295개 통과/실패 0/기존 환경 의존 9개 skip이며, Python
C23 집중 테스트 7개도 통과했다. 타입 검사·lint·기존 파일별 커버리지 하한·빌드·
renderer/preload 경계·긴 경로 이미지 smoke를 포함한다. 실제 production PSD의
배경/텍스트 레이어/alpha 검증과 패널/출력 비교는 두 시나리오 모두
`mismatchedPixels=0`, `maxChannelDelta=0`이었다.
전체 로그는 `.bug-hunter/efficiency-20261007/implementation/check-complete.log`,
봉인된 결과는 같은 디렉터리의 `check-passed-timings.json`, `vitest-passed.json`,
`coverage-passed-summary.json`이다. 커밋·푸시·릴리스는 하지 않았다.
