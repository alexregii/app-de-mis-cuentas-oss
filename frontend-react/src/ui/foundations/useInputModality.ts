import {useEffect, useRef} from "react";
// Deliberately co-located: this CSS is loaded only when the hook is used.
// Keep it out of ui-system.css so it cannot be bundled twice.
import "./input-modality.css";

const navigationKeys = new Set(["Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "]);

function isEditing(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const editor = target.closest("input, textarea, [contenteditable]");
  if (editor instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(editor.type);
  }
  return editor instanceof HTMLTextAreaElement || (editor?.hasAttribute("contenteditable") && editor.getAttribute("contenteditable") !== "false");
}

/** One boundary for all controls; focus() keeps the initiating input modality. */
export function useInputModality<T extends HTMLElement = HTMLElement>() {
  const rootRef = useRef<T>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hadClass = root.classList.contains("ui-input-modality");
    root.classList.add("ui-input-modality");
    const pointer = () => { root.dataset.inputModality = "pointer"; };
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.metaKey || event.altKey || event.ctrlKey) return;
      if (!navigationKeys.has(event.key)) return;
      // Editing (including caret movement and virtual-keyboard Enter) retains
      // the modality that brought focus here. Tab/Escape leave that context.
      if (isEditing(event.target) && event.key !== "Tab" && event.key !== "Escape") return;
      root.dataset.inputModality = "keyboard";
    };
    // Assistive technology can activate controls without pointer/keyboard events.
    const activate = (event: MouseEvent) => {
      if (event.detail === 0) root.dataset.inputModality = "keyboard";
    };
    const reset = () => { delete root.dataset.inputModality; };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("click", activate, true);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("click", activate, true);
      window.removeEventListener("blur", reset);
      reset();
      if (!hadClass) root.classList.remove("ui-input-modality");
    };
  }, []);
  return rootRef;
}
