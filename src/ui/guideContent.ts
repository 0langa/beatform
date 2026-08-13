export type Inline =
  | string
  | { kbd: string }
  | { em: string }
  | { strong: string }
  | { code: string }
  | { link: { text: string; href: string } };

export type DerivedKind = "shortcut-sheet" | "mod-sources" | "preferences-tabs";

export type Block =
  | { h4: string }
  | { p: Inline[] }
  | { ul: Inline[][] }
  | { ol: Inline[][] }
  | { derived: DerivedKind };

export interface GuideSection {
  id: string;
  title: string;
  blocks: Block[];
}

export const GUIDE: readonly GuideSection[] = [];

export const GUIDE_FIXTURE: readonly GuideSection[] = [
  {
    id: "start",
    title: "Getting Started",
    blocks: [
      {
        h4: "Basic Controls",
      },
      {
        p: ["Press ", { kbd: "Space" }, " to start playback."],
      },
      {
        p: [
          "This guide uses ",
          { em: "emphasis" },
          " for optional features and ",
          { strong: "strong" },
          " for important ones.",
        ],
      },
      {
        p: ["Use the ", { code: "code" }, " element in your documentation."],
      },
      {
        p: [
          "For more info, see the ",
          { link: { text: "link text", href: "https://example.invalid" } },
          ".",
        ],
      },
      {
        ul: [["First list item"], ["Second list item"], ["Third list item"]],
      },
    ],
  },
  {
    id: "second",
    title: "Advanced Usage",
    blocks: [
      {
        h4: "Numbered Steps",
      },
      {
        ol: [["Start the application"], ["Configure your settings"], ["Export your project"]],
      },
      {
        derived: "mod-sources",
      },
    ],
  },
];
