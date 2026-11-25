// A light tap from the phone, for moments that change something: an RSVP, a
// like, letting go of a pull-to-refresh. Call it from a tap or touch handler;
// phones ignore it outside one.
//
// Android has navigator.vibrate. iPhone doesn't, but since iOS 18 Safari
// plays the system tap whenever a <input type="checkbox" switch> is toggled,
// so we toggle a hidden one. Anywhere else it does nothing.

export function haptic() {
  if (typeof window === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
    return;
  }
  if (!/iPhone|iPad/.test(navigator.userAgent)) return;

  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.append(input);
  document.body.append(label);
  label.click();
  label.remove();
}
