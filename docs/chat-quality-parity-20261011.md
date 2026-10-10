# 채팅 품질·대화 전환 수정 — 2026-10-11

## 확인된 원인

- 대화 안의 transcript와 composer에 동일한 key를 줘 대화 전환 때 이전 DOM이 남았다.
  수정 전 production Electron에서 10회 왕복 후 log 영역 21개를 재현했다.
  key를 대화 경계로 옮겨 transcript·composer를 함께 교체한다. 초안 저장은 유지한다.
- 설치판 ASAR 내부 폰트의 가상 inode와 실제 파일 descriptor identity가 달라
  `carrot_get_font_samples`가 revision_conflict를 반복했다. native archive의 변경과
  실제 멤버 bytes를 검증한다. 일반 파일의 기존 검증은 유지한다.
- Codex/Claude의 도구 실패 상세가 채팅 저장에서 도구 이름으로 대체됐다.
  실패 텍스트와 transport 오류를 보존해 펼친 도구 목록에서 확인할 수 있다.
- 설치판 문제 사례는 FLUX가 아니라 `engine=codex`를 명시해 페이지 내 영역마다
  순차 이미지 생성을 했다. FLUX worker는 한 작업 안에서 재사용하고 종료 때 해제한다.
- 4페이지의 문제 풍선은 원문 세 열보다 좁은 sourceRect가 저장됐다. 기록된
  ImageGen permission은 crop 좌표 x68..160, y68..261이며 원문은 이 경계를 넘었다.
  보관된 생성 이미지는 말풍선 전체의 원문을 지웠지만 최종 합성은 이 permission
  안쪽만 적용했다. 배치 영역과 제거 영역을 구분하고 원본 crop과 omitText 적용 결과를
  실제로 봐야 하는 사례다. 이것은 잔여 원문의 직접 경로이며, 앱에서 잘못된 좌표를
  선택하고 외부 대화에서는 잘 선택했던 행동 차이의 단일 원인까지 입증하지는 않는다.
- 6페이지의 효과음·강조 글자는 제거 전 상태이고, 큰 세로 원문에 작은 가로 글씨가
  배치됐다. 이러한 임시 저장이나 호출 성공을 완성 품질로 간주하지 않는다.

## 같은 작업 기준

외부 MCP initialize/discover와 앱 채팅이 동일한 `MCP_TRANSLATION_INSTRUCTIONS`를
직접 소비한다. 앱에 따로 있던 eraser 고정 규칙은 제거했다. 같은 native translation
guide, image content, font specimens, 생성·검수 도구를 사용한다. 모델·추론 선택은
그대로 native turn에 전달하며 조용히 하향하지 않는다. 채팅 껍데기의 제한된 도구를
이유로 효과음 생성이나 정밀 검수를 생략하지 않는다.

원본의 방향·실제 크기·윤곽·연출, 원문 제거 범위, 한국어 배치는 별개다. 대표 페이지를
실제 렌더까지 마친 뒤 스타일을 전파하고, 제거 배경을 텍스트 없이 확인한 뒤 최종
합성을 검수한다. 모든 지표가 통과해도 심미적 동등성을 보장하는 것은 아니다.

## 자동 이미지 정책

사용자의 명시적 도구/모델 선택이 우선한다. 미지정 시 단순 배경은 native fill/AOT,
일반 제거는 FLUX, 복잡한 배경·그림형 글자는 ImageGen을 검토한다.
`carrot_get_image_budget`은 앱 계정의 실제 plan과 `account/rateLimits/read`를 조회한다.
계정 이메일·자격 증명은 내보내지 않으며 inference/login/구매/reset은 실행하지 않는다.
외부 호스트의 ImageGen에는 호스트 계정 사용량을 써야 한다.
양쪽 모두 앱 이미지 도구를 기본으로 사용한다. 호스트 도구는 사용자의 명시적 선택
또는 앱 도구를 사용할 수 없다는 사실을 알린 대안이며 외부 연결만의 기본값이 아니다.

이는 제품의 비용 정책이며 공급자의 ImageGen 잔여 횟수 계산이 아니다. Codex의
유효한 primary/secondary 창 중 더 제한된 사용량을 사용한다. 잔여 20% 이하 또는
제한 도달은 자동 생성을 피한다. Pro는 30% 이상, 그 외는 50% 이상 남으면 복잡한
영역에 생성을 우선한다. 그 이외/조회 불가는 local-first이며 원문 복원 실패를 직접
확인했을 때만 제한적으로 생성한다. Pro 여유 상태는 영역당 2회, 그 외는 1회 정책이며
기존 누적 최대 4회와 정책 거절 보호를 완화하지 않는다. 수치는 공급자 entitlement가 아니다.

