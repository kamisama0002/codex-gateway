import { describe, expect, it } from "vitest";
import { titleForThread } from "../../app/stores/gateway/thread-utils/identity";

const localizedFallbacks = {
  empty: "新会话",
  untitled: "未命名会话",
};

describe("thread display identity", () => {
  it("uses the empty-thread label instead of exposing an internal id", () => {
    const thread = {
      id: "01a067f4-9f0a-7961-93f5-a824064e3380",
      title: null,
      name: null,
      preview: "",
      turns: [],
    };

    expect(
      titleForThread(thread, localizedFallbacks, {
        thread: { turns: [] },
      }),
    ).toBe("新会话");
  });

  it("uses the untitled label for a non-empty thread without a user message", () => {
    const thread = {
      id: "01a067f4-9f0a-7961-93f5-a824064e3380",
      title: null,
      name: null,
      preview: "",
      turns: [{ id: "turn-1" }],
    };

    expect(
      titleForThread(thread, localizedFallbacks, {
        thread: { turns: [{ id: "turn-1" }] },
      }),
    ).toBe("未命名会话");
  });

  it("derives a temporary title from the first user message", () => {
    const thread = {
      id: "thread-with-message",
      title: null,
      name: null,
      preview: "",
    };

    expect(
      titleForThread(thread, localizedFallbacks, {
        thread: {
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "  分析本月\n营业额变化  " }],
                },
              ],
            },
          ],
        },
      }),
    ).toBe("分析本月 营业额变化");
  });

  it("keeps explicit names ahead of a derived user-message title", () => {
    expect(
      titleForThread({ id: "named-thread", name: "月度经营分析" }, localizedFallbacks, {
        thread: {
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  content: [{ type: "text", text: "分析本月营业额变化" }],
                },
              ],
            },
          ],
        },
      }),
    ).toBe("月度经营分析");
  });

  it("limits long derived titles", () => {
    const longMessage = "长".repeat(50);

    expect(
      titleForThread(
        { id: "long-title", title: null, name: null, preview: "" },
        localizedFallbacks,
        {
          thread: {
            turns: [
              {
                items: [
                  {
                    type: "userMessage",
                    content: [{ type: "text", text: longMessage }],
                  },
                ],
              },
            ],
          },
        },
      ),
    ).toBe(`${"长".repeat(36)}...`);
  });

  it("does not treat metadata-only list turns as proof that a thread is empty", () => {
    const thread = {
      id: "01a067f4-9f0a-7961-93f5-a824064e3380",
      title: null,
      name: null,
      preview: "",
      turns: [],
    };

    expect(titleForThread(thread, localizedFallbacks)).toBe("未命名会话");
  });

  it.each(["01a067f4-9f0a-7961-93f5-a824064e3380", "Untitled"])(
    "ignores the legacy derived title %s",
    (legacyTitle) => {
      const threadId = "01a067f4-9f0a-7961-93f5-a824064e3380";

      expect(
        titleForThread(
          { threadId, title: legacyTitle, name: null, preview: "" },
          localizedFallbacks,
          { thread: { turns: [] } },
        ),
      ).toBe("新会话");
    },
  );
});
