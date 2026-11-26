const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("menuaiDesktop", {
  invoke: (channel, arg) => ipcRenderer.invoke(channel, arg),
});
