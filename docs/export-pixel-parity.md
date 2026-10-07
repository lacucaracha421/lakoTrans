# 화면·출력 조판 검증 (v3.2.2)

## 실제 재현과 수정

Windows 150% 배율의 Electron 편집 화면에서 `제1상·전신`은 한 세로 열이었다.
같은 페이지를 출력하는 DPR 1 창에서는 67px 글꼴의 글자 advance가 80px에서
81px로 달라졌다. 여섯 글자가 481.038px 영역에 들어가지 않아 마지막 두 글자가
다음 열로 넘어갔다. 계산된 `lines: null`, `overflow: false`만으로는 실제 DOM의
줄바꿈을 검증할 수 없었다.

세로 텍스트도 기존 측정기의 결과를 명시적인 열로 렌더링한다. 각 grapheme의
advance, 공백, 자간, 결합 문장부호는 측정과 같은 계약으로 고정하며 글꼴 크기를
줄이지 않는다. 열 너비는 전체 run의 최대 글자 크기와 lineHeight로 정한다.
명시적 개행, rich text, 장평, 대시와 문장부호의 기존 의미를 보존한다.

## PSD 표시 계약

기본 가시 레이어는 출력 세션의 원본 크기 완성 이미지이며 merged preview와
동일한 픽셀이다. 개별 배경·글자 래스터와 편집용 글자는 별도의 숨긴 그룹에 둔다.
글자 하나를 캡처할 때도 전체 페이지를 조판한 뒤 표시할 블록만 선택하므로
대사 크기 맞춤과 폰트 추정의 peer 문맥이 유지된다.

편집 가능한 기본 가로 텍스트는 실제 크기·명시적 줄바꿈·PostScript 폰트명·비율
장평·픽셀 외곽선으로 기록한다. 폰트명을 해석하지 못하거나 곡선·왜곡·복합 스타일
등을 표현하지 못하는 경우 래스터를 보존한다. 숨긴 텍스트는 편집 보조 자료다.
사용자가 이를 켜고 편집하면 대상 앱의 글꼴 대체, 문단 조판과 회전 기준 때문에
세부 위치가 달라질 수 있다. Photoshop 자체 실행 검증은 수행하지 않았다.

## 검증 근거와 한계

- 실제 문제 페이지의 production ImageStage와 production export session을
  Windows DPR 1.5와 DPR 1에서 비교했다. 확대율 0.5/0.75/1/1.25 모두 같은 한 열이다.
  마지막 세대의 글자 셀 위치 차이는 최대 0.02088px, 열 너비 차이는 0.00522px다.
- 같은 native DPR의 확장 사례 세 개에서 화면·PNG의 픽셀 차이는 0이다. PSD 가시
  완성 이미지와 merged preview도 원래 합성 이미지와 픽셀 차이 0이다.
- 자간 ±0.1, 반각·전각 공백, 결합 문장부호, 연속 대시, 명시적 개행을 실제
  Chromium에서 확인했다. 넓은/좁은 production UI QA도 직접 확인했다.
- DPI가 다르면 글꼴 hinting과 안티앨리어싱으로 glyph 경계가 최대 1px 다를 수
  있다. 물리 화면 캡처와 모든 DPI의 출력 바이트가 같다는 의미는 아니다.
- JPG 및 손실 WebP의 압축 차이, 축소 해상도의 리샘플링은 형식 자체의 특성이다.
  조판은 공통이며 PNG/PSD 원본 출력에 손실 압축을 추가하지 않는다.
- 숨긴 개별 PSD 래스터를 다시 합성하면 알파 양자화로 채널값 1~2 차이가 생길 수
  있다. 기본 가시 완성 레이어는 이 재합성을 하지 않는다.

로컬 검증: `.bug-hunter/export-parity-20261007/postfix-final-verification.json`,
`postfix-harness-verification.json`, `psd-postfix-review.json`.
UI 캡처: `C:/tmp/export-parity-wide-final.png`,
`C:/tmp/export-parity-narrow-final.png`.
실제 출력: `C:/tmp/export-real06-postfix-final-20261007/artifacts/real-page-native.png`.
사용자의 원본, 보관함과 기존 출력은 수정하지 않았다.

## 품질 게이트

기존 coverage floor는 유지한다. 새 `fontPostScriptName.ts`, `psdFontResolver.ts`의
최초 Windows V8 계측은 각각 line 96.29%/95.45%, branch 87.17%/86.36%다.
집중 검사 9개로 새 레코드만 추가했고 전체 게이트에서 다시 검증한다.
기존 accepted 계측 파일을 백업한 뒤 새 두 레코드를 합친 artifact의 SHA-256은
`77bdf6ab36ca10ebc252a472e42793e8a029fe9003daa798779b81f5a6f53fe5`다.
PSD 폰트 어댑터가 기존 저장 경로·오류 기록 권위를 직접 사용하므로 `appPaths`
소비자 상한 34, `logger` 49를 실측 기록했다. 전역 의존성 예산은 유지한다.
