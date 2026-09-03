import { describe, expect, it } from "vitest";
import { isConnectionLevelSshError, isRetryableSshChannelOpenError } from "./ssh-errors";

describe("SSH error classification", () => {
  it("retries only the transient OpenSSH session admission failure", () => {
    expect(isRetryableSshChannelOpenError(new Error("Channel open failure: open failed"))).toBe(
      true,
    );
    expect(
      isRetryableSshChannelOpenError(
        new Error("Channel open failure: Administratively prohibited"),
      ),
    ).toBe(false);
    expect(isRetryableSshChannelOpenError(new Error("Channel open failure: Connect failed"))).toBe(
      false,
    );
  });

  it("does not mistake a channel-local rejection for a dead transport", () => {
    expect(isConnectionLevelSshError(new Error("Channel open failure: open failed"))).toBe(false);
    expect(isConnectionLevelSshError(new Error("read ECONNRESET"))).toBe(true);
  });
});
