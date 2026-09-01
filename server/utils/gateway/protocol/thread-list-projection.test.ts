import { describe, expect, it } from "vitest";
import type { AppServerThread, ProjectRecord } from "~~/shared/types";
import { projectGatewayThreadsForList } from "./thread-list-projection";

describe("projectGatewayThreadsForList", () => {
  const project: ProjectRecord = {
    id: 7,
    hostId: 1,
    name: "demo",
    remotePath: "/tmp/demo",
    createdAt: "",
    updatedAt: "",
  };

  it("overlays an open snapshot onto the active list when app-server has not materialized it yet", () => {
    const cached = appServerThread("thread-open", "Fresh");
    const threads = projectGatewayThreadsForList({
      hostId: 1,
      remoteThreads: [],
      cachedThreads: [cached],
      indexedThreads: [{ id: cached.id, projectId: project.id, cwd: cached.cwd }],
      projects: [project],
      searchTerm: null,
      archived: false,
    });

    expect(threads.map((thread) => thread.id)).toEqual(["thread-open"]);
    expect(threads[0]?.projectId).toBe(7);
  });

  it("keeps a started thread on its Gateway project when app-server cwd has not caught up", () => {
    const other: ProjectRecord = { ...project, id: 9, name: "other", remotePath: "/tmp/other" };
    const cached = appServerThread("thread-open", "Fresh", "/tmp/other");
    const threads = projectGatewayThreadsForList({
      hostId: 1,
      remoteThreads: [],
      cachedThreads: [cached],
      indexedThreads: [{ id: cached.id, projectId: project.id, cwd: cached.cwd }],
      projects: [project, other],
      projectId: project.id,
      searchTerm: null,
      archived: false,
    });

    expect(threads.map((thread) => thread.id)).toEqual(["thread-open"]);
    expect(threads[0]?.projectId).toBe(7);
  });

  it("does not list a remote thread under a project when metadata binds it elsewhere", () => {
    const other: ProjectRecord = { ...project, id: 9, name: "other", remotePath: "/tmp/other" };
    const remote = appServerThread("thread-drift", "Drifted", project.remotePath);
    const threads = projectGatewayThreadsForList({
      hostId: 1,
      remoteThreads: [remote],
      cachedThreads: [],
      indexedThreads: [{ id: remote.id, projectId: other.id, cwd: remote.cwd }],
      projects: [project, other],
      projectId: project.id,
      searchTerm: null,
      archived: false,
    });

    expect(threads).toEqual([]);
  });

  it("does not overlay open snapshots onto an archived listing", () => {
    const activeSnapshot = appServerThread("thread-open", "Still open");
    const archivedRemote = appServerThread("thread-archived", "Archived");
    const threads = projectGatewayThreadsForList({
      hostId: 1,
      remoteThreads: [archivedRemote],
      cachedThreads: [activeSnapshot],
      indexedThreads: [
        { id: activeSnapshot.id, projectId: project.id, cwd: activeSnapshot.cwd },
        { id: archivedRemote.id, projectId: project.id, cwd: archivedRemote.cwd },
      ],
      projects: [project],
      searchTerm: null,
      archived: true,
    });

    expect(threads.map((thread) => thread.id)).toEqual(["thread-archived"]);
  });
});

function appServerThread(id: string, name: string, cwd = "/tmp/demo"): AppServerThread {
  const now = 1_700_000_000;
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: name,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "test",
    createdAt: now,
    updatedAt: now,
    recencyAt: now,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "0.151.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
