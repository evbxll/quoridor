/** Why a blurb is showing; it stays while any reason holds. */
export type TipReason = "hover" | "focus" | "tap";

/**
 * Which blurb is open and why. One blurb is open at a time. Pointer leave and
 * blur drop only their own reason, so a blurb opened by a tap or by focus does
 * not vanish when the mouse passes over and away.
 */
export class TipState {
  private current: string | null = null;
  private reasons = new Set<TipReason>();

  /** The open blurb's id, or null. */
  get open(): string | null {
    return this.current;
  }

  /** A reason for `id` to show. Moving to another blurb replaces the first. */
  add(id: string, reason: TipReason): void {
    if (this.current !== id) this.reasons.clear();
    this.current = id;
    this.reasons.add(reason);
  }

  /** Drops one reason of `id`; the blurb closes when none is left. A reason of a blurb that is no longer open is ignored. */
  remove(id: string, reason: TipReason): void {
    if (this.current !== id) return;
    this.reasons.delete(reason);
    if (this.reasons.size === 0) this.current = null;
  }

  /** A tap on a marker: opens its blurb, or closes it when a tap had opened it. Closing drops every reason, so the focus a tap gave does not keep it open. */
  tap(id: string): void {
    if (this.current === id && this.reasons.has("tap")) this.close();
    else this.add(id, "tap");
  }

  /** Closes whatever is open (Escape, a tap elsewhere). */
  close(): void {
    this.current = null;
    this.reasons.clear();
  }
}

/** How long a blurb stays after the pointer leaves, so crossing a gap to it does not flicker. */
const LEAVE_DELAY_MS = 150;
/** Space between a marker and its blurb, and the least space left at the viewport's edge. */
const GAP = 8;

/** Where a blurb of `size` goes beside a trigger: to its right, or its left if that does not fit, kept inside the viewport. */
export function placeTip(trigger: DOMRect, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  let left = trigger.right + GAP;
  if (left + size.width > viewport.width - GAP) left = trigger.left - GAP - size.width;
  left = Math.max(GAP, Math.min(left, viewport.width - GAP - size.width));
  const top = Math.max(GAP, Math.min(trigger.top + trigger.height / 2 - size.height / 2, viewport.height - GAP - size.height));
  return { left, top };
}

/**
 * Shows blurbs for elements marked `data-tip="<blurb id>"`. A blurb is a
 * `role="tooltip"` element the trigger already names in `aria-describedby`;
 * it stays in the document (hidden) so that description is always there.
 * It opens on mouse hover, keyboard focus and touch tap, and closes on
 * Escape, a tap elsewhere, and (after a short delay) pointer or focus leaving.
 * A blurb is descriptive only: it takes no pointer events, so the pointer
 * cannot hold it open, and a click or tap on the board under it goes through.
 */
export class Tooltips {
  private readonly state = new TipState();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A touch is down or just lifted: the focus it gives is not a reason of its own. */
  private touching = false;
  /** The element the open blurb is placed beside: the one last pointed at, focused or tapped. */
  private anchor: Element | null = null;

  constructor(private readonly doc: Document) {
    doc.addEventListener("pointerover", (event) => this.pointer(event, true));
    doc.addEventListener("pointerout", (event) => this.pointer(event, false));
    doc.addEventListener("focusin", (event) => this.focus(event, true));
    doc.addEventListener("focusout", (event) => this.focus(event, false));
    doc.addEventListener("pointerdown", (event) => this.down(event));
    doc.addEventListener("pointerup", (event) => this.up(event));
    doc.addEventListener("pointercancel", () => this.release());
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.state.open !== null) {
        this.state.close();
        this.draw();
      }
    });
    const reposition = (): void => this.draw();
    doc.defaultView?.addEventListener("resize", reposition);
    doc.addEventListener("scroll", reposition, true);
  }

  /** Draws again after the blurb's text or its trigger changed: closes a blurb whose trigger is gone, and places an open one. */
  refresh(): void {
    this.draw();
  }

  /** The trigger at or around `target` and the id of the blurb it opens. Blurbs take no pointer events, so only triggers are ever hit. */
  private tipOf(target: EventTarget | null): { id: string; trigger: Element } | null {
    const trigger = target instanceof Element ? target.closest("[data-tip]") : null;
    return trigger === null ? null : { id: trigger.getAttribute("data-tip")!, trigger };
  }

  private cancelLeave(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private pointer(event: PointerEvent, over: boolean): void {
    if (event.pointerType === "touch") return;
    const hit = this.tipOf(event.target);
    if (hit === null) return;
    this.cancelLeave();
    if (over) {
      this.anchor = hit.trigger;
      this.state.add(hit.id, "hover");
      this.draw();
    } else {
      this.timer = setTimeout(() => {
        this.state.remove(hit.id, "hover");
        this.draw();
      }, LEAVE_DELAY_MS);
    }
  }

  private focus(event: FocusEvent, into: boolean): void {
    const hit = this.tipOf(event.target);
    if (hit === null) return;
    if (into) {
      if (this.touching) return;
      this.anchor = hit.trigger;
      this.state.add(hit.id, "focus");
    } else this.state.remove(hit.id, "focus");
    this.draw();
  }

  private down(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    this.touching = true;
    if (this.tipOf(event.target) === null) {
      this.state.close();
      this.draw();
    }
  }

  private up(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      const hit = this.tipOf(event.target);
      if (hit !== null) {
        this.anchor = hit.trigger;
        this.state.tap(hit.id);
        this.draw();
      }
    }
    this.release();
  }

  private release(): void {
    // The focus a tap gives arrives with the pointer events, before this runs.
    setTimeout(() => (this.touching = false), 0);
  }

  private draw(): void {
    const open = this.state.open;
    for (const tip of this.doc.querySelectorAll<HTMLElement>('[role="tooltip"]')) {
      const trigger = this.anchor;
      const shown = tip.id === open && trigger !== null && trigger.getClientRects().length > 0 && getComputedStyle(trigger).visibility !== "hidden";
      if (!shown && tip.hidden) continue;
      tip.hidden = !shown;
      if (shown) {
        const view = this.doc.documentElement;
        const spot = placeTip(trigger.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, { width: view.clientWidth, height: view.clientHeight });
        tip.style.left = `${spot.left}px`;
        tip.style.top = `${spot.top}px`;
      }
    }
  }
}
