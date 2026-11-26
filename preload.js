const { contextBridge, ipcRenderer } = require("electron");

// Hanya saluran yang dikenal yang boleh dipakai halaman.
const INVOKE = new Set(["ib", "keys", "gkey"]);
const ON = new Set(["key"]);

contextBridge.exposeInMainWorld("menuaiDesktop", {
  invoke: (channel, arg) => {
    if (!INVOKE.has(channel)) return Promise.reject(new Error("Saluran tidak diizinkan: " + channel));
    return ipcRenderer.invoke(channel, arg);
  },
  on: (channel, cb) => {
    if (!ON.has(channel) || typeof cb !== "function") return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
