const { app, BrowserWindow, WebContentsView, ipcMain, Menu } = require("electron");
const path = require("path");

// Situs seperti Google menolak browser yang mengaku "Electron", jadi pakai UA Chrome biasa.
app.userAgentFallback =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
  process.versions.chrome + " Safari/537.36";

let win = null;
const views = new Map();
let seq = 0;

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 700, minHeight: 500,
    title: "Menu AI", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile("index.html");
  win.on("closed", () => { win = null; views.clear(); });
}

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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
