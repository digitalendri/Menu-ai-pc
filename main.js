const { app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray, globalShortcut, nativeImage, dialog } = require("electron");
const path = require("path");
const { comboFromInput, toAccelerator } = require("./keys");

// Situs seperti Google menolak browser yang mengaku "Electron", jadi pakai UA Chrome biasa.
app.userAgentFallback =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
  process.versions.chrome + " Safari/537.36";

const ICON_PATH = path.join(__dirname, "icon.png");

let win = null;
let tray = null;
let trayOk = false;         // true kalau ikon tray berhasil dibuat
let quitting = false;          // true hanya kalau aplikasi benar-benar mau ditutup
let updateReady = null;        // nomor versi yang sudah diunduh dan siap dipasang
let forwardCombos = new Set(); // pintasan dari index.html yang harus tetap jalan saat mengetik di jendela AI
let globalAccel = null;        // pintasan global yang sedang terpasang
const views = new Map();
let seq = 0;

// ---------- Jendela ----------
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 700, minHeight: 500,
    title: "Menu AI", autoHideMenuBar: true, icon: ICON_PATH,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile("index.html");
  // Tombol tutup (X) hanya menyembunyikan jendela ke tray. Keluar sungguhan lewat menu tray.
  // Kalau ikon tray gagal dibuat, jendela tidak disembunyikan supaya aplikasi tidak "hilang" tanpa jalan kembali.
  win.on("close", (e) => {
    if (!quitting && trayOk) { e.preventDefault(); win.hide(); }
  });
  win.on("closed", () => { win = null; views.clear(); });
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win && win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide();
  else showWindow();
}

function quit() {
  quitting = true;
  app.quit();
}

function sendToUI(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ---------- Jendela AI ----------
const box = (a) => ({
  x: Math.round(a.x), y: Math.round(a.y),
  width: Math.max(1, Math.round(a.width)), height: Math.max(1, Math.round(a.height)),
});

// Item bertanda "menuai-profile:<id>" dapat penyimpanan login sendiri; lainnya berbagi satu.
function partitionOf(title) {
  const m = /^menuai-profile:(.+)$/.exec(title || "");
  return "persist:menuai_" + (m ? m[1].replace(/[^A-Za-z0-9_]/g, "_") : "shared");
}

const ops = {
  openWebView(a) {
    const v = new WebContentsView({ webPreferences: { partition: partitionOf(a.title), contextIsolation: true } });
    const id = "v" + (++seq);
    views.set(id, v);
    v.setBounds(box(a));
    win.contentView.addChildView(v);
    v.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } }));
    // Tombol yang ditekan di dalam jendela AI tidak sampai ke index.html, jadi pintasan yang
    // terdaftar dicegat di sini lalu diteruskan ke menu aplikasi.
    v.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      const c = comboFromInput(input);
      if (c && forwardCombos.has(c)) {
        event.preventDefault();
        sendToUI("key", c);
      }
    });
    v.webContents.loadURL(a.url).catch(() => {});
    return { id };
  },
  hide(a) { const v = views.get(a.id); if (v) v.setVisible(false); },
  show(a) { const v = views.get(a.id); if (v) v.setVisible(true); },
  close(a) {
    const v = views.get(a.id);
    if (!v) return;
    try { if (win) win.contentView.removeChildView(v); v.webContents.close(); } catch (e) {}
    views.delete(a.id);
  },
  reload(a) { const v = views.get(a.id); if (v) v.webContents.reload(); },
  updateDimensions(a) { const v = views.get(a.id); if (v) v.setBounds(box(a)); },
  executeScript(a) {
    const v = views.get(a.id);
    return v ? v.webContents.executeJavaScript(a.code).then(() => null) : null;
  },
};

ipcMain.handle("ib", (e, { m, a }) => {
  if (!ops[m]) throw new Error("Perintah tidak dikenal: " + m);
  return ops[m](a || {});
});

