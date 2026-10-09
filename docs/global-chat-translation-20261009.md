# 글로벌 채팅 번역 — 2026-10-09

## 구현 경계

번역 설정/실행 대화상자는 유지한다. 편집 본문은 `일반 번역`과 `채팅으로 번역` 두 주 버튼을 나란히 둔다.
오른쪽 패널은 헤더 한 줄에 아이콘 탭(편집/채팅)과 현재 모드의 컨트롤을 둔다.
편집 모드는 화 제목·페이지 수, 채팅 모드는 대화 선택·새 대화·압축을 둔다.
채팅 컨트롤은 `ChatPanel`이 헤더 슬롯으로 포털해 렌더한다. 편집 본문의
`채팅으로 번역`, 화가 열리지 않았을 때 보관함 도구 모음의 채팅 아이콘,
명령 팔레트는 `open-chat` 명령을 공유한다. 보관함 도구 모음은
`원본 추가 ▾`(새 원본·여러 화), 설정, `더 보기 ⋯`(보관함 폴더·작업 내보내기/가져오기)
한 줄이다. 채팅의 모델·추론 수준은 입력창 아래 칩 하나로, 현재 화면 맥락은 입력창
위 한 줄로 보이고, 상태 줄과 중지는 작업 중일 때만 보인다. 빈 대화에는 안내 문구나
예시 버튼을 두지 않는다.
오른쪽 편집/채팅 전환은 두 영역을 보존하며, 작품 이동은 대화/입력 초안을
초기화하지 않는다. 작은 창에서는 기존 오른쪽 패널의 확장 동작을 사용한다.

`ChatPanel → chatGateway → 검증된 IPC → application/ChatService →
CodexChatRuntime → Codex App Server → McpLocalHost → 기존 native MCP` 흐름이다.
번역 도구, 모델 호출 루프, 작업 큐, 글자 배치 알고리즘은 복제하지 않았다.
C23, 폰트 학습 자산과 자동 크기 계산은 변경하지 않았다.

기존 임시 Codex 작업은 기존의 ephemeral/delete/제한을 유지한다. 채팅은
bundled 0.160.0의 `thread/start`, `thread/resume`, `turn/start`, `turn/steer`,
`turn/interrupt`, `thread/compact/start`와 스트림을 직접 사용한다. ChatGPT
계정과 실제 모델 목록을 재사용하며 채팅 모델 설정은 대화에 따로 저장한다.
누적 토큰/시간 제한이나 임시 작업의 12분 제한을 채팅에 추가하지 않는다.
모델 문맥 한계와 자동 압축은 런타임에 맡긴다. 수동 압축도 같은 native API다.

`AgentRuntime` 포트는 전송/재개/추가 지시/취소/질문/압축을 구분한다.
Claude/OpenCode 어댑터 및 공급자 선택 화면은 아직 추가하지 않는다.

## 저장·대상·권한

- 전역 저장 위치는 `<dataRoot>/chat/<chat UUID>.json`과 대화별 이미지 폴더다.
  작품 폴더, 원본과 출력 폴더는 대화 저장소가 아니다. 원자적 저장과 경로 검증을
  기존 저장 계약으로 수행한다. 이미지 첨부 형식/크기 제한은 개별 업로드 보호이며
  대화 길이나 번역 작업 예산이 아니다.
- 메시지는 전송 시점의 `CurrentViewContext`를 복사해 저장한다. 실제 적용은
  MCP의 최신 revision/수동 편집 보호를 통과해야 한다. 화면 이동은 진행 대상이
  아니며 다음 메시지만 새 화면을 참조한다.
- 내부 loopback은 임의 포트와 메모리에서 발급한 bearer를 사용한다. bearer는
  환경 변수로만 Codex에 전달하고 명령행/대화 JSON에 저장하지 않는다. 같은
  프로필의 대화 UUID는 재시작 후에도 동일한 native 기록 소유자다.
- public OAuth/Tailscale listener와 내부 listener가 하나의 native session,
  guard, 작업 저장소와 retention authority를 공유한다. 외부 endpoint의 artifact
  주소는 경계에서만 변환하고 scope/소유권/revocation 검증을 유지한다.
- 외부 연결을 끄더라도 내부 채팅은 유지된다. 내부 `carrot` 서버에만
  `default_tools_approval_mode="approve"`를 적용한다. 허용된 앱 편집의 매번 확인을
  없애기 위한 설정이며 shell/임의 파일/외부 MCP/다른 도구 승인은 열지 않는다.

## 이어가기·완료 판정

