import React from "react";
import { McpCliSteps, McpCommandCopy } from "./McpClaudeGuide";
import styles from "./McpSettingsPanel.module.css";

export function OpenCodeGuide({
  url,
  busy,
  run,
}: {
  url?: string | null;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const config = url
    ? JSON.stringify(
        {
          mcp: { carrot: { type: "remote", url, enabled: true, oauth: {} } },
        },
        null,
        2,
      )
    : null;
  return (
    <McpCliSteps
      registerTitle="OpenCode 설정에 당근 추가"
      registration={
        <>
          <p className={styles.note}>
            ~/.config/opencode/opencode.json 또는 opencode.jsonc의 기존 설정에
            아래 mcp.carrot 항목을 추가하세요.
          </p>
          <McpCommandCopy
            commands={config}
            label="설정 복사"
            busy={busy}
            run={run}
          />
          <p className={styles.note}>
            등록한 뒤 터미널에서 인증하고 연결 상태를 확인하세요.
          </p>
          <McpCommandCopy
            commands={
              url ? "opencode mcp auth carrot\nopencode mcp list" : null
            }
            label="인증 명령 복사"
            busy={busy}
            run={run}
          />
        </>
      }
      approveTitle="같은 코드 확인 후 승인"
      approveNote="브라우저와 당근 앱의 확인 코드가 같은지 확인하고 당근에서 승인하세요."
      requestNote="당근 앱을 켜 둔 채 OpenCode에서 요청하세요."
    />
  );
}

export function GenericMcpGuide({ url }: { url?: string | null }) {
  return (
    <>
      <dl className={styles.guideFields}>
        <dt>서버 주소</dt>
        <dd className={styles.address}>{url ?? "MCP를 켜면 표시됩니다."}</dd>
        <dt>연결 방식</dt>
        <dd>HTTP (Streamable HTTP)</dd>
        <dt>인증</dt>
        <dd>OAuth</dd>
      </dl>
      <ol className={styles.setupSteps}>
        <li>
          <strong>원격 MCP 서버 추가</strong>
          <p>사용하는 앱의 MCP 설정에 위 주소를 입력하고 연결하세요.</p>
        </li>
        <li>
          <strong>같은 코드 확인 후 승인</strong>
          <p>
            브라우저와 당근 앱의 확인 코드가 같은지 확인하고 당근에서
            승인하세요.
          </p>
        </li>
        <li>
          <strong>작업 요청</strong>
          <p>당근 앱을 켜 둔 채 AI 앱에 번역이나 편집을 요청하세요.</p>
        </li>
      </ol>
    </>
  );
}
