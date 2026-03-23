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
      "list-none relative pl-7 my-0.5 line-through opacity-50 [&::before]:content-[''] [&::before]:absolute [&::before]:left-0 [&::before]:top-0.5 [&::before]:w-4 [&::before]:h-4 [&::before]:border [&::before]:border-primary [&::before]:bg-primary [&::before]:rounded [&::before]:cursor-pointer [&::before]:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] [&::before]:bg-center [&::before]:bg-no-repeat",
    listitemUnchecked:
      "list-none relative pl-7 my-0.5 [&::before]:content-[''] [&::before]:absolute [&::before]:left-0 [&::before]:top-0.5 [&::before]:w-4 [&::before]:h-4 [&::before]:border [&::before]:border-muted-foreground/40 [&::before]:rounded [&::before]:cursor-pointer",
    nested: {
      listitem: "list-none",
    },
  },
  quote: "border-l-[3px] border-primary/40 pl-3 my-2 text-muted-foreground italic",
  paragraph: "my-0",
};
