# Flux 효과음·연결 말풍선 추가 검증 (2026-10-04)

이 기록은 `flux-quality-20261004.md`의 첫 32페이지 검증 이후 추가한 회귀 수정이다.
기존 검증은 연결 말풍선의 전 유형을 확대 감사한 것이 아니었다. 이번에는 보관함의
다른 14페이지를 골라 복잡한 배경의 효과음, 2개/3개 연결 말풍선, 한 블록 재시도를
실제로 실행했다. 페이지 번호는 `.tmp/flux-quality-20261004/new-candidates.json`의
고정 case 번호이며 만화의 인쇄 페이지 번호와 다르다.

## 실행 경로와 데이터 권위

- 일반 원문 지우기: production `processInpaintingPage` → 실제 Koharu 검출/prepass →
  `inpaintPatternPage` → 설치된 CUDA Flux runner → 실제 최종 합성/말풍선 후처리.
- 효과음 번역 후 지우기: 대사 지우기 결과에 보관함의 실제 효과음 블록을 추가한 뒤
  production `inpaintCreatedSoundEffectBlocks` 실행. 파일 저장 포트만 `.tmp` 복사본으로
  연결했다. 실제 모델·마스크·픽셀 합성은 mock이 아니다.
- OCR/번역과 효과음 위치는 저장된 앱 블록을 사용했다. 외부 번역 서비스나 새로운 OCR
  인식률을 평가한 실험이 아니다. Koharu의 말풍선/글자/SFX segmentation은 다시 실행했다.
- 원본, 보관함 chapter JSON, 기존 출력은 쓰지 않았다. 원본과 실험 입력 사본의 SHA-256,
  저장 페이지 메타데이터 일치는 `new-source-preservation.json`에 기록한다.
- 첫 `new-baseline`은 전체 지우기 후 효과음 재시도까지 실행한 스트레스 실험이다.
  신규 효과음의 첫 지우기 평가는 별도 `sfx-flow-*` 실험으로 구분한다.

## 발견한 결함과 수정

### 효과음 전용 경로의 정밀 마스크 누락

`inpaintCreatedSoundEffectBlocks`가 일반 Flux 작업과 달리 마스크 prepass 없이 호출됐다.
선택한 효과음만 대상으로 같은 production prepass를 실행하고 typography segmentation과
hard constraint를 전달한다. 기존 지운 이미지 보존은 계속 활성화한다. 임시 render geometry는
저장 전에 원래 값으로 복원한다. 다른 엔진은 기존 경로를 유지한다.

### 연결 말풍선의 마스크 구멍과 렌더링용 분리 여백

case 10의 연결된 각진 말풍선에서 글자 일부가 수평 띠처럼 남았다. 원시 bubble logits에
잉크 위치와 겹치는 작은 내부 구멍이 있었고, erosion과 보수적인 행 구간 변환이 이 구멍을
더 크게 만들었다. 임시 원문 지우기 마스크에만 내부에 완전히 갇힌 구멍을 메운다.
외부와 이어진 홈, 검출 외곽, 사용자 수동 도형은 이 보정으로 확장하지 않는다.

또한 같은 블록의 연결 영역을 렌더링 목적으로 분리하거나 소비 시 다시 분리하는 처리를
임시 지우기 마스크에서는 생략한다. 일반 렌더링 프로파일의 기존 분리 동작은 그대로다.
블록 간 ownership 분할은 유지하므로 하나만 재시도할 때 이웃 원문을 지우지 않는다.
분리 여백 생략만으로는 case 10 문제가 해결되지 않았으며, 실제 개선은 내부 구멍 보정을
포함한 결과로 확인했다. 여백을 일괄 축소하는 실험은 제품에 적용하지 않았다.

### 모델 입력 마스크와 최종 쓰기 영역의 소유권 불일치

넓은 모델 입력 마스크가 먼저 픽셀을 선점하면 뒤 블록의 실제 글자 core가 모델 입력에서
빠질 수 있었다. 최종 composite core를 우선 배정하고, 남은 픽셀에 모델 입력 및 padding
소유권을 배정한다. 기존 중복 블록의 완전 포함 처리는 유지한다. CUDA/Metal 공통 경로의
실제 worker protocol 테스트로 두 번째 글자가 자기 입력 마스크에 들어가는 것을 검증한다.

### 여러 효과음을 묶은 검출 인스턴스의 잘못된 공유

