const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInitialData: () => ipcRenderer.invoke('get-initial-data'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  saveSteps: (s) => ipcRenderer.invoke('save-steps', s),
  pickStorageFolder: () => ipcRenderer.invoke('pick-storage-folder'),
  registerHotkeys: (h) => ipcRenderer.invoke('register-hotkeys', h),
  getDefaultHotkeys: () => ipcRenderer.invoke('get-default-hotkeys'),
  setClickThrough: (v) => ipcRenderer.invoke('set-click-through', v),
  saveOverlayPosition: (p) => ipcRenderer.invoke('save-overlay-position', p),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  importSteps: () => ipcRenderer.invoke('import-steps'),
  exportSteps: () => ipcRenderer.invoke('export-steps'),
  setOverlayVisible: (v) => ipcRenderer.invoke('set-overlay-visible', v),
  setOverlayMode: (mode) => ipcRenderer.invoke('set-overlay-mode', mode),
  startPresentation: () => ipcRenderer.invoke('start-presentation'),
  setOverlayCollapsed: (v) => ipcRenderer.invoke('set-overlay-collapsed', v),
  getOverlayBounds: () => ipcRenderer.invoke('get-overlay-bounds'),
  setOverlayBounds: (bounds) => ipcRenderer.invoke('set-overlay-bounds', bounds),
  fitOverlayContent: (height) => ipcRenderer.invoke('fit-overlay-content', height),
  focusEditor: () => ipcRenderer.invoke('focus-editor'),
  broadcastState: (state) => ipcRenderer.invoke('broadcast-state', state),
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (e, state) => cb(state)),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (e, name) => cb(name))
});