UI 기록은 native 압축 후에도 남는다. 사용자 메시지의 pending/sent/uncertain
전달 상태와 native 작업/복구 참조를 별도로 보존한다. 연결 실패 후 자동으로
입력을 재전송하지 않는다. 사용자의 새 메시지로 연결하고 실제 native 기록을
재조회하게 한다. 확실히 종료된 turn의 steer 거절만 새 turn으로 전달한다.
불명확한 실패는 재시도하지 않으며 UUID 중복 입력도 다시 실행하지 않는다.
중지와 늦은 start ACK의 경쟁, 압축 중 실행 상태, 종료 시 저장을 분리했다.
패널 닫기는 실행을 유지하고 앱 창 종료/프로세스 종료는 일시 중지 상태를 남긴다.

기본 품질 지침은 complete-translation-v2, 가로쓰기 우선, 실제 견본과 렌더,
작품별 용어/팔레트, 전체 글씨/효과음 범위다. 이미지 경로는 앱 설정을 따르고,
생성 한글의 자동 획/마스크/부분 이동 보정은 기본 실행에서 제외한다.
채팅 응답 종료는 `idle`이며 정밀 품질 합격을 뜻하지 않는다. 품질 표시는
native translation guide의 completion schema만 해석하며 **확인 당시의 기록**과
미검수/오래된 페이지/폰트 대체를 구분한다. 미적 우수성 보장으로 표시하지 않는다.
되돌리기/다시 적용은 기록과 현재 revision을 확인하는 요청이며, 이미 불가능한
복구를 즉시 실행할 수 있다고 표시하지 않는다.

도구 결과는 접고, 실제 image content는 대화 저장소로 보존해 미리보기로 연다.
Markdown/GFM은 원격 이미지, raw HTML, 스크립트/입력을 렌더하지 않는다.
긴 기록은 화면에 최근 80개씩 추가 표시하며 저장 내용은 자르지 않는다.

## 회귀 기준과 구조 예산

공용화 전 Codex client/runtime와 MCP desktop/service 37개 테스트를 고정했다.
추가 회귀는 `chatService`, `codexChatRuntime`, `chatPanel`,
`chatOperationControl`, `mcpInternalAuthorization`, `mcpEndpointTools` 테스트로 다룬다. 실제 child RPC
fixture는 transport 경계를 검증하며 실제 모델/번역 품질 시험을 대체하지 않는다.

`architecture-budget-baseline.json`의 증가는 새 채팅 IPC/부트스트랩/renderer
composition 연결과 기존 pageRevision 재사용으로만 한정했다: main/index,
registerIpc, ipcContracts, trustedIpc, AppSessionView, pageRevision 각각 1개.
도구 알림과 native 결과를 중복 표시하지 않기 위한 인자 비교는 기존
blockFingerprint를 두 곳에서 직접 사용한다(151→153). 해시 구현은 그대로다.
보호된 계산을 이동하거나 일반 모듈 제한을 완화하지 않았다.

coverage inventory에는 새 모듈 28개의 최초 실측치를 추가했다. 기존 2,222개
항목과 provenance는 HEAD 대비 그대로이며 기준을 낮추지 않았다. 최초 실측
artifact는 `.tmp/global-chat-first-coverage-20261009.json`, SHA-256은
`f8678794c50ac810d95bdd609be254cb67079952372cb6bcbf7ab59796adc5f1`이다.
native Electron 조합 시험은 단위 coverage와 구별해 아래에 기록한다.

## 실제 검증 기록

평가 루트: `.tmp/chat-global-evaluation-20261009-02`.
원본 SHA manifest를 먼저 저장하고, 독립 library에 두 화를 native import했다.
출력 동기화를 연결하지 않았다. 사용자 번역/식자 대신 원문 이미지와 OCR만
옮겼으며 사용자 파일은 수정하지 않는다. fonts/tools/ocr-runtime의 리소스 정션은
`resource-links.json`에 기록돼 있다. 이 루트를 정션이 연결된 채 재귀 삭제하면 안 된다.

GPT-6.1 SOL high 실제 계정과 bundled Codex App Server로 다음을 확인했다.

- 「잊힌 영애는 자유롭게 살고 싶다」 3.3화 6페이지를 원문/OCR 상태에서
  `이 화 번역해줘`로 시작했다. 모델 capacity 오류에서 실패 상태와 저장한 작업을
  보존했고, 추가 품질 지시 없이 `계속`으로 동일 native thread를 재개했다.
  번역·견본·팔레트·식자·원문 제거·실제 렌더·composite 검수 후 6/6페이지가
  `accepted-at-current-revisions`, 폰트 대체 0개로 확인됐다.
- 초기 수동 압축뿐 아니라 긴 실제 작업 도중 **자동 압축**도 발생했다.
  압축 이후 남은 페이지를 완성했고, 저장한 대화 기록은 유지됐다.
  `translation-result-recovery.json`, `whole-chapter-completion.json`이 근거다.
