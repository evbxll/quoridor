import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../../src/ui/autoplay";
import { CONFIRM_MS, OpenConfirm } from "../../src/ui/confirmOpen";

function setup(busy: boolean) {
  const state = { busy };
  const opened: number[] = [];
  const changes = vi.fn();
  let pending: { fn: () => void; ms: number } | null = null;
  const schedule: Schedule = (fn, ms) => {
    pending = { fn, ms };
    return () => {
      pending = null;
    };
  };
  const confirm = new OpenConfirm(() => state.busy, (id) => opened.push(id), changes, schedule);
  return { state, opened, changes, confirm, timer: () => pending };
}

describe("OpenConfirm", () => {
  it("opens at once when no game is in progress", () => {
    const { confirm, opened, changes, timer } = setup(false);
    expect(confirm.request(3)).toBe("opened");
    expect(opened).toEqual([3]);
    expect(confirm.state).toEqual({ phase: "idle" });
    expect(timer()).toBeNull();
    expect(changes).not.toHaveBeenCalled();
  });

  it("asks first when a game is in progress, and opens only after Yes", () => {
    const { confirm, opened, timer } = setup(true);
    expect(confirm.request(3)).toBe("asking");
    expect(confirm.state).toEqual({ phase: "confirming", id: 3 });
    expect(opened).toEqual([]);
    expect(timer()!.ms).toBe(CONFIRM_MS);
    confirm.confirm();
    expect(opened).toEqual([3]);
    expect(confirm.state).toEqual({ phase: "idle" });
    expect(timer()).toBeNull();
  });

  it("keeps the game on Cancel, and Yes then does nothing", () => {
    const { confirm, opened, timer } = setup(true);
    confirm.request(2);
    confirm.cancel();
    expect(confirm.state).toEqual({ phase: "idle" });
    expect(timer()).toBeNull();
    confirm.confirm();
    expect(opened).toEqual([]);
  });

  it("gives up when the time runs out", () => {
    const { confirm, opened, timer, changes } = setup(true);
    confirm.request(2);
    timer()!.fn();
    expect(confirm.state).toEqual({ phase: "idle" });
    expect(opened).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("asks about the latest row when another Open is pressed, with a fresh timer", () => {
    const { confirm, opened } = setup(true);
    confirm.request(2);
    confirm.request(5);
    expect(confirm.state).toEqual({ phase: "confirming", id: 5 });
    confirm.confirm();
    expect(opened).toEqual([5]);
  });

  it("opens at once if the game ended while the question was up and Open is pressed again", () => {
    const { confirm, opened, state } = setup(true);
    confirm.request(2);
    state.busy = false;
    expect(confirm.request(2)).toBe("opened");
    expect(opened).toEqual([2]);
    expect(confirm.state).toEqual({ phase: "idle" });
  });
});
