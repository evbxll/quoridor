import { describe, expect, it } from "vitest";
import { describeNetwork } from "../../src/ui/networkText";

describe("the network chip and its popover", () => {
  it("say the network is ready without naming the model's file id", () => {
    const fresh = describeNetwork({ status: "ready", model: "s9-conv-paths-g105", fromCache: false, saved: true }, 9);
    expect(fresh.line).toBe("Network: ready.");
    expect(describeNetwork({ status: "ready", model: "s9-conv-paths-g105", fromCache: true, saved: false }, 9).line).toBe("Network: ready, loaded from this device. It could not be saved for offline use.");
  });
});