// Daftar pintasan dari index.html yang harus ikut bekerja saat fokus ada di jendela AI.
ipcMain.handle("keys", (e, a) => {
  const list = a && Array.isArray(a.combos) ? a.combos : [];
  forwardCombos = new Set(list.filter((c) => typeof c === "string").slice(0, 200));
  return true;
});

// ---------- Pintasan global ----------
function setGlobalKey(combo) {
  if (globalAccel) {
    try { globalShortcut.unregister(globalAccel); } catch (e) {}
    globalAccel = null;
  }
  if (!combo) return { ok: true, empty: true };
  const accel = toAccelerator(combo);
  if (!accel) return { ok: false, reason: "format" };
  try {
    if (!globalShortcut.register(accel, toggleWindow)) return { ok: false, reason: "dipakai" };
    globalAccel = accel;
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "format" };
  }
}
ipcMain.handle("gkey", (e, a) => setGlobalKey(a && a.combo));

// ---------- Tray ----------
function refreshTray() {
  if (!tray) return;
  const items = [{ label: "Buka Menu AI", click: showWindow }];
  if (updateReady) items.push({ label: "Pasang pembaruan v" + updateReady + " dan mulai ulang", click: installUpdate });
  else items.push({ label: "Periksa pembaruan", click: () => checkUpdates(true) });
  items.push({ type: "separator" }, { label: "Keluar", click: quit });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip("Menu AI");
  tray.on("click", showWindow);
  trayOk = true;
  refreshTray();
}

// ---------- Pembaruan otomatis (GitHub Releases) ----------
let autoUpdater = null;
let manualCheck = false;

function msg(options) {
  const parent = win && !win.isDestroyed() && win.isVisible() ? win : null;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function installUpdate() {
  if (!autoUpdater) return;
  quitting = true; // supaya jendela tidak hanya disembunyikan ke tray saat dipasang
  autoUpdater.quitAndInstall(true, true);
}

function checkUpdates(manual) {
  if (!autoUpdater) {
    if (manual) msg({ type: "info", title: "Menu AI", message: "Pembaruan otomatis hanya aktif di aplikasi yang sudah dipasang (bukan mode pengembangan)." });
    return;
  }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {});
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    if (manualCheck) msg({ type: "info", title: "Menu AI", message: "Versi " + info.version + " ditemukan.", detail: "Sedang diunduh di latar belakang. Kamu akan diberi tahu kalau sudah siap." });
    manualCheck = false;
  });
  autoUpdater.on("update-not-available", () => {
    if (manualCheck) msg({ type: "info", title: "Menu AI", message: "Kamu sudah memakai versi terbaru (v" + app.getVersion() + ")." });
    manualCheck = false;
  });
  autoUpdater.on("error", () => {
    if (manualCheck) msg({ type: "warning", title: "Menu AI", message: "Tidak bisa memeriksa pembaruan.", detail: "Periksa koneksi internet, lalu coba lagi." });
    manualCheck = false;
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = info.version;
    refreshTray();
    msg({
      type: "question", title: "Menu AI", buttons: ["Perbarui sekarang", "Nanti"], defaultId: 0, cancelId: 1,
      message: "Versi " + info.version + " siap dipasang.",
      detail: "Aplikasi akan tertutup sebentar lalu terbuka lagi. Kalau memilih Nanti, pembaruan dipasang otomatis saat kamu keluar dari aplikasi.",
    }).then((r) => { if (r.response === 0) installUpdate(); });
  });

  setTimeout(() => checkUpdates(false), 8000);
  setInterval(() => checkUpdates(false), 4 * 60 * 60 * 1000);
}

// ---------- Mulai ----------
// Hanya satu salinan aplikasi yang boleh jalan. Membuka yang kedua memunculkan jendela yang sudah ada.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(() => {
    createWindow();
    try { createTray(); } catch (e) { tray = null; trayOk = false; }
    setupUpdater();
  });
}

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });
// Aplikasi tetap hidup di tray walau jendela disembunyikan; berhenti hanya kalau memang diminta keluar.
app.on("window-all-closed", () => { if (quitting) app.quit(); });