- 같은 대화에서 「노후를 대비해 이세계에서 금화 8만 개를 모읍니다」 131화를
  조회하고 폰트를 비교했다. 진행 중 `turn/steer`로 두 번째 페이지의 선택 대사를
  수정하고 가로쓰기/30px를 적용했다. 앞 작품 파일은 바뀌지 않았다.
  `cross-work-result.json`, `real-rpc-methods.json`에 기록했다.
- 실제 `turn/interrupt`로 중지한 뒤 프로세스를 다시 시작했다. 대화는 자동 실행
  없이 일시 중지로 복원됐고, 사용자의 새 메시지로 같은 native thread에서 현재
  작품과 저장한 대사를 확인했다. `real-stop-result.json`,
  `restart-stop-result.json`에 상태가 남아 있다.
- 만료된 native 기록은 중지 실패로 잘못 경고하지 않으며, 다른 진행 작업의 취소는
  계속 수행한다. 최신 코드로 421개 항목의 실제 대화를 다시 실행·중지해 오류 없이
  일시 중지가 유지됨을 확인했다(`stop-control-result.json`).
- 실제 native MCP에서 private/OAuth endpoint의 동일 보관함 조회, 서로 다른
  실행 주체의 기록 접근 차단, 외부 endpoint 종료 후 내부 연결 지속을 확인했다.
  저장되지 않은 수동 편집은 `editor_busy`, 오래된 수정안은 `revision_conflict`로
  거부됐다. 실제 적용·중복 요청·Undo·Redo·재시작 후 검수 기록도 확인했다.
  `boundary-report.json`은 10개 실제 경계 검증 결과를 담는다.
- 최종 6페이지는 실제 `PageArtwork` 경로로 `final-pages/01.png`부터 `06.png`와
  배치 계측 JSON을 다시 내보냈다. 전체 페이지를 직접 확인했고 가로 대사/읽기 크기/
  잘림/원문 잔여를 살폈다. 좁은 풍선 밖 글씨에는 세로쓰기 예외가 남아 있다.
  정밀 증거 합격은 전문 역식자보다 우수하다는 미적 평가를 뜻하지 않는다.

평가의 원문 제거는 당시 앱 설정인 Codex 경로를 사용했다. 전역 설정을 바꾸지
않았으며 이 화에서 생성 한글의 자동 획 보정을 수행하지 않았다. 원본 14장의
SHA-256은 시작 manifest와 마지막에 다시 일치했다(`integrity-report.json`).
평가에서 발견한 초기 renderer 리소스 누락과 private MCP 쓰기 승인 설정은
수정한 뒤 재시험했다. capacity 오류나 중지를 품질 완료로 바꾸지 않았다.

UI는 실제 AppRightRail/ChapterTaskHub/ChatPanel로 캡처했다. 작은 창에서 채팅을
숨기던 기존 collapse selector, wrapper 때문에 누락된 rail surface 스타일,
이미지 모달이 transformed rail에 갇히던 문제를 실제 캡처에서 고쳤다.
임시 QA 엔트리는 제거하고 다음 이미지는 보존한다.

- `C:/tmp/carrot-chat-editor-20261009-02.png` — 두 버튼, 경고 제거
- `C:/tmp/carrot-chat-wide-20261009-02.png` — 1600×980, 긴 제목/표/이미지
- `C:/tmp/carrot-chat-narrow-20261009-02.png` — 980×700, 입력창/내부 스크롤
- `C:/tmp/carrot-chat-image-20261009-02.png` — 실제 이미지 모달
- `C:/tmp/carrot-chat-zoom-20261009-01.png` — 125% 확대

최종 `npm run check`는 370.51초에 전체 통과했다
(`.tmp/global-chat-check-final.log`, `.tmp/check-results/vitest.json`).

- 1,355개 테스트 파일: 10,493개 통과, 실패 0개, 기존 조건부 생략 9개.
- TypeScript/JS 검사, lint, format, architecture/maintainability, 중복/내보내기/
  생성 파일/죽은 코드 검사와 기존 coverage floor 전체 통과.
- production build와 renderer/preload bundle 경계, image protocol smoke 통과.
- 실제 패널과 exporter의 두 PageArtwork 비교에서 모두 불일치 픽셀 0개,
  최대 채널 차이 0. production PSD의 배경·텍스트 레이어·alpha 검증도 통과.

변경된 main/preload 코드까지 사용하려면 개발 앱을 다시 시작한다. 이번 작업은
앱 버전 릴리스나 사용자 보관함의 평가 결과 덮어쓰기를 수행하지 않는다.

## 참고

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [React Markdown](https://github.com/remarkjs/react-markdown)
- [GFM](https://github.com/remarkjs/remark-gfm)
