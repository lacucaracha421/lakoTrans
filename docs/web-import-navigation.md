# 웹 가져오기 문서 이동 방어

`WebImportSessionManager`의 UI 이미지 가져오기, MCP 이미지 수집과 회차 탐색은 같은
격리 브라우저 정책을 사용한다. 사이트별 호스트 예외나 광고 목록은 사용하지 않는다.

## 동작

- 최초 요청과 기존 공개 주소 검사에 통과하는 HTTP 리다이렉트를 허용한다.
- 정상 외부 스크립트, 이미지 CDN, iframe 자체 탐색, 같은 문서의 hash/history 변경은
  유지한다. 페이지가 최상위 문서를 교체하는 이동과 팝업은 차단한다.
- 격리된 sandbox preload의 Navigation API 취소는 HTML parser가 중단되기 전에
  이동을 막는다. Node 기능이나 앱 bridge를 페이지에 노출하지 않는다.
- 브라우저의 `will-frame-navigate`에서도 최상위 이동을 동기적으로 취소한다.
  `loadURL()`의 `ERR_ABORTED`가 차단 이벤트보다 먼저 오는 경우에는 차단 URL,
  허용된 실제 문서 commit과 DOM 준비 증거를 함께 확인한 경우에만 계속한다.
- 초기 문서가 준비되지 않거나 다른 문서가 commit되면 성공으로 바꾸지 않는다.
  실제 로딩 오류, 취소, 창 종료와 기존 90초 제한을 유지한다. 스캔 종료 시 이벤트와
  abort listener를 해제하고 기존 소유권에 따라 브라우저와 임시 다운로드를 정리한다.

JavaScript로 다른 문서에 이동해야 하는 시작 링크는 자동 추적하지 않는다.
광고 요청이나 광고 이미지 전체를 제거하는 기능은 아니며 기존 이미지 크기 필터와
사용자 선택을 유지한다.

## 검증

`webImportNavigation.test.ts`는 중단/차단/DOM 이벤트 순서, 정상 리다이렉트,
문서 교체와 오류/취소/종료를 검증한다. preload 테스트는 같은 문서 탐색과 iframe을
방해하지 않는지 확인한다.

`webImportNavigationElectron.test.ts`는 실제 production manager, sandbox preload와
격리된 Electron을 사용한다. 공개 테스트 URL에 대한 응답만 테스트 세션에서 공급한다.
초기 parser 실행 중, DOM 준비 후, 스크롤 중 이동, iframe의 최상위 이동, 팝업,
SPA/hash 변경, HTTP 리다이렉트 및 preload가 없는 경우의 브라우저 복구를 검사한다.
외부 스크립트가 만든 이미지와 스크롤 후 추가 이미지의 실제 다운로드까지 검증한다.

실사이트 확인은 자동 테스트에 포함하지 않는다. 재현 URL은
`https://rawinu.com/unir-fujoshing-out-chapter-1.html`이며, 조사 시점 본문은
1115×1600 JPEG 27장이었다. 외부 스크립트를 차단하지 않은 빌드 결과를 별도로 기록한다.

2026-10-08 Windows 빌드의 기본 preload 경로로 해당 URL을 실행한 결과, 약 13.6초에
`ready`가 반환됐고 본문 JPEG 27장이 모두 포함됐다. 전체 후보는 31개, 다운로드 실패는
0개, 미지원 형식은 2개였으며 결과 잘림은 없었다. 광고 응답에 따라 본문 외 후보 수는
달라질 수 있다. 로컬 상세 근거는 `.bug-hunter/rawinu-20261008/production-smoke.json`과
동일 이름의 `.jsonl`에 보관한다. 테스트는 격리된 data root를 사용했고 보관함에
가져오기/저장하지 않았다.

새 두 모듈의 커버리지 하한은 Windows 전체 테스트의 실제 측정값으로 등록했다.
기존 파일의 하한은 변경하지 않았다. 최초 측정 원본은
`.tmp/web-import-navigation-coverage-20261008.json`이며 SHA-256은
`a717730846bb5487a9a979ef8cbae4764e0911ab6166d8bb2238677c4dc32e58`이다.
navigation의 lines/statements/functions/branches는 각각 80/81, 87/88, 19/19,
57/59이고 preload는 각각 4/4, 4/4, 1/1, 6/6이다.

최종 저장소 검증은 `npm run check`의 실행 파일인 `node scripts/check.cjs`로 완료했다.
전체 27개 검증 단계와 빌드가 통과했으며 테스트는 10,354개 통과, 9개 건너뜀,
실패 0개였다. 실제 Electron 회귀 테스트도 포함한다. 실행 결과는
`.tmp/check-timings.json`, `.tmp/check-results/vitest.json`,
`.tmp/rawinu-check-complete.log`에 남긴다. 커밋과 릴리스는 수행하지 않았다.
