import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSignedHeaders,
  DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH,
  HmacRequestAuthenticator,
  resolveRuntimeManagerNonceStorePath,
  RuntimeAuthenticationError,
  SqliteNonceStore,
} from "./auth.js";

const initialTime = 1_788_115_200_000;
const maxClockSkewMs = 300_000;
const secret = "shared-secret";

describe("durable Runtime Manager nonce storage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("binds a signature to its uppercase method and normalized path", () => {
    const store = new SqliteNonceStore(":memory:");
    const body = Buffer.from('{"runtimeId":"runtime_01"}');
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-target-bound",
      secret,
      timestamp: initialTime,
    });
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: store,
      now: () => initialTime,
      secret,
    });

    expect(() => authenticator.authenticate(headers, body, "POST", "/v1/runtimes/stop")).toThrow(
      new RuntimeAuthenticationError(),
    );
    expect(() => authenticator.authenticate(headers, body, "POST", "/v1/runtimes/remove")).toThrow(
      new RuntimeAuthenticationError(),
    );
    expect(() => authenticator.authenticate(headers, body, "GET", "/v1/runtimes/start")).toThrow(
      new RuntimeAuthenticationError(),
    );
    expect(authenticator.authenticate(headers, body, "post", "/v1/runtimes/./start")).toEqual({
      nonce: "nonce-target-bound",
      timestamp: initialTime,
    });
    store.close();
  });

  function nonceStorePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "runtime-manager-nonces-"));
    temporaryDirectories.push(directory);
    return join(directory, "nonces.sqlite");
  }

  it("rejects a nonce after constructing a new authenticator over the same store", () => {
    const path = nonceStorePath();
    const body = Buffer.alloc(0);
    const headers = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-persisted",
      secret,
      timestamp: initialTime,
    });
    const firstStore = new SqliteNonceStore(path);
    const firstAuthenticator = new HmacRequestAuthenticator({
      nonceStore: firstStore,
      now: () => initialTime,
      secret,
    });

    firstAuthenticator.authenticate(headers, body, "POST", "/v1/runtimes/start");
    firstStore.close();

    const secondStore = new SqliteNonceStore(path);
    const secondAuthenticator = new HmacRequestAuthenticator({
      nonceStore: secondStore,
      now: () => initialTime,
      secret,
    });
    expect(() =>
      secondAuthenticator.authenticate(headers, body, "POST", "/v1/runtimes/start"),
    ).toThrow(new RuntimeAuthenticationError());
    secondStore.close();
  });

  it("keeps a nonce through its full validity interval and prunes it afterward", () => {
    const path = nonceStorePath();
    const store = new SqliteNonceStore(path);
    const body = Buffer.alloc(0);
    let currentTime = initialTime;
    const authenticator = new HmacRequestAuthenticator({
      nonceStore: store,
      now: () => currentTime,
      secret,
    });
    const firstHeaders = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-pruned",
      secret,
      timestamp: initialTime,
    });

    authenticator.authenticate(firstHeaders, body, "POST", "/v1/runtimes/start");
    currentTime = initialTime + maxClockSkewMs;
    expect(() =>
      authenticator.authenticate(firstHeaders, body, "POST", "/v1/runtimes/start"),
    ).toThrow(new RuntimeAuthenticationError());

    currentTime += 1;
    const newHeaders = createSignedHeaders({
      body,
      method: "POST",
      path: "/v1/runtimes/start",
      nonce: "nonce-pruned",
      secret,
      timestamp: currentTime,
    });
    expect(authenticator.authenticate(newHeaders, body, "POST", "/v1/runtimes/start")).toEqual({
      nonce: "nonce-pruned",
      timestamp: currentTime,
    });
    store.close();
  });

  it("uses a private /data default and accepts an environment override", () => {
    expect(DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH).toBe("/data/runtime-manager-nonces.sqlite");
    expect(resolveRuntimeManagerNonceStorePath({})).toBe(DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH);
    expect(
      resolveRuntimeManagerNonceStorePath({
        RUNTIME_MANAGER_NONCE_STORE_PATH: "/manager-data/nonces.sqlite",
      }),
    ).toBe("/manager-data/nonces.sqlite");
  });
});
