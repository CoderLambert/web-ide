import type { Node } from "web-tree-sitter";

import type { InspectDocument, InspectNode } from "../protocol";
import type { DocumentSession } from "./document-session";
import { treeSitterPositionToTextPosition } from "./text-range";

export interface AstInspectionData {
  root: InspectNode | null;
  nodeCount: number;
  truncated: boolean;
}

export type AstInspectorErrorCode = "INVALID_MESSAGE" | "VERSION_MISMATCH" | "RESYNC_REQUIRED";

export class AstInspectorError extends Error {
  readonly code: AstInspectorErrorCode;

  constructor(code: AstInspectorErrorCode, message: string) {
    super(message);
    this.name = "AstInspectorError";
    this.code = code;
  }
}

interface NodeFrame {
  node: Node;
  output: InspectNode;
  depth: number;
  nextChild: number;
}

interface InspectionState {
  nodeCount: number;
  truncated: boolean;
}

export class AstInspector {
  inspect(
    session: DocumentSession,
    request: Pick<InspectDocument, "expectedVersion" | "maxDepth" | "maxNodes">,
  ): AstInspectionData {
    if (session.state === "desynced") {
      throw new AstInspectorError(
        "RESYNC_REQUIRED",
        `Session "${session.sessionId}" requires a full document resync before inspection.`,
      );
    }
    if (request.expectedVersion !== session.documentVersion) {
      throw new AstInspectorError(
        "VERSION_MISMATCH",
        `Expected document version ${request.expectedVersion}, found ${session.documentVersion}.`,
      );
    }
    if (
      !Number.isInteger(request.maxDepth) ||
      request.maxDepth < 0 ||
      !Number.isInteger(request.maxNodes) ||
      request.maxNodes < 0
    ) {
      throw new AstInspectorError(
        "INVALID_MESSAGE",
        "Inspector limits must be non-negative integers.",
      );
    }

    if (request.maxNodes === 0) {
      return { root: null, nodeCount: 0, truncated: true };
    }

    const state: InspectionState = { nodeCount: 1, truncated: false };
    const root = createInspectNode(session.textMirror, session.tree.rootNode);
    const stack: NodeFrame[] = [
      { node: session.tree.rootNode, output: root, depth: 0, nextChild: 0 },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.depth >= request.maxDepth) {
        if (frame.node.childCount > 0) {
          frame.output.truncated = true;
          state.truncated = true;
        }
        stack.pop();
        continue;
      }

      if (frame.nextChild >= frame.node.childCount) {
        stack.pop();
        continue;
      }

      if (state.nodeCount >= request.maxNodes) {
        frame.output.truncated = true;
        state.truncated = true;
        break;
      }

      const child = frame.node.child(frame.nextChild);
      frame.nextChild += 1;
      if (child === null) {
        continue;
      }

      const childOutput = createInspectNode(session.textMirror, child);
      frame.output.children.push(childOutput);
      state.nodeCount += 1;
      stack.push({
        node: child,
        output: childOutput,
        depth: frame.depth + 1,
        nextChild: 0,
      });
    }

    return { root, nodeCount: state.nodeCount, truncated: state.truncated };
  }
}

function createInspectNode(text: string, node: Node): InspectNode {
  return {
    type: node.type,
    isNamed: node.isNamed,
    range: {
      start: treeSitterPositionToTextPosition(text, node.startPosition),
      end: treeSitterPositionToTextPosition(text, node.endPosition),
    },
    children: [],
    truncated: false,
  };
}
