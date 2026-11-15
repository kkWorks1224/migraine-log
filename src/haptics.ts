// Android: Vibration API / iOS 18+: <input type="checkbox" switch> のトグルで Taptic Engine を鳴らす
let label: HTMLLabelElement | null = null;

function ensureSwitch() {
  if (label) return label;
  label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

export function haptic(kind: "light" | "medium" | "success" = "light") {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === "success" ? [10, 40, 14] : kind === "medium" ? 14 : 8);
      return;
    }
    if (/iP(hone|ad|od)/.test(navigator.userAgent)) ensureSwitch().click();
  } catch {}
}
