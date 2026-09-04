import { describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import {
  AutomaticThreadTitleService,
  type AutomaticThreadTitlePorts,
  type FirstPromptTitleCandidate,
} from "./service";

const host: HostRecord = {
  id: 7,
  connectionKind: "managed",
  name: "Local",
  sshHost: "localhost",
  username: null,
  port: null,
  authMode: "agent",
  privateKeyPath: null,
  privateKey: null,
  password: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("AutomaticThreadTitleService", () => {
  it("generates and persists a title only for the first accepted user prompt", async () => {
    const { ports, renameAndProject } = portsFixture();
    const service = new AutomaticThreadTitleService(ports);
    const candidate = service.prepare({
      userId: 3,
      host,
      threadId: "thread-1",
      message: "分析本月营业额",
      model: "model-1",
    });

    expect(candidate).not.toBeNull();
    await service.start(candidate!);
    expect(renameAndProject).toHaveBeenNthCalledWith(1, candidate, "分析本月营业额");
    expect(renameAndProject).toHaveBeenNthCalledWith(2, candidate, "月度营业额分析");
    expect(
      service.prepare({
        userId: 3,
        host,
        threadId: "thread-1",
        message: "第二条消息",
        model: "model-1",
      }),
    ).toBeNull();
  });

  it("lets a user rename cancel a late automatic result", async () => {
    let resolveTitle: ((title: string) => void) | undefined;
    const title = new Promise<string>((resolve) => {
      resolveTitle = resolve;
    });
    const { ports, renameAndProject } = portsFixture({ generate: () => title });
    const service = new AutomaticThreadTitleService(ports);
    const candidate = service.prepare({
      userId: 3,
      host,
      threadId: "thread-2",
      message: "分析本月营业额",
      model: "model-1",
    });
    expect(candidate).not.toBeNull();

    const pending = service.start(candidate!);
    await vi.waitFor(() => expect(renameAndProject).toHaveBeenCalledOnce());
    service.cancel(3, host.id, "thread-2");
    resolveTitle?.("迟到的标题");
    await pending;

    expect(renameAndProject).toHaveBeenCalledWith(candidate, "分析本月营业额");
  });

  it("skips titled, non-empty, and subagent sessions", () => {
    const state = { eligible: true, name: null as string | null, hasUserMessage: false };
    const { ports } = portsFixture({ inspect: () => state });
    const service = new AutomaticThreadTitleService(ports);
    const input = {
      userId: 3,
      host,
      threadId: "thread-3",
      message: "first prompt",
      model: "model-1",
    };

    state.name = "Manual title";
    expect(service.prepare(input)).toBeNull();
    state.name = null;
    state.hasUserMessage = true;
    expect(service.prepare(input)).toBeNull();
    state.hasUserMessage = false;
    state.eligible = false;
    expect(service.prepare(input)).toBeNull();
  });

  it("persists the fallback without calling a Provider when the model is unavailable", async () => {
    const { ports, renameAndProject } = portsFixture();
    const generate = vi.spyOn(ports, "generate");
    const service = new AutomaticThreadTitleService(ports);
    const candidate = service.prepare({
      userId: 3,
      host,
      threadId: "thread-4",
      message: "analyze this month's revenue trend and explain anomalies",
      model: null,
    });
    expect(candidate).not.toBeNull();

    await service.start(candidate!);

    expect(renameAndProject).toHaveBeenCalledWith(candidate, "analyze this month's revenue trend");
    expect(generate).not.toHaveBeenCalled();
  });

  it("retains the fallback when Provider generation fails", async () => {
    const warn = vi.fn();
    const { ports, renameAndProject } = portsFixture({
      generate: async () => {
        throw new Error("provider unavailable");
      },
      warn,
    });
    const service = new AutomaticThreadTitleService(ports);
    const candidate = service.prepare({
      userId: 3,
      host,
      threadId: "thread-5",
      message: "分析本月营业额",
      model: "model-1",
    });
    expect(candidate).not.toBeNull();

    await service.start(candidate!);

    expect(renameAndProject).toHaveBeenCalledOnce();
    expect(renameAndProject).toHaveBeenCalledWith(candidate, "分析本月营业额");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: "provider unavailable" }));
  });
});

function portsFixture(overrides: Partial<AutomaticThreadTitlePorts> = {}) {
  const state = { eligible: true, name: null as string | null, hasUserMessage: false };
  const renameAndProject = vi.fn(async (_candidate: FirstPromptTitleCandidate, title: string) => {
    state.name = title;
  });
  const ports: AutomaticThreadTitlePorts = {
    inspect: () => state,
    generate: async () => "月度营业额分析",
    renameAndProject,
    runForUser: (_userId, callback) => callback(),
    warn: vi.fn(),
    ...overrides,
  };
  return { ports, renameAndProject };
}
