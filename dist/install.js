/** Installation is optional; media access never depends on the prompt. */
export function isInstalled(environment = window) {
  return Boolean(
    environment.matchMedia?.("(display-mode: standalone)").matches ||
      environment.navigator?.standalone,
  );
}
export function isAppleMobile(nav = navigator) {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  );
}
let pendingPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingPrompt = event;
  window.dispatchEvent(new Event("pocket-install-change"));
});
window.addEventListener("appinstalled", () => {
  pendingPrompt = null;
  window.dispatchEvent(new Event("pocket-install-change"));
});
export async function promptInstall() {
  if (!pendingPrompt) return null;
  const prompt = pendingPrompt;
  pendingPrompt = null;
  await prompt.prompt();
  return (await prompt.userChoice).outcome;
}
export function canPromptInstall() {
  return Boolean(pendingPrompt);
}
