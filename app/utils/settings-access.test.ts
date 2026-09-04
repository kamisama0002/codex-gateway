import { describe, expect, it } from "vitest";
import { settingsPanelsForUser } from "./settings-access";

const allPanels = [
  "appearance",
  "pet",
  "providers",
  "runtime",
  "hosts",
  "notifications",
  "config",
];

describe("settingsPanelsForUser", () => {
  it("keeps only personal settings and the user's runtime for ordinary DataOps users", () => {
    expect(
      settingsPanelsForUser({
        id: 7,
        username: "operator",
        role: "user",
        dataOps: {
          provider: "dataops",
          externalSubject: "dataops:1:7",
          tenantId: 1,
          dataOpsUserId: 7,
          projectId: 4,
          authzVersion: 1,
        },
      }),
    ).toEqual(["appearance", "pet", "runtime", "notifications"]);
  });

  it("keeps all settings for DataOps administrators and standalone users", () => {
    expect(
      settingsPanelsForUser({
        id: 1,
        username: "admin",
        role: "admin",
        dataOps: {
          provider: "dataops",
          externalSubject: "dataops:1:1",
          tenantId: 1,
          dataOpsUserId: 1,
          projectId: 4,
          authzVersion: 1,
        },
      }),
    ).toEqual(allPanels);
    expect(settingsPanelsForUser({ id: 8, username: "standalone", role: "user" })).toEqual(
      allPanels,
    );
  });
});
