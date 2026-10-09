import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./ChatPanel.module.css";

// Remote images/HTML never execute or fetch through model output. App images
// use the authenticated chat image gateway and page links use native controls.
const elements = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={elements}
        unwrapDisallowed
        skipHtml
      >
        {text}
      </Markdown>
    </div>
  );
}
