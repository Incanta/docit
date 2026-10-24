// Lets non-React code (slash menu items) open the editor AI menu.

const OPEN_EVENT = "docit:open-ai-menu";
let available = false;

export function setEditorAiAvailable(value: boolean) {
  available = value;
}

export function isEditorAiAvailable() {
  return available;
}

export function openEditorAiMenu() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function onOpenEditorAiMenu(handler: () => void) {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