case 3은 하나의 onomatopoeia 인스턴스가 사슴 무리 패널의 여러 `ド`를 함께 포함했다.
각 블록이 그 인스턴스 전체를 자기 core로 가져와, 나중 효과음은 제대로 처리되지 않았다.
말풍선 ownership이 없는 일반 효과음은 자기 source association 영역 안에서만 인스턴스를
rasterize한다. dilation/feather는 그 다음 적용한다. 연결 말풍선은 기존 ownership mask가
권위이므로 compact OCR box로 강제로 자르지 않는다.

새 모델·프롬프트·시드·스텝 변경은 없다. 앞선 말풍선/효과음 prompt 분기와 native 수정은 유지했다.

## 사례 구성

| case | 주요 검수 대상                                         |
| ---- | ------------------------------------------------------ |
| 1    | 나뭇결·속도선 위 큰 효과음, 좁고 긴 인접 효과음 말풍선 |
| 3    | 사슴 무리·뿔·해칭 위 반복되는 큰 검정 `ド`             |
| 7    | 머리카락·의상·꽃무늬 톤 위 흰 외곽선 효과음            |
| 9    | 갑옷·바닥 균열 위 큰 효과음                            |
| 10   | 원형 2개 연결, 각진 3개 연결, 아래쪽 겹친 말풍선       |
| 11   | 대각선 2개 연결, 세로 2개 연결                         |
| 13   | 어두운 의상·그라데이션, 세로 연결 말풍선               |
| 14   | 꽃무늬·종이·실내 배경의 작은 반복 효과음               |
| 17   | 어두운 머리카락을 가로지르는 긴 효과음                 |
| 18   | 해칭·흰 글자와 불규칙 말풍선                           |
| 19   | 창문·실내 선화의 반복 효과음과 연결 말풍선             |
| 21   | 동물 털·목재 위 큰 효과음                              |
| 22   | 마법진·가는 선·톤 위 흰 효과음                         |
| 23   | 전투 장면의 조밀한 속도선과 큰 효과음                  |

## 근거 파일

모두 `.tmp/flux-quality-20261004/` 아래에 있다.

- `new-baseline/`: 수정 전 production 전체 페이지 + 효과음 재시도.
- `connected-fixed/`: 구멍/연결 영역 수정의 중간 검증. 최종 전체 검증과 혼동하지 않는다.
- `new-final/`: 최종 production 전체 페이지 결과, `report.json`, `calls.json`.
- `sfx-flow-before/`, `sfx-flow-fixed/`, `sfx-flow-final/`: 효과음 최초 지우기 경로 비교.
- `connected-single-2/`, `connected-single-3/`, `connected-single-8/`:
  case 10의 블록 2/3/8 및 case 11의 블록 2를 각각 선택한 실제 재시도.
- `single-balloon-parity.json`: 선택하지 않은 모든 대사 bbox의 RGB 변경 픽셀 수.
- `connected-hole-mask-fix.png`: 내부 구멍 때문에 잘리던 획의 마스크 수정 전후.
- `new-final-*.jpg`: 원본 / 이번 수정 전 / 최종 결과 비교.
- `new-final-check.log`: 전체 check 결과.

실행 성공이나 `blocksErased` 숫자만으로 시각 품질을 합격 처리하지 않는다. 최종 합성
허용 영역 밖 RGB 변경 검사와 실제 이미지 확대 검수를 함께 한다. 이 검사의 허용 영역은
실제 hard constraint이며, constraint가 없는 fallback은 window + 32 px로 보수적으로 잡는다.
글자에 가려져 원본에 보이지 않는 배경의 정답을 복원했다고 주장하지 않는다.

## 최종 검증

- 서로 다른 새 14페이지 + 기존 32페이지 = 46페이지를 production 경로로 실행했다.
- 새 전체 페이지 129회, 기존 32페이지 173회, 효과음 후속 경로 23회,
  연결 말풍선 단일 선택 4회로 최종 코드의 native crop 완료 로그는 329회다.
  중간 실험과 synthetic capture는 이 숫자에 포함하지 않았다.
