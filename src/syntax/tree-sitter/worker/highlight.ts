import type { Query, QueryCapture } from "web-tree-sitter";

import type { SyntaxToken, SyntaxTokenType } from "../../types";
import type { DocumentSession } from "./document-session";
import { treeSitterNodeToTextRange } from "./text-range";

interface CaptureMapping {
  readonly type: SyntaxTokenType;
  readonly priority: number;
}

const CAPTURE_MAPPINGS: Readonly<Record<string, CaptureMapping | undefined>> = {
  keyword: { type: "keyword", priority: 80 },
  "keyword.operator": { type: "operator", priority: 85 },
  string: { type: "string", priority: 20 },
  number: { type: "number", priority: 90 },
  float: { type: "number", priority: 90 },
  comment: { type: "comment", priority: 100 },
  "function.call": { type: "function", priority: 100 },
  function: { type: "function", priority: 95 },
  variable: { type: "variable", priority: 50 },
  parameter: { type: "variable", priority: 55 },
  field: { type: "property", priority: 60 },
  attribute: { type: "property", priority: 60 },
  type: { type: "type", priority: 60 },
  "type.builtin": { type: "type", priority: 65 },
  "type.qualifier": { type: "type", priority: 65 },
  storageclass: { type: "type", priority: 65 },
  operator: { type: "operator", priority: 70 },
  boolean: { type: "operator", priority: 70 },
  conditional: { type: "operator", priority: 70 },
  "punctuation.bracket": { type: "punctuation", priority: 40 },
  "punctuation.delimiter": { type: "punctuation", priority: 40 },
};

interface TokenCandidate extends SyntaxToken {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly priority: number;
}

function mappingForCapture(capture: QueryCapture): CaptureMapping | undefined {
  return CAPTURE_MAPPINGS[capture.name];
}

function normalizeCaptures(
  session: DocumentSession,
  captures: readonly QueryCapture[],
): SyntaxToken[] {
  const byRange = new Map<string, TokenCandidate>();
  for (const capture of captures) {
    const mapping = mappingForCapture(capture);
    if (mapping === undefined || capture.node.startIndex === capture.node.endIndex) {
      continue;
    }

    const candidate: TokenCandidate = {
      range: treeSitterNodeToTextRange(session.textMirror, capture.node),
      type: mapping.type,
      startIndex: capture.node.startIndex,
      endIndex: capture.node.endIndex,
      priority: mapping.priority,
    };
    const key = `${candidate.startIndex}:${candidate.endIndex}`;
    const existing = byRange.get(key);
    if (existing === undefined || candidate.priority > existing.priority) {
      byRange.set(key, candidate);
    }
  }

  const candidates = [...byRange.values()].sort(
    (left, right) =>
      left.startIndex - right.startIndex ||
      right.endIndex - left.endIndex ||
      right.priority - left.priority,
  );
  const normalized: TokenCandidate[] = [];
  for (const candidate of candidates) {
    const previous = normalized.at(-1);
    if (previous !== undefined && candidate.startIndex < previous.endIndex) {
      if (candidate.priority > previous.priority) {
        normalized[normalized.length - 1] = candidate;
      }
      continue;
    }
    normalized.push(candidate);
  }

  return normalized.map(({ range, type }) => ({ range, type }));
}

export function collectHighlightTokens(session: DocumentSession, query: Query): SyntaxToken[] {
  return normalizeCaptures(session, query.captures(session.tree.rootNode));
}
