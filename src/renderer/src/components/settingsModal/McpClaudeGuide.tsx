import React from "react";
import settingsMenuImage from "../../assets/images/mcp-claude/claude-settings-menu.png";
import connectorsImage from "../../assets/images/mcp-claude/claude-connectors.png";
import addConnectorImage from "../../assets/images/mcp-claude/claude-add-custom-connector.png";
import addressImage from "../../assets/images/mcp-claude/claude-connector-address-redacted.png";
import authImage from "../../assets/images/mcp-claude/claude-connector-auth-redacted.png";
import connectImage from "../../assets/images/mcp-claude/claude-connect-redacted.png";
import { Button } from "../ui/Button";
import { GuideImage } from "./McpGuideImage";
import styles from "./McpSettingsPanel.module.css";

type RunAction = (action: () => Promise<unknown>) => Promise<void>;

/** A copyable terminal snippet built from the live server address. */
export function McpCommandCopy({
  commands,
  busy,
  run,
  label = "명령 복사",
}: {
  commands: string | null;
  busy: boolean;
  run: RunAction;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!commands)
    return (
      <p className={styles.note}>
        MCP를 켜면 이 앱 주소가 들어간 연결 명령이 표시됩니다.
      </p>
    );
  return (
    <div className={styles.commandRow}>
      <pre className={styles.command}>
        <code>{commands}</code>
      </pre>
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await navigator.clipboard.writeText(commands);
            setCopied(true);
          })
        }
      >
        {copied ? "복사됨" : label}
      </Button>
    </div>
  );
}

/** Claude's web and desktop apps add the server as a custom connector. */
export function ClaudeGuide() {
  return (
    <ol className={`${styles.setupSteps} ${styles.visualSteps}`}>
      <li data-guide-step="settings">
        <strong>설정 열기</strong>
        <p>
          Claude 앱 왼쪽 아래 이름을 누르고 <strong>설정</strong>을 여세요.
        </p>
        <GuideImage
          src={settingsMenuImage}
          title="이름 메뉴의 설정"
          kind="menu"
        />
      </li>
      <li data-guide-step="connectors">
        <strong>커넥터 → 추가 → 커스텀 커넥터 추가</strong>
        <p>
          설정 왼쪽 목록 아래쪽의 <strong>커넥터</strong>에서 오른쪽 위{" "}
          <strong>추가</strong>를 누르세요.
        </p>
        <GuideImage src={connectorsImage} title="설정의 커넥터 화면" />
        <GuideImage
          src={addConnectorImage}
          title="추가 메뉴의 커스텀 커넥터 추가"
          kind="menu"
        />
      </li>
      <li data-guide-step="address">
        <strong>이름·연결 주소 입력</strong>
        <dl className={styles.guideFields}>
          <dt>이름</dt>
          <dd>당근망가번역기</dd>
          <dt>주소</dt>
          <dd>이 설정 화면 위에서 연결 주소를 복사해 붙여 넣으세요.</dd>
        </dl>
        <p>
          <strong>계속</strong>을 누르세요.
        </p>
        <GuideImage
          src={addressImage}
          title="커스텀 커넥터 이름·주소 입력 · 연결 주소는 가린 예시"
          kind="form"
        />
      </li>
      <ClaudeConnectSteps />
      <li data-guide-step="request">
        <strong>새 대화에서 작업 요청</strong>
        <p>
          대화 입력창의 도구 메뉴에서 당근망가번역기를 켜고 요청하세요. 당근
          앱은 켜 두세요.
        </p>
        <blockquote className={styles.example}>
          “이전 화 편집한 걸 보고, 다음 화도 비슷하게 처리해줘.”
        </blockquote>
      </li>
    </ol>
  );
}

/** Keep the detected sign-in options, then connect and approve in the app. */
function ClaudeConnectSteps() {
  return (
    <>
      <li data-guide-step="auth">
        <strong>인증 방식은 그대로 두고 추가</strong>
        <p>
          <strong>지금 로그인</strong>과 <strong>자동으로 등록</strong>이
          감지되어 선택된 그대로 두고 <strong>추가</strong>를 누르세요. 요청
          헤더는 필요 없습니다.
        </p>
        <GuideImage
          src={authImage}
          title="커스텀 커넥터 인증 설정 · 연결 주소는 가린 예시"
          kind="form"
        />
      </li>
      <li data-guide-step="connect">
        <strong>연결 → 같은 코드 확인 후 승인</strong>
        <p>
          <strong>연결</strong>을 누르면 브라우저에 승인 화면이 열립니다. 확인
          코드와 요청 권한이 당근 앱에 표시된 것과 같은지 확인하고 당근 앱에서
          승인하세요.
        </p>
        <GuideImage
          src={connectImage}
          title="커넥터의 연결 버튼 · 연결 주소는 가린 예시"
          kind="form"
        />
      </li>
    </>
  );
}

/** The shared three steps for CLI clients: register, approve, then ask. */
export function McpCliSteps({
  registerTitle,
  registration,
  approveTitle,
  approveNote,
  requestNote,
}: {
  registerTitle: string;
  registration: React.ReactNode;
  approveTitle: string;
  approveNote: string;
  requestNote: string;
}) {
  return (
    <ol className={styles.setupSteps}>
      <li>
        <strong>{registerTitle}</strong>
        {registration}
      </li>
      <li>
        <strong>{approveTitle}</strong>
        <p className={styles.note}>{approveNote}</p>
      </li>
      <li>
        <strong>새 대화에서 작업 요청</strong>
        <p className={styles.note}>{requestNote}</p>
        <blockquote className={styles.example}>
          “이전 화 편집한 걸 보고, 다음 화도 비슷하게 처리해줘.”
        </blockquote>
      </li>
    </ol>
  );
}

/** Claude Code registers the server from its CLI, like Codex. */
export function ClaudeCodeGuide({
  url,
  busy,
  run,
}: {
  url?: string | null;
  busy: boolean;
  run: RunAction;
}) {
  return (
    <McpCliSteps
      registerTitle="Claude Code에 서버 등록"
      registration={
        <>
          <p className={styles.note}>
            Claude Code가 설치된 PC의 터미널에서 실행하세요. 모든 프로젝트에서
            쓸 수 있게 사용자 범위로 등록됩니다.
          </p>
          <McpCommandCopy
            commands={
              url
                ? `claude mcp add --transport http --scope user carrot ${JSON.stringify(url)}`
                : null
            }
            busy={busy}
            run={run}
          />
        </>
      }
      approveTitle="/mcp에서 인증 후 승인"
      approveNote="Claude Code 안에서 /mcp → carrot → Authenticate를 고르면 브라우저가 열립니다. 확인 코드를 비교하고 당근 앱에서 승인하세요."
      requestNote="연결 후 Claude Code에서 새 대화를 여세요. 당근 앱은 켜 두세요."
    />
  );
}
