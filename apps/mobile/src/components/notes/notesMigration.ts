import { createEditor, type SerializedEditorState } from "lexical";
import {
  $convertFromMarkdownString,
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
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CalloutNode } from "./CalloutNode";

const MIGRATION_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, CalloutNode];

const NOTES_TRANSFORMERS: Transformer[] = [
  HEADING, QUOTE, UNORDERED_LIST, ORDERED_LIST, CHECK_LIST,
  BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE, BOLD_STAR, BOLD_UNDERSCORE,
  ITALIC_STAR, ITALIC_UNDERSCORE, STRIKETHROUGH,
];

/**
 * Converts old v1 markdown-like text into a Lexical SerializedEditorState.
 * Handles plain text and `- [x]`/`- [ ]` checkbox syntax.
 */
export function migrateV1ToV2(text: string): SerializedEditorState {
  const editor = createEditor({
    nodes: MIGRATION_NODES,
    onError: () => {},
  });

  editor.update(
    () => {
      $convertFromMarkdownString(text, NOTES_TRANSFORMERS);
    },
    { discrete: true },
  );

  return editor.getEditorState().toJSON();
}