- 기록된 최종 합성 허용 영역 밖 RGB 변경은 전부 0이다.
- 단일 말풍선 선택 4회에서 선택하지 않은 대사 bbox 40개는 변경 픽셀 0이다.
- 효과음 후속 지우기 3페이지에서 먼저 지운 대사 bbox 7개는 변경 픽셀 0이다.
- 기존 32페이지 중 23페이지는 앞선 최종 결과와 RGB가 완전히 같다.
  달라진 9페이지는 원본/이전/현재 비교 이미지를 직접 검수했다. 보관함의 기존 출력과
  비교한 것이 아니라 `final-semantic`/`holdout-semantic`의 앞선 검증 결과와 비교했다.
- 보관함 새 14페이지의 원본 hash와 페이지 metadata, 앞선 32개 원본 hash 및
  기준 chapter snapshot 보존을 확인했다. 실험은 복사본에만 썼다.
- Node 26.10.0에서 `npm run check`의 실제 실행 스크립트 `scripts/check.cjs`가
  388.56초에 통과했다. 테스트 10,136개 성공 / 9개 skip / 실패 0.
  타입 검사, lint, architecture, coverage, build, artwork parity, protocol/bundle smoke 포함.
- 커버리지 inventory에 새로 수정한 기존 파일 3개를 추가했다. 원래 baseline artifact의
  SHA-256 `a0e1199f46a80734d228ff1772b99d1fde2f700321346da77abf9c29795e4c0a`를 확인하고
  그 파일들의 기존 수치를 그대로 등록했다. 기존 floor는 낮추지 않았다. 범위 817 → 820.
  priority core의 잘못된 길이/경계 입력과 비 Flux 엔진 경로도 테스트에 추가했다.

근거: `final-validation-summary.json`, `regression-comparison.json`,
`sfx-dialogue-parity.json`, `single-balloon-parity.json`, `new-source-preservation.json`,
`source-preservation.json`, `new-final-check.log`.

## 시각적 제한과 채택하지 않은 실험

실행 완료가 모든 글자 제거 성공을 뜻하지 않는다. case 1의 말풍선 테두리에 걸친 효과음,
case 9의 다리 주변 `オ`, case 13의 검은 의상 위 흰 외곽선, case 22의 큰 흰 효과음에는
여전히 일부 원문 획이 남는다. case 17의 긴 효과음은 저장된 source bbox 자체가 전체 글자를
포함하지 않는다. 자동으로 페이지의 모든 글자를 지웠다고 보고하지 않는다.

일반 대사도 원문 bbox 밖의 같은 검출 인스턴스 전체를 가져오던 동작을 제한했으므로,
이전 main 18/19/21 등의 미선택 효과음이 이제 보존되는 차이가 있다. 이웃 글자를 마음대로
지우는 것을 품질 개선으로 계산하지 않는다. main 18과 holdout 6의 경계 쪽 작은 잔여 획은
확대 검수에서 확인했으며, 전 페이지 무결점이라는 주장은 하지 않는다.

case 9/13/22에서 효과음 source 영역 전체를 최종 합성하는 `region-probe`도 실행했다.
남은 획은 줄었지만 case 22에서 인물의 머리 모양과 주변 선화가 변했다. 이 실험은 제품에
적용하지 않았다. 정밀 합성 경계 밖 RGB가 0이라는 검사는 경계 안 그림의 무손상을
보증하지 않으므로 시각 검수를 함께 해야 한다.

같은 3페이지에서 `steps8-probe`(말풍선은 4스텝 유지, 나머지만 8스텝)와
`context64-probe`(앱의 crop context 160 → 64px)도 실제 native로 실행했다.
8스텝은 case 13의 일부 획을 더 제거했지만 case 22에 원래 없던 작은 말풍선을 만들었다.
64px는 case 9의 일부 효과음을 더 지웠지만 위쪽에 가짜 말풍선/글자를 생성했고,
case 22에서도 원래 없는 말풍선이 생겼다. 두 설정 모두 제품에 적용하지 않았다.
3개 실험군은 각각 3페이지/25 native crop, 총 75회 완료다. 최종 코드 검증 329회와
합치면 최종 및 추가 비교만 404회이며, 중간 baseline/진단 capture는 별도다.
`rejected-experiments.json`과 `region-probe-*.jpg`, `steps8-probe-*.jpg`,
`context64-probe-*.jpg`에 실패 근거를 보존했다.

현재 체크 통과와 적용된 4개 수정은 기능/경계 검증 결과다. 남은 시각 실패까지 해결된
것으로 간주하지 않는다. 실제 번역 API나 UI 클릭을 새로 실행한 테스트가 아니라,
보관함의 실제 블록을 이용해 production 페이지 작업 및 효과음 후속 작업 함수를 실행한
GPU 검증이다. 저장된 효과음 영역 밖의 누락과 모델 생성 실패는 별도로 남아 있다.

