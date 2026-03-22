import type { EditorThemeClasses } from "lexical";

export const notesTheme: EditorThemeClasses = {
  heading: {
    h1: "text-2xl font-bold mt-4 mb-2",
    h2: "text-xl font-semibold mt-3 mb-1.5",
    h3: "text-lg font-medium mt-2 mb-1",
  },
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    underlineStrikethrough: "underline line-through",
  },
  list: {
    ul: "list-disc ml-4 my-1",
    ol: "list-decimal ml-4 my-1",
    listitem: "my-0.5",
    listitemChecked:
      "list-none relative ml-0 line-through opacity-50 [&::before]:content-['☑'] [&::before]:absolute [&::before]:-left-5 [&::before]:cursor-pointer",
    listitemUnchecked:
      "list-none relative ml-0 [&::before]:content-['☐'] [&::before]:absolute [&::before]:-left-5 [&::before]:cursor-pointer",
    nested: {
      listitem: "list-none",
    },
  },
  quote:
    "border-l-[3px] border-primary/40 pl-3 my-2 text-muted-foreground italic",
  paragraph: "my-0",
};
