/** Speaks to screen readers through the live region: the same sentence twice in a row still changes the text, so it is read again. */
export function liveAnnouncer(live: HTMLElement): (text: string) => void {
  return (text) => {
    live.textContent = text === live.textContent ? `${text} ` : text;
  };
}
