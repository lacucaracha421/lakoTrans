# Tailscale로 당근과 AI 앱 연결하기

설치한 당근 앱의 **설정 → AI 연결 / MCP**에서 시작합니다. 아래 최초 준비부터 차례로 따라가세요. 소스 코드를 받거나 Git 브랜치를 바꿀 필요는 없습니다. 외부 연결은 **Tailscale Funnel**을 사용합니다.

이 문서는 사용자 연결 절차와 개발 검증 기준을 함께 담고 있습니다. 아래 절차를 완료한 뒤 실제 AI 앱에서 로그인·도구 호출·파일 수신을 확인하세요. 과거 MCP 개발 브랜치와 PR에 대한 기록은 [통합 기록](mcp-integration-status.md)에 보존되어 있습니다.

| 클라이언트   | 앱이 제공하는 연결 경로                              | 확인 범위                                                                                |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ChatGPT 웹   | 앱 관리 Tailscale HTTPS + OAuth/DCR + 앱의 코드 확인 | 소스 구현과 실제 계정 로그인·도구 호출·파일 수신을 별도로 확인                           |
| Codex 앱·CLI | 앱 관리 HTTPS + OAuth/DCR + 앱의 코드 확인           | CLI 0.156.1 실제 로그인·도구 호출을 격리 loopback에서 검증. 공개 Funnel 경유는 별도 확인 |
| OpenCode     | 앱 관리 HTTPS + OAuth/DCR + 앱의 코드 확인           | 1.18.35 공개 주소 인증·실제 Go 모델 호출 및 격리 편집·복구 검증                          |

앱 관리 OAuth는 HTTPS 복귀 주소와 HTTP loopback(`127.0.0.1`, `localhost`, `[::1]`) 복귀 주소를 등록합니다. HTTP loopback은 명시적인 비특권 포트가 필요하며 재인증 시 포트만 달라질 수 있습니다. 호스트·경로·query는 등록값과 일치해야 하고 HTTPS 주소는 전체가 일치해야 합니다. PKCE와 앱의 코드 승인을 유지하며 승인 화면에 실제 복귀 주소를 표시합니다. 제품별 경로 목록은 사용하지 않습니다.

### 2026-10-09 OpenCode 검증

- OpenCode 1.18.35의 기본 복귀 주소 `/mcp/oauth/callback`으로 실제 브라우저 승인과 OAuth 연결을 완료했다. 사용자 설정은 백업 후 `mcp.carrot`만 추가했고 기존 `opencode-go/deepseek-v4.1-flash`와 에이전트 설정을 보존했다.
- 공개 서버에서 실제 Go 모델이 읽기 도구 11개를 호출했다. 원본·최종 렌더·한국어 폰트 견본 등 PNG 6개가 OpenCode의 이미지 첨부로 전달됐다.
- 별도 data root의 원본 한 페이지에서 직접 번역, 6개 블록 생성, 폰트 견본·작품 팔레트, Flux 원문 제거, 서식 저장, 렌더, Undo/Redo를 실행했다. 원본·사용자 작품 파일의 SHA는 유지됐다.
- **이 시험은 번역 품질 통과가 아니다.** 모델이 최종 v2 검수를 제출하지 않았고, 직접 확인한 렌더에도 말풍선 넘침이 남았다. 서버의 최종 상태는 `incomplete / pending`, 승인 페이지는 0/1이다.
- 별도 네이티브 재시작 시험에서 동일 인증으로 저장 revision과 작업 기록을 복원했다. 철회 후 HTTP 401과 실제 OpenCode의 접근 실패를 확인했다. 사용자 연결은 철회하지 않았다.
- 재연결 반복 중 OpenCode가 선택적 GET의 405를 받으면 `tools/list`를 보내기 전에 실패하는 현상을 재현했다. 인증·Origin 검사를 그대로 적용하는 GET 이벤트 스트림을 추가했고, 수정 후 같은 OpenCode에서 재연결 4회 모두 257개 도구 조회에 성공했다. POST 편집·완료 계약은 동일하다. 스트림은 작업 결과를 전송하지 않고, 연결 종료·서버 중지 때 정리하며 heartbeat에서 권한을 다시 확인한다.
- 임의 loopback 경로, IPv6, HTTPS 웹 복귀 주소의 등록·정확한 주소 바인딩·갱신·철회를 HTTP 통합 시험으로 확인했다. UI는 실제 설정 컴포넌트의 넓은/좁은 화면과 승인 화면을 캡처해 확인했다.
- 최종 `npm run check`의 27개 검사와 빌드가 통과했다. 테스트는 10,506개 통과, 9개 건너뜀, 실패 0개다. 로그는 `.tmp/opencode-mcp-check-05.log`에 보존했다.

