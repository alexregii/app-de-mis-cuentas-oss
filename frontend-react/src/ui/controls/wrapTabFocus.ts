export function wrapTabFocus(event: KeyboardEvent, focusable: readonly HTMLElement[], preventScroll = false) {
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const focus = (element: HTMLElement) => element.focus({preventScroll});
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focus(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focus(first);
  }
}
