import { describe, expect, it } from "vitest";
import { describeNetwork } from "../../src/ui/networkText";

describe("the network chip and its popover", () => {
  it("say the network is ready without naming the model's file id", () => {
    const fresh = describeNetwork({ status: "ready", model: "test-model", fromCache: false, saved: true }, 9);
    expect(fresh.line).toBe("Network: ready.");
    expect(describeNetwork({ status: "ready", model: "test-model", fromCache: true, saved: false }, 9).line).toBe("Network: ready, loaded from this device. It could not be saved for offline use.");
  });
});