로컬 증거는 `.tmp/opencode-connection-acceptance.json`, `.tmp/mcp-quality-v2-evaluation/opencode-flux-one-01/`, `.tmp/mcp-quality-v2-evaluation/opencode-auth-restart-02/`에 있다. 실패한 첫 재연결 기록도 보존했다. 사용자 연결 안내는 [MCP 사용 가이드](mcp-user-guide.md#opencode)를 따른다.

근거: [OpenCode MCP 설정](https://opencode.ai/docs/mcp-servers/), [OpenCode 1.18.35 OAuth 구현](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/mcp/oauth-provider.ts), [MCP Streamable HTTP의 GET 규칙](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server).

## 최초 Tailscale 준비

설치형 앱에서는 **설정 → AI 연결 / MCP**를 엽니다. 연결이 꺼져 있거나 실패하면 **연결 방법 및 도움말**이 상태 바로 아래에서 펼쳐집니다. 이미 마친 단계는 건너뛰세요. MCP가 꺼졌다는 표시만으로 Tailscale도 로그아웃됐다는 뜻은 아닙니다.

1. **당근이 실행되는 PC에 설치:** [공식 다운로드](https://tailscale.com/download)에서 Windows 또는 macOS를 선택해 설치합니다. Windows 설치 후에는 시계 옆 숨겨진 아이콘 표시(위쪽 화살표)를 열고 Tailscale 아이콘을 우클릭합니다. macOS는 상단 메뉴 막대에서 엽니다.
2. **로그인·기기 연결:** Tailscale 메뉴에서 **Log in**을 눌러 열린 브라우저에서 본인 계정으로 로그인합니다. 기기 연결 화면이 나오면 **Connect**를 누릅니다. 메뉴로 돌아와 연결된 상태인지 확인하고 끊겨 있으면 **Connect**를 누릅니다. 웹사이트 로그인만 하고 PC 앱이 연결되지 않은 상태로 두지 마세요.
3. **당근에서 MCP 켜기:** 당근 설정으로 돌아와 **MCP 켜기**를 누릅니다. **Tailscale에서 연결 허용** 버튼이 나타나면 브라우저에서 HTTPS·Funnel 사용을 허용하고, 당근으로 돌아와 **MCP 켜기**를 다시 누릅니다. 회사·학교 계정에서 허용 권한이 없으면 해당 Tailscale 네트워크 관리자에게 요청합니다. Funnel 명령이나 전체 설정 초기화를 직접 실행할 필요는 없습니다.
4. **연결 확인:** 상태가 **연결 가능**으로 바뀌면 **연결 진단**을 누릅니다. 꺼져 있을 때 남아 있는 주소는 이전 주소이므로 연결 완료로 판단하지 않습니다. 처음 허용한 주소의 DNS 반영에는 시간이 걸릴 수 있으므로 즉시 진단에 실패하면 잠시 후 재시도합니다.
5. **AI 앱 등록:** **주소 복사**로 `/mcp`를 포함한 전체 주소를 복사하고 아래 Codex·ChatGPT 절차를 따릅니다. 브라우저와 당근의 같은 숫자 코드를 확인해 승인합니다. 사용하는 동안 당근과 Tailscale을 켜 둡니다.

로그인 오류는 2단계부터, Funnel 허용 안내는 3단계부터 다시 확인하세요. MagicDNS·HTTPS 설정 안내는 네트워크 관리자에게 확인하고, HTTPS 443이 사용 중이라면 기존 공유를 사용하는 앱을 확인해 그 공유가 끝난 뒤 다시 시도합니다. 다른 서비스의 Serve/Funnel 설정을 전체 초기화하지 않습니다.

당근은 Tailscale 계정 비밀번호를 받지 않습니다. 기본 설치 경로가 아니라면 `CARROT_TAILSCALE_PATH`에 실행 파일의 절대 경로를 지정할 수 있습니다. Windows 설치·로그인 순서는 [Tailscale 공식 Windows 안내](https://tailscale.com/docs/install/windows)를 기준으로 확인했습니다.

[Tailscale 공식 요구사항](https://tailscale.com/docs/features/tailscale-funnel)에 따라 MagicDNS, HTTPS 인증서와 Funnel 사용 권한이 필요합니다. 앱이 안내하는 Tailscale 설정 화면에서 준비하세요. 여기서 진단하는 주소는 앱이 읽은 장치 주소이며, 외부 문서의 임의 인증 서버 주소로 바꾸지 않습니다.

동일한 Tailscale 장치·tailnet 이름을 유지하는 동안 같은 HTTPS 주소를 사용합니다. 이름 변경이나 장치 재등록은 주소를 바꿀 수 있습니다. 기존 Cloudflare 플러그인을 사용했다면 **Tailscale 주소로 최초 한 번 새로 연결**해야 하며, 이전 주소의 권한을 새 서버 식별자로 자동 이전하지 않습니다.

## 앱에서 연결

1. **설정 → AI 연결 / MCP**를 엽니다. 처음에는 공개 가능한 시험 원고를 사용하세요.
2. 처음 사용하는 데이터 폴더는 **이미지와 이미지 포함 출력 전송·텍스트/서식/문맥 편집·블록/보관함 관리 및 앱 모델 처리·앱 시작 시 자동 실행**이 모두 체크되어 있습니다. 필요 없는 항목은 끌 수 있습니다. 이미 저장한 설정은 그대로 유지하므로 업데이트로 사용자의 꺼둔 선택을 덮어쓰지 않습니다. 옵션이 체크되어 있어도 새 AI 연결에는 앱의 숫자 확인 승인이 필요합니다.
3. 자동 실행되지 않았다면 **MCP 켜기**를 누릅니다. 설치·로그인 안내가 나오면 Tailscale에서 완료합니다. **Tailscale에서 Funnel 허용** 버튼이 나타나면 본인 계정에서 허용한 후 다시 켭니다.
4. **연결 진단**으로 공개 OAuth 보호 리소스·인증 서버 메타데이터와 무인증 MCP POST 거부를 확인합니다. 진단은 모델·Codex 할당량을 사용하지 않고 인증정보나 보관함을 전송하지 않습니다. 성공은 아래 세 가지 검사에 한정됩니다.
5. MCP가 켜져 있으면 **새 연결 요청을 항상 받습니다.** 별도의 허용 버튼이나 5분 등록 창은 없습니다. **주소 복사**로 `/mcp`가 포함된 주소를 복사합니다.
6. ChatGPT의 사용자 지정 MCP/플러그인 생성 화면에 주소를 넣고 **OAuth / Dynamic Client Registration**을 사용합니다. **Client ID·Client Secret은 비워 둡니다.**
7. 브라우저의 확인 코드와 앱에 표시되는 요청의 코드·권한을 대조하고 **앱에서 같은 코드 확인 · 승인**을 누릅니다. 클라이언트 이름은 요청자가 입력한 표시값이지 신원 보증은 아닙니다.
8. 브라우저가 ChatGPT로 돌아오면 새 대화에서 이 연결을 선택합니다. 자동 확인이 멈춘 경우 브라우저의 **승인 결과 확인**을 누릅니다. 암호 파일이나 API 키를 채팅에 붙여넣지 않습니다.

새 요청을 받는 기간과 개별 승인 요청의 유효기간은 다릅니다. 각 브라우저의 숫자 확인 요청은 5분 후 만료되지만 새 연결 접수는 계속 열려 있습니다. 만료된 승인 화면에서는 연결을 다시 시작하면 새 코드가 표시됩니다. 승인 전 도구 접근, 잘못된 브라우저 쿠키, 숫자만으로 토큰 발급, 중복 승인과 종료된 서버의 요청은 거부합니다.

현재 이 승인 범위는 실행 중인 보관함 전체입니다. 작품별 권한 제한은 아직 구현하지 않았습니다. 이미지 전송은 별도 scope와 기존 가리기 보호를 모두 지켜야 합니다. 가리기 검토가 필요한 이미지는 원격 도구로 우회할 수 없습니다.

읽기에는 텍스트·문맥 조회와 해당 파일 출력이 포함됩니다. 이미지·PSD·ZIP·작업 파일처럼 이미지를 포함하는 출력은 이미지 권한이 필요합니다. 편집·처리 권한을 함께 승인하면 도구별 검토와 대상 확인에 따라 텍스트·서식·문맥 및 블록·보관함 구조를 변경할 수 있습니다. 처리 권한으로 요청한 앱 모델 작업은 설정된 제공자를 사용하며, 외부 제공자에게 필요한 텍스트나 이미지를 보내고 요금이 발생할 수 있습니다. 연결 승인 자체는 모델 작업을 시작하지 않습니다.

## 연결 진단 결과 읽기

| 검사                 | 실제 확인하는 내용                                                                           | 실패하면 확인할 항목                            |
| -------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OAuth 보호 리소스    | 고정 `/mcp` resource, 같은 origin의 인증 서버, 읽기 scope와 Bearer header 방식               | 앱의 고정 주소, 공개 metadata 응답, 프록시 경로 |
| OAuth 인증 서버      | 같은 issuer와 인증·토큰·등록·철회 경로, 코드/갱신과 PKCE S256, 지원되는 클라이언트 인증 방식 | 앱과 OAuth metadata가 같은 실행에서 제공되는지  |
| 무인증 MCP POST 차단 | 인증정보 없는 POST가 401 Bearer와 정확한 resource metadata 주소를 반환하는지                 | 공개 endpoint와 인증 차단 경로                  |

각 네트워크 응답은 8초, metadata는 읽는 중 실제 16KiB까지 제한합니다. 검사는 앱이 제공한 origin의 정해진 경로만 사용하고 HTTP redirect나 metadata에 적힌 다른 서버 URL을 따라가지 않습니다. 결과는 진단 실행 시점의 상태이므로 주소나 서버 상태가 바뀌면 다시 실행합니다. 성공해도 ChatGPT에서 접근 가능한지, OAuth 코드 교환·권한 승인·프로토콜 협상·도구 호출·파일 저장이 성공하는지는 별도 확인해야 합니다. 종료된 서버의 보존 주소로 진단하면 실패할 수 있습니다.

## Codex 연결

1. 당근 **설정 → AI 연결 / MCP → 연결 방법 및 도움말 → Codex**에서 **명령 복사**를 누릅니다.
2. Codex CLI가 설치된 PC의 터미널에서 두 명령을 실행합니다. 현재 당근 주소로 서버를 등록한 뒤 OAuth 로그인을 시작합니다.
3. 브라우저와 당근 앱의 숫자 코드·권한을 확인해 승인하고 Codex에서 새 작업을 엽니다. 같은 PC의 Codex 앱·CLI는 설정을 공유합니다.

명령은 `codex mcp add carrot --url "<현재 앱 주소>"`, `codex mcp login carrot`입니다. 기존 같은 이름의 서버가 있으면 해당 항목을 갱신하고 다른 서버 설정은 보존합니다. 실행 중에는 당근 앱을 켜 둡니다.

예: “이전 화 편집한 걸 보고 다음 화도 비슷하게 처리해줘.” 로컬 모델을 원하지 않으면 “로컬 모델은 쓰지 마”를 덧붙입니다. Codex는 원본·이전 편집본·폰트 견본을 보고 편집한 다음 렌더링을 재검사할 수 있습니다. Codex 이미지 처리에는 이미지 권한과 외부 처리 동의가 필요하며 결과 품질은 실제 페이지로 확인해야 합니다.

[공식 Codex MCP 안내](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) · [실제 검증 기록](mcp-live-acceptance-20260924.md)

## ChatGPT 등록과 목록 새로 고침

2026-09-23에 확인한 [OpenAI 공식 연결 안내](https://developers.openai.com/plugins/deploy/connect-chatgpt)는 설정의 **Security and login → Developer mode**와 **Plugins**의 새 연결을 안내합니다. 계정·워크스페이스 정책에 따라 해당 메뉴의 사용 가능 여부가 다를 수 있습니다. 공개 연결에는 앱에서 복사한 `/mcp` URL을 넣고, 이 서버의 OAuth/DCR을 선택합니다. 서버 설정 파일에 임의 Client ID·Secret을 만들거나 토큰을 채팅에 전달하지 않습니다.

[OpenAI 인증 문서](https://developers.openai.com/plugins/build/auth)의 연결별 `/connector/oauth/{callback_id}`와 기존 `/connector_platform_oauth_redirect` 형식을 이 서버가 정확히 검사합니다. OAuth metadata가 제공하는 DCR 경로를 사용하며 CIMD 지원을 선언하지 않습니다.

도구 이름·스키마·권한이 변경된 버전을 실행한 뒤에는 ChatGPT 연결의 **Refresh**로 광고된 목록을 갱신하고 새 대화에서 필요한 도구를 다시 확인합니다. 이전 대화의 목록이나 예전 성공 기록만으로 새 기능의 지원을 판정하지 않습니다. 이 절차는 기존 승인을 임의로 확장하지 않습니다.

## 조회와 기존 번역문 수정

먼저 작품·화 목록과 이미지 미리보기의 실제 도구 호출을 확인합니다. 편집 시험은 **기존 앱에서 OCR/번역 블록이 이미 만들어진 페이지**를 사용합니다. 미저장 편집을 저장하고 충돌할 수 있는 앱 작업을 종료하세요.

> 당근 MCP로 시험 작품의 블록이 있는 페이지를 찾아 원문·번역문·블록 ID를 읽어줘. 아직 수정하지 마.

> 방금 읽은 페이지에서 지정한 대사의 번역문만 ‘안녕하세요.’로 고쳐서 당근 앱에 저장해줘. 위치·글꼴·원문은 바꾸지 말고 최신 revision을 사용해.

`carrot_get_page_blocks`와 `carrot_update_translations` 호출 및 앱 화면 반영을 확인합니다. 이 도구는 현재 AI가 작성한 번역문을 기존 블록에 저장하며 Codex나 별도 유료 모델을 실행하지 않습니다. OAuth 승인에 `carrot.edit`가 없으면 새 승인이 필요합니다. 앱 옵션만 바꿔 기존 승인 권한을 몰래 확장하지 않습니다.

오래된 revision으로 다른 내용을 저장하려 하면 충돌로 반환하는 것이 정상입니다. 같은 문장이 이미 적용된 재시도는 `already_applied`로 끝납니다. 저장 결과의 이전 번역문과 최신 revision으로 명시적으로 되돌릴 수 있지만, 이후 사용자 편집을 덮어쓰면 안 됩니다.

**신규 블록 생성·OCR·원문 제거·실제 렌더링·PNG의 기본 흐름은 [한 페이지 완성 테스트](mcp-page-testing.md)에 있습니다.** 이후 소스에는 앱 모델 번역, 효과음 작업, 다양한 이미지 형식·ZIP·작업 파일 및 텍스트·문맥 교환 경로가 추가됐습니다. 세부 구현 상태와 남은 단계는 로드맵을 확인하고 실제 `tools/list`에 보이는 권한 있는 도구만 사용하세요. 원본 미리보기, 작업 접수, 완료 결과와 명시적으로 조회한 출력 파일은 각각 구분합니다.

## 유지·끄기·철회 확인

**MCP 끄기 → 다시 켜기 → 앱 완전 종료·재시작**을 차례로 시험합니다. 고정 주소와 유효한 승인 정보는 유지되어야 하며 플러그인을 매번 삭제하고 등록하지 않아야 합니다. 끈 상태에서는 도구 호출이 실패해야 합니다.

승인된 클라이언트와 권한은 운영체제 암호화된 `mcp-private/authorization.enc`에 보존합니다. 접근 토큰은 최대 1시간, 회전하는 갱신 토큰은 마지막 발급 후 90일 만료입니다. 장기 미사용·철회·주소 변경에는 재승인이 필요할 수 있습니다. 암호화 불가나 파일 손상 시 평문 저장·무인증 접속으로 전환하지 않습니다.

**연결 해제** 후 이전 인증이 거부되고 재시작 후에도 철회 상태가 유지되는지 확인하세요. MCP 끄기는 승인 삭제가 아니며, 철회는 해당 연결의 접근·갱신 권한 폐기입니다.

Tailscale의 HTTPS 443이 다른 공유 경로에 사용 중이면 당근이 중단합니다. 앱은 `tailscale funnel reset`이나 시스템 Tailscale 전체 종료를 실행하지 않습니다. 종료가 실패하면 차단된 로컬 포트를 유지해 다른 프로세스가 공개 경로를 물려받지 못하게 하므로, 오류를 확인한 뒤 **MCP 끄기**로 정리를 재시도합니다.

## 개발자 검사와 검증 범위

```powershell
node node_modules/vitest/vitest.mjs run tests/mcp tests/libraryBatchPageSave.test.ts tests/pageRevision.test.ts tests/chapterSync.test.ts tests/liveChapterRefreshCoordinator.test.ts
npm.cmd run build
node node_modules/electron/cli.js scripts/mcp-electron-smoke.cjs
node scripts/mcp-ui-qa.cjs
```

기본 native smoke는 실제 보관함 대신 합성 원고·격리된 데이터 루트를 사용하며, Windows OS 암호화 저장·복원·갱신·오프라인 철회도 검사합니다. UI QA는 실제 production 컴포넌트와 스타일을 불러와 넓은 창·좁은 창·승인·오류 상태를 캡처합니다. 실제 Tailscale 계정이나 로그인된 ChatGPT 세션을 사용한 검사는 별도입니다.

실행 중인 앱을 건드리지 않고 로컬 native smoke를 검사하려면 비어 있는 `CARROT_MCP_SMOKE_PORT`(예: `38476`)를 지정할 수 있습니다. 기본값은 `38475`입니다.

기존 앱과 MCP를 종료한 상태에서 `CARROT_MCP_SMOKE_TAILSCALE=1`을 명시하면 설치·로그인된 Tailscale로 합성 보관함을 일시 공개하는 선택 검사가 가능합니다. 이는 별도 계정 설정이 필요하며 자동 통과한 것으로 간주하지 않습니다. 현재 소스·최종 검사 단계는 로드맵에서, 이전 실행의 정확한 커밋·환경은 [통합 상태](mcp-integration-status.md) 및 PR #96에서 확인하세요.

최종 클라이언트 검사에는 실제 앱·Tailscale·클라이언트 버전, 실행 커밋, 승인 scope, 도구 목록 갱신, 읽기/거부 결과, 명시적 파일의 이름·MIME·byte 수·SHA-256과 실제 저장 여부를 기록합니다. 서버의 응답 완료나 전송 관찰만으로 클라이언트가 파일을 받았다고 결론내리지 않습니다. 토큰·쿠키·서명된 다운로드 URL은 검사 기록에 남기지 않습니다.

공식 안내: [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel), [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel), [ChatGPT 연결](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OAuth/DCR](https://developers.openai.com/plugins/build/auth).
