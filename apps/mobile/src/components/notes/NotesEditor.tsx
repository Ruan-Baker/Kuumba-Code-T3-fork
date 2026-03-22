import { useCallback, useEffect, useRef } from "react";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  HEADING,
  QUOTE,
  ORDERED_LIST,
  UNORDERED_LIST,
  CHECK_LIST,
  type Transformer,
} from "@lexical/markdown";
import type { EditorState } from "lexical";

// Only the transformers we need — excludes CODE which requires CodeNode
const NOTES_TRANSFORMERS: Transformer[] = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
];

import { notesTheme } from "./notesTheme";
import { CalloutNode } from "./CalloutNode";
import { NotesToolbarPlugin } from "./NotesToolbarPlugin";
import { NotesSyncPlugin } from "./NotesSyncPlugin";

const NOTES_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, CalloutNode];

interface NotesEditorProps {
  initialEditorState?: string | null;
  externalState?: string | null;
  onChange: (serialized: string) => void;
  className?: string;
  toolbarSize?: "compact" | "mobile";
  autoFocus?: boolean;
}

export function NotesEditor({
  initialEditorState,
  externalState,
  onChange,
  className,
  toolbarSize = "compact",
  autoFocus = true,
}: NotesEditorProps) {
  const initialConfig: InitialConfigType = {
    namespace: "notes-editor",
    nodes: NOTES_NODES,
    theme: notesTheme,
    editable: true,
    onError: (error: Error) => {
      console.error("[NotesEditor] Lexical error:", error);
    },
    ...(initialEditorState != null ? { editorState: initialEditorState } : {}),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <NotesToolbarPlugin size={toolbarSize} />
      <div className={`relative flex-1 overflow-y-auto ${className ?? ""}`}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-full px-3 py-2 text-[13px] leading-relaxed text-foreground focus:outline-none"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <CheckListPlugin />
        <HistoryPlugin />
        <MarkdownShortcutPlugin transformers={NOTES_TRANSFORMERS} />
        <OnChangeHandler onChange={onChange} />
        <NotesSyncPlugin externalState={externalState ?? null} />
        {autoFocus && <AutoFocusPlugin />}
      </div>
    </LexicalComposer>
  );
}

function OnChangeHandler({ onChange }: { onChange: (serialized: string) => void }) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleChange = useCallback((editorState: EditorState) => {
    const json = editorState.toJSON();
    onChangeRef.current(JSON.stringify(json));
  }, []);

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}

function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const timer = setTimeout(() => editor.focus(), 50);
    return () => clearTimeout(timer);
  }, [editor]);
  return null;
}
