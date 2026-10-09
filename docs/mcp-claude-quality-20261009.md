# Claude Code MCP 식자 품질 보완 · 2026-10-09

사용자 요청은 Claude Code에서도 GPT-6.1 SOL High와 비교할 만한 번역·식자를
얻는 것이다. 실제 Claude Code 계정으로 시험하며 ImageGen과 자동 생성 문자
획 보정은 제외한다. 원문 제거가 필요한 새 번역은 FLUX, 효과음은 편집 가능한
폰트를 사용한다. 기존 사용자 보관함과 SOL·Claude 기준 출력은 보존한다.

## 확인한 원인과 변경

앞선 우주군 8화 발췌의 4페이지는 연결된 풍선의 두 칸을 한 직사각형으로
묶어 글자가 목 부분과 머리카락 위로 나왔다. 서버 v2 검수는 5/5였고 실제
직사각형 배치의 overflow도 없었다. 도구나 렌더러의 차이로 설명되지 않는,
물리적 식자 영역 판단과 최종 시각 검수의 실패였다. 앞선 비교의 상세한
계약 차이는 `mcp-translation-quality-v2-20261008.md`에 남아 있다.

- 공용 번역 가이드에 `physical-lettering-regions` 단계를 추가했다. 연결된
  풍선의 각 칸, 원문 열과 한국어 영역의 차이, 분리 시 문구 보존, 곡선 테두리와
  그림 주변의 실제 잉크 검사를 먼저 요구한다. 빈 줄이나 큰 행간으로 풍선의
  좁은 목을 가로지르지 않도록 한다.
- 렌더 결과에 `layoutBoundary`를 반환하고 도구 설명에도 직사각형의
  overflow 검사만으로 풍선 윤곽·그림 침범을 판정할 수 없음을 명시한다.
- 실제 렌더의 `displayText`에 빈 문단이 있으면
  `paragraph-gap-needs-balloon-region-check`를 반환한다. 현재 v2 검수는
  이 경고를 무시하고 완료할 수 없으며, 수정하거나 실제 한 영역 안의 의도적인
  문단임을 검수 사유로 설명해야 한다. 경고나 사유 자체는 미적 품질의 인증이 아니다.
- 금화 시험에서 놓친 좁고 긴 문단의 테두리 침범을 근거로
  `multiline-narrow-region-needs-contour-review`도 추가했다. 실제 배치가 가로쓰기,
  4줄 이상, 양수 너비, 너비보다 긴 높이인 경우 최종 풍선 crop을 확인할 후보로
  표시한다. 픽셀 단위 풍선 윤곽 자동 검출이나 침범 확정 판정은 아니다. 가이드와
  Claude 규칙은 마지막 수정 후 crop에서 모든 줄의 양끝, 특히 아래쪽 줄을 보도록
  요구한다. 이 마지막 보강은 사용자 요청으로 실제 모델 재시험 전에 중단했다.
- 기본 MCP 안내에서 잘못 생성된 한글을 자동 획 보정하도록 유도하던 문구를
  제거했다. 사용자 보정용 후보를 보존하고 미해결로 남기며, AI 이미지 보정은
  사용자가 별도로 요청한 경우에만 수행한다.
- 이전에 설치했지만 사용량 한도로 실제 검증하지 못했던
  `~/.claude/rules/carrot-typesetting.md`를 그대로 사용했다. 실제 CLI의
  `InstructionsLoaded`에서 로드된 파일과 SHA를 확인했다. 이번 시험 중에
  모델·계정 기본값이나 전역 도구 권한은 바꾸지 않았다. 마지막 보강을 포함한
  재현 가능한 규칙 원문은 [mcp-claude-typesetting-rules.md](mcp-claude-typesetting-rules.md)에
  저장하고 해당 사용자의 같은 rules 파일에 반영했다.

폰트 크기 계산, C23, 폰트 모델, 원문 복원 알고리즘은 변경하지 않았다.
앱 전역 대화가 개발 저장소에 노출되지 않도록 `/chat/`도 Git에서 제외했다.
대화 내용이나 보관함 파일은 삭제하지 않았다.

