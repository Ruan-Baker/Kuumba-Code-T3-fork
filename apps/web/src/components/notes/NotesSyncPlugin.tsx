import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { BLUR_COMMAND, FOCUS_COMMAND, COMMAND_PRIORITY_LOW } from "lexical";

interface NotesSyncPluginProps {
  externalState: string | null;
}

export function NotesSyncPlugin({ externalState }: NotesSyncPluginProps) {
  const [editor] = useLexicalComposerContext();
  const isFocused = useRef(false);
  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    const unregFocus = editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        isFocused.current = true;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        isFocused.current = false;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregFocus();
      unregBlur();
    };
  }, [editor]);

  useEffect(() => {
    if (!externalState) return;
    if (externalState === lastApplied.current) return;
    if (isFocused.current) return;

    try {
      const parsed = JSON.parse(externalState);
      const editorState = editor.parseEditorState(parsed);
      editor.setEditorState(editorState);
      lastApplied.current = externalState;
    } catch {
      // Invalid state — ignore
    }
  }, [externalState, editor]);

  return null;
}