## 2026-10-05: 39화의 일괄 지우기 잔여물 재현

사용자가 지정한 「전생했더니 평민이었습니다. ～생활 수준을 견딜 수 없어서 귀족을
목표로 합니다～」 39화의 6/9/10/12페이지를 앱의 `createWorkflowImages().erase`로
실행하면 보관함 출력과 같은 연결부에 원문 획이 남았다. 앞선 개별 작업 경로
`processInpaintingPage`만으로는 이 차이를 재현하지 못했다.

### 원인과 적용한 수정

- 일괄 작업은 모든 블록을 선택해도 `blockIds`를 명시적으로 전달한다.
  `runBubbleLayoutMaskPrepass`가 인자 존재만 보고 부분 선택으로 판정하여, 전체 선택에도
  이웃 보호용 간격을 남겼다. 이제 실제 미선택 owner 존재 여부를 검사한다. 전체 선택은
  간격 0으로 연결 영역을 합치고, 단일/부분 선택에는 기존 보호 간격을 유지한다.
- 렌더링용 profile은 여러 scanline의 교집합과 최장 구간만 저장하므로 곡선 경계와
  분리된 짧은 구간을 잃는다. 지우기는 이미 안전 inset과 ownership 분할이 적용된
  raster를 작업 메모리에서 그대로 전달한다. 렌더링 profile과 보관함 데이터 계약은
  유지하며, 수동 영역은 자동 raster로 덮어쓰지 않는다.
- `sourceEraseConstraintsByBlock`을 일반 작업, 일괄 작업, 효과음 후속 경로까지 전달한다.
  마스크의 정수 좌표·크기·페이지 경계·typed array를 기존 validator에서 확인한다.
  기존 typography 합성과 최종 hard constraint는 유지한다.
- 단일 선택을 실제 GPU로 검증하니 geodesic ownership이 이웃 글자 끝까지 침범했다.
  미선택 원문 bbox + 2px를 최종 composite core/envelope에서 제외한다. 모델 입력 마스크는
  유지한다. 입력까지 잘랐던 `single*-protected` 실험은 6페이지에 가짜 글자를 생성하여
  폐기했다. `single*-composite`가 최종 검증 결과다. 붙여넣은 overlay처럼 원문이 없는
  `inpaintExcluded` 블록은 보호할 원문 owner로 취급하지 않는다. 이를 구분하지 않은
  `diverse24-composite`에는 선택한 글자가 남았으며, 사용자도 해당 잔여물을 지적했다.
  이 중간 결과를 합격이나 최종 출력으로 사용하지 않는다.
- source-mask 요청의 `imagePath`도 원본으로 통일했다. 실제 production detector는 이전에도
  원본을 사용했으므로, 이것을 이번 잔여물의 원인으로 해석하면 안 된다.

외곽 안전 inset, 검출 영역, 실제 부분 선택의 ownership 간격을 일괄 확장한 수정이 아니다.
보호된 이미지 알고리즘의 경계/선택 동작은 characterization test로 고정했다.

### 검증 방법과 한계

실험 자료는 `.tmp/overlap-erasure-20261005/`에 있다. `workflow-run.cjs`는 실제 production
workflow와 Koharu 검출, 설치된 Flux CUDA native runner, 픽셀 합성, 결과 파일 저장을
사용한다. engine lease만 동일한 실물 엔진을 재사용하도록 연결했다. 원본을 `.tmp`로
복사하고 저장된 OCR 블록을 입력으로 사용했으며, 새 OCR/번역 API/UI 클릭 시험은 아니다.
전체 페이지 결과는 원본부터 새로 처리한 `workflow-final`과 `diverse-final`을 기준으로 한다.
기존 지운 결과 위에 재실행한 `final-chapter39`는 unchanged/incomplete가 섞인 진단군이며
성공 페이지 수에 포함하지 않는다.

39화의 연결부는 `workflow-compare-6/9/10/12.png`에서 원본/일괄 경로 수정 전/수정 후를
비교한다. `workflow-contact-*.jpg`, `diverse-contact-*.jpg`는 원본/최종 출력 검수용이다.
외부 RGB 변경은 실제 hard constraint 바깥에서 검사하며, constraint 없는 fallback은
기존 window + 32px를 허용 영역으로 사용한다. 이 수치가 영역 내부 배경 복원의 정답이나
모든 글자의 완전 제거를 보증하는 것은 아니다.

