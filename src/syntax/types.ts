/** Shared project DTO; line and character are both 0-based UTF-16 offsets. */
export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/** Token vocabulary owned by the project, independent of Tree-sitter captures. */
export const SYNTAX_TOKEN_TYPES = [
  "keyword",
  "string",
  "number",
  "comment",
  "function",
  "variable",
  "property",
  "type",
  "operator",
  "punctuation",
] as const;

export type SyntaxTokenType = (typeof SYNTAX_TOKEN_TYPES)[number];

export interface SyntaxToken {
  range: TextRange;
  type: SyntaxTokenType;
}

export interface SyntaxFoldingRange {
  range: TextRange;
}

/** Ordered from the smallest node range to its outermost parent. */
export interface SyntaxSelectionPath {
  ranges: TextRange[];
}
