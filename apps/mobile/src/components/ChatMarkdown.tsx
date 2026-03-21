import { memo, useCallback, useState, Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface ChatMarkdownProps {
  text: string;
  isStreaming?: boolean | undefined;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
  return "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:opacity-100"
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </button>
  );
}

const components: Components = {
  pre({ children }) {
    // Extract code content for copy button
    const childArray = Children.toArray(children);
    const codeChild = childArray[0];
    let codeText = "";
    let language = "";

    if (isValidElement<{ className?: string; children?: ReactNode }>(codeChild) && codeChild.type === "code") {
      codeText = nodeToPlainText(codeChild.props.children);
      const match = codeChild.props.className?.match(/language-([^\s]+)/);
      language = match?.[1] ?? "";
    }

    return (
      <div className="chat-markdown-codeblock group relative">
        {language && (
          <div className="flex items-center justify-between rounded-t-[0.75rem] border border-b-0 border-border bg-muted/50 px-3 py-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">{language}</span>
          </div>
        )}
        <pre className={cn(language && "!mt-0 !rounded-t-none")}>
          {children}
        </pre>
        <CopyButton text={codeText} />
      </div>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

export const ChatMarkdown = memo(function ChatMarkdown({ text, isStreaming }: ChatMarkdownProps) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
      {isStreaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary" />
      )}
    </div>
  );
});