## 실제 시험과 비교 범위

실제 클라이언트는 Claude Code 2.1.294, 계정 설정은 `opus[1m]` / `xhigh`이며
네이티브 init이 반환한 모델은 `claude-opus-5-5[1m]`이다. SOL 기준은 이전에
고정한 `gpt-6.1-sol` / `high`의 동일 원본·FLUX 결과다. 모델과 추론 설정이
다르므로 비용·속도 동등성이나 일반적인 모델 성능 순위를 주장하지 않는다.

### 우주군 5장: 기존 출력의 식자 교정

루트: `.tmp/mcp-quality-v2-evaluation/claude-bubble-followup-03`.
기존 Claude 결과를 독립 복사한 후 다음 요청만 보냈다.

> 이 화의 말풍선 식자를 검수하고 어색하거나 잘못 배치된 부분을 고쳐줘. 이미지 작업은 제외해줘.

298,925ms에 완료했고 41개 블록을 43개로 나눴다. 가로 35개, 세로 8개다.
문제 페이지나 정답 배치를 추가 지시하지 않았고, 모든 원본·복원 배경의 bytes를
고정했다. 새 이미지 작업 0회, 도구 오류 0회였다.

- 4페이지의 `흐흥`/본문과 `흠……`/본문을 각각 두 칸의 별도 블록으로 나눴다.
  직접 확인한 1000px 높이 출력에서 목 부분과 머리카락 침범이 해소됐다.
- 2페이지의 줄 끝 여백과 긴 문장의 줄바꿈, 3페이지의 고립된 `너`와 작은
  `왜요?`, 5페이지의 좁은 발화를 국소적으로 수정했다. 큰 글자를 유지했다.
- 1페이지는 변경하지 않았다. 기존 FLUX 잔흔과 일부 좁은 세로 표현은 남는다.
  배경 고정 시험이므로 이미지 결함을 해결한 것으로 세지 않는다.
- 새 정밀 완료 증거를 제출하지 않았으며 네이티브 완료 상태는 0/5 pending이다.
  Claude도 이를 명시했다. 식자 교정 성공을 전체 정밀 번역 인증으로 바꾸지 않는다.

다섯 장 모두 실제 exporter로 다시 렌더해 수집 PNG와 픽셀 일치를 확인했다.
직접 출력 비교는 비블라인드 AI 검수이며 human gold가 아니다.

직전 `claude-bubble-followup-02`는 시험 문맥의 "5페이지"를 다섯 번째 장으로
해석해 한 장만 처리했으므로 전체 발췌 평가에서 제외했다. 시험 문맥을 "총 다섯
장 전부"로 고친 03은 원래 기준본에서 다시 시작했다. 02의 개선 결과를 이어
받거나 유리한 결과만 조합하지 않았다.

### 금화 5장: 원문부터 새로 번역

루트: `.tmp/mcp-quality-v2-evaluation/claude-flux-gold-01`.
선정 파일: `claude-generalization-selection-20261009.json`.
이전 SOL 비교의 고정 원본 SHA를 사용하며 사용자·SOL의 번역문, 배치와 팔레트를
빈 평가본에 가져오지 않았다. 프롬프트도 이전 SOL 시험과 같다.

> 이 화 번역해줘. 이미지젠은 쓰지 말고 원문 제거는 FLUX로 해줘. 효과음은 폰트로 식자해줘.

실제 실행은 1,093,250ms(18분 13초)에 끝났다. 28개 블록 모두 가로쓰기,
4개 폰트를 사용했고 실제 FLUX inpaint는 19회였다. 동일 SOL 시험은
28분 1초, 32개 블록, FLUX 12회였다. 블록 수 차이에는 제목·크레딧을 묶은
방식이 포함되므로 그 수만으로 누락 여부를 판단하지 않는다.

