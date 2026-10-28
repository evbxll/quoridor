import { HUMAN, type Players } from "./controller";

/** What the page knows besides the seats that decides which controls show. */
export interface VisibilityState {
  /** A network is published (or not yet known not to be). */
  readonly networkPublished: boolean;
  /** The viewer left "Show evaluation" on. */
  readonly showEvaluation: boolean;
  /** The game on the board has ended. */
  readonly gameOver: boolean;
}

/** Which controls the page shows for the current seats. */
export interface Visible {
  /** The "How to move" help: someone has to move by hand. */
  readonly howToMove: boolean;
  /** Undo takes back a person's move, so it needs a person. */
  readonly undo: boolean;
  /** Start, Pause, Resume, Step and Speed drive a game between two bots. */
  readonly botControls: boolean;
  /** Start cannot begin or continue a game that has ended. */
  readonly startBlocked: boolean;
  /** The "Show evaluation" checkbox: only a person has a reason to hide the bar; two bots always show it. */
  readonly evaluationToggle: boolean;
  /** The evaluation bar beside the board. */
  readonly evalBar: boolean;
  /** The Analysis checkbox; without a network a note takes its place. */
  readonly analysis: boolean;
}

/** Derives the visible controls from the seats and the page state, so the rules live in one place. */
export function visibleControls(players: Players, state: VisibilityState): Visible {
  const person = players.p1 === HUMAN || players.p2 === HUMAN;
  return {
    howToMove: person,
    undo: person,
    botControls: !person,
    startBlocked: !person && state.gameOver,
    evaluationToggle: person && state.networkPublished,
    evalBar: state.networkPublished && (!person || state.showEvaluation),
    analysis: state.networkPublished,
  };
}
