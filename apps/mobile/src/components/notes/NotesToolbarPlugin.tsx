import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useState } from "react";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
} from "lexical";
import { $isHeadingNode, $createHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  $isListNode,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode } from "lexical";
import { $createCalloutNode, $isCalloutNode, type CalloutType } from "./CalloutNode";
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  ListIcon,
  ListOrderedIcon,
  ListChecksIcon,
  QuoteIcon,
  MessageSquareQuoteIcon,
} from "lucide-react";

interface ToolbarProps {
  size?: "compact" | "mobile";
}

export function NotesToolbarPlugin({ size = "compact" }: ToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const [activeFormats, setActiveFormats] = useState<Set<TextFormatType>>(new Set());
  const [blockType, setBlockType] = useState<string>("paragraph");

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        const formats = new Set<TextFormatType>();
        if (selection.hasFormat("bold")) formats.add("bold");
        if (selection.hasFormat("italic")) formats.add("italic");
        if (selection.hasFormat("underline")) formats.add("underline");
        if (selection.hasFormat("strikethrough")) formats.add("strikethrough");
        setActiveFormats(formats);

        const anchorNode = selection.anchor.getNode();
        const element = anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

        if ($isHeadingNode(element)) {
          setBlockType(element.getTag());
        } else if ($isListNode(element)) {
          const listType = element.getListType();
          setBlockType(listType === "check" ? "check" : listType === "number" ? "ol" : "ul");
        } else if ($isCalloutNode(element)) {
          setBlockType("callout");
        } else {
          setBlockType(element.getType());
        }

        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor]);

  const formatText = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const formatHeading = useCallback(
    (tag: HeadingTagType) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (blockType === tag) {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      });
    },
    [editor, blockType],
  );

  const insertList = useCallback(
    (type: "ul" | "ol" | "check") => {
      if (type === "ul") editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      else if (type === "ol") editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      else editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
    },
    [editor],
  );

  const insertCallout = useCallback(
    (calloutType: CalloutType = "info") => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (blockType === "callout") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createCalloutNode(calloutType));
        }
      });
    },
    [editor, blockType],
  );

  const btnSize = size === "mobile" ? "size-9" : "size-7";
  const iconSize = size === "mobile" ? "size-4.5" : "size-3.5";

  const btn = (active: boolean) =>
    `flex items-center justify-center ${btnSize} rounded transition-colors ${
      active
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 bg-muted/20 shrink-0 overflow-x-auto">
      {/* Inline formatting */}
      <button type="button" className={btn(activeFormats.has("bold"))} onClick={() => formatText("bold")} title="Bold (Ctrl+B)">
        <BoldIcon className={iconSize} />
      </button>
      <button type="button" className={btn(activeFormats.has("italic"))} onClick={() => formatText("italic")} title="Italic (Ctrl+I)">
        <ItalicIcon className={iconSize} />
      </button>
      <button type="button" className={btn(activeFormats.has("underline"))} onClick={() => formatText("underline")} title="Underline (Ctrl+U)">
        <UnderlineIcon className={iconSize} />
      </button>
      <button type="button" className={btn(activeFormats.has("strikethrough"))} onClick={() => formatText("strikethrough")} title="Strikethrough">
        <StrikethroughIcon className={iconSize} />
      </button>

      <div className="mx-1 h-4 w-px bg-border/50" />

      {/* Block types */}
      <button type="button" className={btn(blockType === "h1")} onClick={() => formatHeading("h1")} title="Heading 1">
        <Heading1Icon className={iconSize} />
      </button>
      <button type="button" className={btn(blockType === "h2")} onClick={() => formatHeading("h2")} title="Heading 2">
        <Heading2Icon className={iconSize} />
      </button>

      <div className="mx-1 h-4 w-px bg-border/50" />

      {/* Lists */}
      <button type="button" className={btn(blockType === "ul" || blockType === "bullet")} onClick={() => insertList("ul")} title="Bullet list">
        <ListIcon className={iconSize} />
      </button>
      <button type="button" className={btn(blockType === "ol" || blockType === "number")} onClick={() => insertList("ol")} title="Numbered list">
        <ListOrderedIcon className={iconSize} />
      </button>
      <button type="button" className={btn(blockType === "check")} onClick={() => insertList("check")} title="Checkbox list">
        <ListChecksIcon className={iconSize} />
      </button>

      <div className="mx-1 h-4 w-px bg-border/50" />

      {/* Callout */}
      <button type="button" className={btn(blockType === "callout")} onClick={() => insertCallout("info")} title="Callout block">
        <MessageSquareQuoteIcon className={iconSize} />
      </button>
    </div>
  );
}