`localModel`은 기존 erasure job의 executionSettings만 바꾼다. 전역 설정, 권한,
revision, mask, history와 native engine 계약은 그대로 사용한다.

## 검증

릴리스 직전 dev 오류 추가 수정:

- 05:52 KST의 `localModel` Zod 오류는 tool/executor에 추가한 선택값을 durable job target에
  누락한 문제였다. 같은 값을 journal과 kind별 검증에 추가했고 실제 도구 admission,
  저장·재시작·동일 요청 replay 및 실패 작업 retry target까지 검증했다.
- 05:54 KST부터 256개 복구 기록 한도로 저장이 거부되었다. 기존 기록을 삭제하지 않고
  공통 catalog 한도를 4,096개로 확대했다. 1 GiB, 7일, owner, 암호화, atomic publication은
  그대로다. 공간 부족은 재시도 가능한 editor_busy 대신 retention_full로 전달하며
  원문 제거/이미지 편집 전 read-lock 아래 사전 확인, 저장 시 최종 확인을 수행한다.
  동시 작업이 사전 확인 이후 공간을 채우는 경우에는 최종 저장이 여전히 거부될 수 있다.
- 256개 기존 index의 새 편집·재시작·undo, 4,096개 한도에서 무삭제 거부,
  1 GiB 한도에서 native erasure job 시작 전 거부를 isolated encrypted library로 검증했다.
  실제 사용자 보관함과 복구 기록은 수정하거나 정리하지 않았다.
- configured engine과 preview expectedEngine 불일치는 변경된 설정을 확인하는 정상 guard다.
  작업별 엔진 선택은 carrot_run_page_erasure.localModel 계약이며 reviewed image-edit의
  expectedEngine을 설정 override로 바꾸지 않았다.
  오류에는 현재/요청 엔진과 작업별 선택 도구를 명시해 같은 잘못된 호출을 반복하지 않게 했다.
- 비동기 page batch가 errorCode만 남기던 경로에 optional errorMessage를 추가했다.
  공개 McpEditError만 최대 1,024자로 전달하고 일반 Error와 취소 사유는 노출하지 않는다.
  새 작업 시작 때 이전 설명을 제거한다. 공통 schema를 사용하는 앱/MCP 양쪽에 적용된다.

- duplicate-key 회귀 테스트, 실제 Electron 10회 대화 왕복 후 wide/narrow/200% zoom QA:
  log·composer 각 1개, 네 방향 잘림·외부 스크롤·겹침 없음. 캡처를 직접 확인했다.
- installed ASAR 실제 폰트 3종의 견본 렌더와 archive 변경 거부 smoke.
- budget 테스트: Plus/Pro/unknown/limit, 다중 bucket, 만료·오류·비정상 수치,
  개인정보 배제, authorization 재확인, 취소와 client cleanup.
- localModel override가 선택한 엔진을 사용하고 저장 설정을 바꾸지 않는 native job 테스트.
- chat runtime의 실제 child RPC를 통해 외부 MCP 지침 포함과 model/effort 전달을 검사.
- 동일 native host의 앱 채팅 HTTP 경로와 외부 MCP endpoint 경로에서 실제 원본 crop,
  제거 배경, 최종 식자의 PNG SHA-256·좌표 mapping·layout이 같음을 확인했다.
- 사용자 문제 원본 crop 복사본(229×330)을 격리 보관함에 가져와 실제 앱 채팅
  GPT-6.1 Sol/high에 일반 번역 요청을 실행했다. 원본 확인, 폰트 견본, 별도 제거
  마스크, omitText 배경, 최종 합성과 composite review까지 수행했고 잔여 원문 없이
  말풍선 윤곽을 보존한 결과를 직접 확인했다. 전체 화 번역이나 외부 데스크톱과의
  심미적 A/B 테스트는 아니다. 초기 QA harness의 dev 폰트 경로 누락은 연결 후 재검증했다.

계정 메타데이터 계약 출처: https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt

구조 예산은 신규 계정 조회 도구의 기존 argument/envelope 소비자 각 1개와 typed output
등록 import 1개만 늘렸다. 전역 기준이나 기존 coverage 기준을 낮추지 않는다.
새 파일 3개의 측정된 coverage만 도입 파일 목록에 추가하고 기존 floor는 유지했다.
