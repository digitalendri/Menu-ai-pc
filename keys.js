// Fungsi kecil untuk pintasan keyboard. Dipakai main.js dan dipisah supaya mudah diuji.

const MOD_CODE = /^(Control|Shift|Alt|Meta|OS)(Left|Right)$|^AltGraph$/;

// Bentuknya sama dengan comboOf() di index.html: "Ctrl+Alt+Shift+Meta+<kode tombol>".
function comboFromInput(input) {
  const c = input && input.code;
  if (!c || c === "Unidentified" || MOD_CODE.test(c)) return null;
  const p = [];
  if (input.control) p.push("Ctrl");
  if (input.alt) p.push("Alt");
  if (input.shift) p.push("Shift");
  if (input.meta) p.push("Meta");
  p.push(c);
  return p.join("+");
}

const PUNCT = {
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backquote: "`",
};
const NAMED = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  Escape: "Escape", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
};
const MODS = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Super" };

// Mengubah "Ctrl+Alt+KeyM" menjadi format Electron "Ctrl+Alt+M". Mengembalikan null kalau tidak didukung.
function toAccelerator(combo) {
  if (typeof combo !== "string" || !combo) return null;
  const parts = combo.split("+");
  const code = parts.pop();
  if (!parts.length) return null; // pintasan global wajib memakai modifier
  const mods = [];
  for (const m of parts) {
    if (!MODS[m]) return null;
    mods.push(MODS[m]);
  }
  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit([0-9])$/.exec(code))) key = m[1];
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (PUNCT[code]) key = PUNCT[code];
  else if (NAMED[code]) key = NAMED[code];
  if (!key) return null;
  return mods.concat(key).join("+");
}

module.exports = { comboFromInput, toAccelerator };