추가 작품 9번 「오토메 게임의 악역 귀족으로 환생했기에, 돈의 힘으로 메인 히로인을
사 보았다.」 2화 2.png에서는 테두리 근처 후리가나가 안전 검출 영역 밖에 남는다.
`diverse9-furigana-diagnosis.png`에 입력/출력/model/core/constraint를 기록했다. 보관함의
이전 출력에도 같은 후리가나가 남아 있었다. 39화 31/32페이지의 검은 배경·무늬 위 글자,
추가 작품 9/18/24번의 일부 영역에는 모델이 만든 선·얼룩 등 별도 품질 실패도 있다.
추가 작품 30번의 신문 형식 페이지에도 일부 본문이 남는다. 말풍선 연결부 외의 검출 누락과
모델 생성 품질까지 해결됐다는 의미로 837블록의 실행 완료 숫자를 사용하면 안 된다.
이번 연결부 수정으로 이 실패까지 해결됐다고 판정하지 않는다. 외곽을 넓혀 그림까지
지우는 우회책은 적용하지 않았다. 실제 GPU 검증은 Windows CUDA이며 AMD/macOS 실행을
확인한 결과는 아니다.

### 최종 실제 실행 근거

- 39화 전체 35페이지/426블록과 서로 다른 추가 32작품의 32페이지/411블록을 처리했다.
  합계 33작품, 고유 67페이지, 837블록이며 실행상 incomplete는 0이다. 모든 원본/출력을
  contact sheet로 직접 검수했고 의심 위치는 확대했다. 이 숫자는 시각적 무결점 수가 아니다.
- 위 전체 페이지 native crop은 328 + 318 = 646회다. 단일 선택 최종 2회가 별도다.
  중간 실패 실험과 이후 확인용 재실행은 이 수치에 합산하지 않는다.
- 최종 코드로 67페이지의 model/core/constraint 마스크를 다시 생성해 기존 실제 GPU
  실행의 마스크와 픽셀 단위로 모두 일치함을 확인했다(`full-mask-parity.json`).
  단일 선택 최종 2페이지도 일치했다(`single-mask-parity-final.json`).
- 단일 선택 2페이지에서 미선택 원문 bbox 27개의 변경 픽셀은 전부 0이다.
  `single-final.json`, `single-final-6.png`, `single-final-10.png`에 기록했다.
  초기 `single*-final`은 보호 전 비교군이며 이름의 final을 완료 근거로 사용하지 않는다.
- 사용자 스크린샷의 추가 작품 24번은 최종 코드로 native crop 14회를 다시 실행했다.
  `diverse24-final-verified`와 `user-residue-final-comparison.png`에서 지적된 두 말풍선의
  원문 조각이 제거되고 테두리·인물 선화가 보존된 것을 확대 확인했다. 이것은 별도
  확인 실행이며 고유 페이지/작품 수에 중복으로 더하지 않는다.
- 67개 원본 파일 SHA-256은 최초 inventory와 모두 같다(`source-preservation.json`).
  실험 출력은 `.tmp`에만 저장했다. 작업 중 보관함 39화 9/19/21/22페이지에는 별도의
  `renderBbox`/수정시각 변경이 관측됐으므로 메타데이터 전체 불변을 주장하지 않는다.
  이 변경을 되돌리지 않았으며 원문 bbox·원본·기존 출력 경로는 보존됐다.
- 기존 파일 `bubbleLayoutRunnerPatches.ts`의 coverage floor를 동결 baseline artifact에서
  그대로 추가했다. SHA-256은 `a0e1199f46a80734d228ff1772b99d1fde2f700321346da77abf9c29795e4c0a`다.
  기존 floor를 낮추지 않았고 inventory는 826 → 827이다.
- 최종 코드에서 Node 26.10.0으로 `scripts/check.cjs`가 353.59초에 통과했다.
  테스트 10,223개 성공 / 9개 skip / 실패 0이다. 타입 검사, lint, architecture,
  coverage floor, build, artwork parity, image protocol, renderer/preload bundle smoke를
  포함한다. 근거는 `check7.log`다. UI 변경은 없으며 별도 UI 캡처로 대체한 검증이 아니다.
