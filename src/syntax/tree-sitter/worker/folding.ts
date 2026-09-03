import type { Query } from "web-tree-sitter";

import type { SyntaxFoldingRange } from "../../types";
import type { DocumentSession } from "./document-session";
import { treeSitterNodeToTextRange } from "./text-range";

export function collectFoldingRanges(session: DocumentSession, query: Query): SyntaxFoldingRange[] {
  const ranges = new Map<string, SyntaxFoldingRange>();
  for (const capture of query.captures(session.tree.rootNode)) {
    if (capture.name !== "fold") {
      continue;
    }

    const range = treeSitterNodeToTextRange(session.textMirror, capture.node);
    if (range.start.line >= range.end.line) {
      continue;
    }

    const key = `${capture.node.startIndex}:${capture.node.endIndex}`;
    ranges.set(key, { range });
  }

  return [...ranges.values()].sort(
    (left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.character - right.range.start.character ||
      right.range.end.line - left.range.end.line ||
      right.range.end.character - left.range.end.character,
  );
}
