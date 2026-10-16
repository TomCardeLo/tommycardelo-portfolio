// Tema Shiki monocromo + rojo, acorde al diseño "tactical telemetry"
import type { ShikiConfig } from "astro";

const theme: NonNullable<ShikiConfig["theme"]> = {
  name: "telemetry",
  type: "dark",
  colors: {
    "editor.background": "#101010",
    "editor.foreground": "#eaeaea",
  },
  tokenColors: [
    { settings: { foreground: "#eaeaea" } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#6b6b6b", fontStyle: "italic" },
    },
    {
      scope: ["string", "string.quoted", "punctuation.definition.string"],
      settings: { foreground: "#b5b5b5" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "constant.other",
        "support.constant",
      ],
      settings: { foreground: "#cfcfcf", fontStyle: "bold" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical",
      ],
      settings: { foreground: "#ff2a2a" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#ffffff" },
    },
    {
      scope: [
        "punctuation",
        "meta.brace",
        "keyword.operator",
        "meta.delimiter",
      ],
      settings: { foreground: "#8a8a8a" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.class",
        "support.type",
        "entity.other.inherited-class",
      ],
      settings: { foreground: "#d4d4d4" },
    },
  ],
};

export default theme;
