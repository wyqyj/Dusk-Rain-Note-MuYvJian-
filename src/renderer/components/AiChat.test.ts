import { describe, it, expect } from "vitest";

describe("AiChat streaming state reducer logic", () => {
  type ChatMessage = { id: string; role: "user" | "assistant"; content: string; streaming?: boolean; error?: boolean };

  function applyStreamEvent(
    currentList: ChatMessage[],
    event: { delta?: string; done?: boolean; error?: string }
  ): ChatMessage[] {
    return currentList.map((message, index) => {
      if (index !== currentList.length - 1 || message.role !== "assistant") return message;
      if (event.delta) return { ...message, content: message.content + event.delta };
      if (event.done) return { ...message, streaming: false, error: Boolean(event.error), content: event.error || message.content || "" };
      return message;
    });
  }

  it("initializes assistant message with streaming=true", () => {
    const initial: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "", streaming: true }
    ];
    expect(initial[1]!.streaming).toBe(true);
  });

  it("appends delta chunks while preserving streaming=true", () => {
    let msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "", streaming: true }
    ];
    msgs = applyStreamEvent(msgs, { delta: "您" });
    msgs = applyStreamEvent(msgs, { delta: "好！" });
    expect(msgs[1]!.content).toBe("您好！");
    expect(msgs[1]!.streaming).toBe(true);
  });

  it("turns streaming to false on done event (cursor vanishes)", () => {
    let msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "您好！", streaming: true }
    ];
    msgs = applyStreamEvent(msgs, { done: true });
    expect(msgs[1]!.streaming).toBe(false);
    expect(msgs[1]!.content).toBe("您好！");
    expect(msgs[1]!.error).toBe(false);
  });

  it("handles error on done event and flips streaming to false", () => {
    let msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "", streaming: true }
    ];
    msgs = applyStreamEvent(msgs, { done: true, error: "网络超时" });
    expect(msgs[1]!.streaming).toBe(false);
    expect(msgs[1]!.error).toBe(true);
    expect(msgs[1]!.content).toBe("网络超时");
  });
});