Claude는 1페이지 하단 배경의 가짜 흰 풍선과 2페이지 왼쪽 풍선의 원문 잔획을
미해결로 제출했다. 제출한 개별 평가는 3~5페이지 통과지만 composite 전체는
review-blocked이고, 현재 저장본의 네이티브 완료 증거는 0/5다. "3/5 정밀 완료"
또는 전체 번역 완료로 바꾸어 보고하지 않는다.

별도 직접 출력 검수에서는 5페이지 아래 오른쪽의 긴 대사가 풍선 오른쪽 경계를
침범한 것도 확인했다. 따라서 첫 보강의 새 번역 결과를 SOL 동등 수준으로
판정하지 않는다. 이 실패 사례를 보존하고 마지막 좁은 문단 경고와 확대 검수
규칙을 추가했다. 사용량 소진 후 사용자가 시험 중단·check·커밋을 요청했으므로
추가 Claude 호출 없이 여기까지 저장한다. 마지막 규칙의 실제 개선 여부는 미검증이다.

다섯 장 모두 실제 exporter 재렌더와 수집 출력의 픽셀 일치를 확인했다.
사용자 작품·화·원본의 SHA도 그대로였다. 7개 도구 오류는 UUID 생성용 Bash
1회 거부, 동시에 시작한 erasure 4회의 editor_busy, 없는 편집 필드 1회,
수동 흰색 칠에 대한 FLUX 전용 시험 guard의 거부 1회이며 해당 기록을 보존했다.
별도 erase-mask 요청에서 반환한 `invalid_edit`도 원본 도구 결과에 보존했다.

## 증거와 검증

각 시험 루트의 `trial-context.json`, `code-inventory.json`,
`instructions-loaded.jsonl`, `trial-tool-results.jsonl`, `trial-result.json`,
`final-guide.json`, `source-preservation.json`, `final-layout-inspection.json`,
`acceptance.json`, `visual-notes.json`에 서로 다른 사실을 구분해 기록한다.
검수용 HTML은 `.tmp/mcp-quality-v2-evaluation/claude-improved-review.html`이며
정확한 파일 허용 목록을 사용하는 loopback 읽기 전용 서버로 제공한다.

회귀 검증은 빈 문단과 좁고 긴 문단의 경고·v2 차단, 의도적인 문단의 검수 사유,
한 번의 정상 줄바꿈 허용, 렌더 메타데이터의 엄격 스키마 호환, 가이드 단계와
프로토콜을 대상으로 한다. 마지막 보강을 포함한 focused 70개 테스트와 변경
파일 lint를 통과했다.
첫 전체 check는 다른 Vitest 실행이 coverage 디렉터리를 사용 중이라 중단됐고,
그 프로세스가 끝난 뒤 다시 실행한 `npm run check`는 419.15초에 통과했다.
10,500개 테스트 통과, 9개 skip, 실패 0개이며 전체 typecheck/lint/coverage gate,
빌드, 실제 PageArtwork 픽셀 parity, 이미지 프로토콜 smoke를 포함한다.
테스트 실패를 성공으로 세거나 동시 실행 중인 프로세스를 중단하지 않았다.
로그와 결과는 `.tmp/claude-mcp-quality-check-final.log`,
`.tmp/claude-mcp-quality-vitest.json`, `.tmp/claude-mcp-quality-check-timings.json`에
별도 보존했다.

마지막 좁은 문단 경고와 사용자 요청을 반영한 최종 `npm run check`도 351.24초에
전체 27단계가 통과했다. 현재 작업 트리에서 테스트 10,502개 통과, 9개 skip,
실패 0개이며 typecheck/lint/coverage gate, 빌드, 실제 PageArtwork 픽셀 parity와
이미지 프로토콜 smoke를 포함한다. 최종 로그는
`.tmp/claude-mcp-quality-check-commit.log`, 결과 사본은
`.tmp/claude-mcp-quality-commit-vitest.json`과
`.tmp/claude-mcp-quality-commit-timings.json`이다. 다른 진행 중인 작업의 파일은
이번 MCP 개선 커밋에 포함하지 않는다. 렌더러 production UI는 이번 변경에서
수정하지 않았다.
