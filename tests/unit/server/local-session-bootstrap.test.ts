import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vite-plus/test";

import { createLocalWorkspaceSessionBootstrapMiddleware } from "../../../src/server/workspace/local-session-bootstrap";
import { resolveWorkspaceSessionCookieName } from "../../../src/server/workspace/session-cookie";

const configuration = {
  enabled: "1",
  token: "server-secret",
  workspaceId: "workspace-1",
};
const localCookieName = resolveWorkspaceSessionCookieName({
  enabled: "1",
  host: "localhost:3000",
});

describe("local workspace session bootstrap middleware", () => {
  it("bootstraps a local loopback request with an HttpOnly cookie", () => {
    const { request, response, state } = testContext();

    createLocalWorkspaceSessionBootstrapMiddleware(configuration)(request, response, state.next);

    expect(state.nextCalls).toBe(0);
    expect(state.statusCode).toBe(204);
    expect(state.headers).toEqual({
      "cache-control": "no-store",
      "set-cookie": `${localCookieName}=server-secret; Path=/; HttpOnly; SameSite=Strict`,
      "x-web-ide-workspace-id": "workspace-1",
    });
    expect(state.ended).toBe(true);
  });

  it.each([
    { name: "bootstrap is disabled", overrides: { enabled: "0" } },
    { name: "workspace id is missing", overrides: { workspaceId: undefined } },
    { name: "workspace id is empty", overrides: { workspaceId: "" } },
    { name: "workspace id is blank", overrides: { workspaceId: "   " } },
    { name: "token is missing", overrides: { token: undefined } },
    { name: "token is empty", overrides: { token: "" } },
    { name: "token is blank", overrides: { token: "   " } },
    { name: "request path is different", url: "/api/workspace/session/other" },
    { name: "request method is different", method: "GET" },
    { name: "remote address is not loopback", remoteAddress: "192.0.2.10" },
    { name: "host is not local", host: "workspace.example.test" },
    {
      name: "forwarded loopback headers are not trusted",
      remoteAddress: "192.0.2.10",
      forwardedFor: "127.0.0.1",
    },
    { name: "origin has a mismatched port", origin: "http://localhost:4000" },
    { name: "origin is foreign", origin: "http://example.test" },
    { name: "origin is null", origin: "null" },
  ])(
    "passes through when $name",
    ({ host, method, overrides, remoteAddress, url, forwardedFor, origin }) => {
      const { request, response, state } = testContext({
        host,
        method,
        remoteAddress,
        url,
        forwardedFor,
        origin,
      });

      createLocalWorkspaceSessionBootstrapMiddleware({ ...configuration, ...overrides })(
        request,
        response,
        state.next,
      );

      expect(state.nextCalls).toBe(1);
      expect(state.ended).toBe(false);
      expect(state.headers).toEqual({});
    },
  );

  it("passes through when the request already has the valid cookie", () => {
    const { request, response, state } = testContext({
      cookie: `${localCookieName}=server-secret`,
    });

    createLocalWorkspaceSessionBootstrapMiddleware(configuration)(request, response, state.next);

    expect(state.nextCalls).toBe(1);
    expect(state.ended).toBe(false);
    expect(state.headers).toEqual({});
  });

  it("accepts a same-origin request", () => {
    const { request, response, state } = testContext({ origin: "http://localhost:3000" });

    createLocalWorkspaceSessionBootstrapMiddleware(configuration)(request, response, state.next);

    expect(state.statusCode).toBe(204);
    expect(state.headers["x-web-ide-workspace-id"]).toBe("workspace-1");
  });

  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3000", "[::1]", "[::1]:3000"])(
    "accepts local host %s",
    (host) => {
      const { request, response, state } = testContext({ host });

      createLocalWorkspaceSessionBootstrapMiddleware(configuration)(request, response, state.next);

      expect(state.statusCode).toBe(204);
      expect(state.nextCalls).toBe(0);
    },
  );

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts loopback address %s",
    (remoteAddress) => {
      const { request, response, state } = testContext({ remoteAddress });

      createLocalWorkspaceSessionBootstrapMiddleware(configuration)(request, response, state.next);

      expect(state.statusCode).toBe(204);
      expect(state.nextCalls).toBe(0);
    },
  );
});

function testContext(
  options: {
    forwardedFor?: string;
    host?: string;
    method?: string;
    origin?: string;
    remoteAddress?: string;
    url?: string;
    cookie?: string;
  } = {},
) {
  const state = {
    ended: false,
    headers: {} as Record<string, string>,
    nextCalls: 0,
    statusCode: 200,
    next: () => {
      state.nextCalls += 1;
    },
  };
  const request = {
    headers: {
      host: options.host ?? "localhost:3000",
      ...(options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    method: options.method ?? "POST",
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    url: options.url ?? "/api/workspace/session",
  } as unknown as IncomingMessage;
  const response = {
    end: () => {
      state.ended = true;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
  } as unknown as ServerResponse;

  return { request, response, state };
}
