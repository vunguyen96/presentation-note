const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const APP_NAME = 'Presentation Note';
const DEFAULT_DIR = path.join(os.homedir(), 'Documents', APP_NAME);
const LEGACY_DIR = path.join(os.homedir(), 'Documents', 'Step View');
const STEPS_FILE = 'steps.json';
const SETTINGS_FILE = 'settings.json';

app.setAppUserModelId('com.vna.presentationnote');

let editorWindow = null;
let overlayWindow = null;
let collapsedWindow = null;
let settings = {};
let stepsData = { meta: { appName: APP_NAME, version: '0.1.0' }, presentations: [] };
let positionSaveTimer = null;
let overlayCollapsed = false;
let expandedOverlayBounds = { x: 0, y: 0, width: 420, height: 300 };
let activeOverlayMode = 'presentation';
let presentationOverlayBounds = { x: 0, y: 0, width: 420, height: 300 };
const overlayModeSizes = {
  presentation: { width: 420, height: 300 },
  agenda: { width: 420, height: 360 }
};

function ensureDefaultFolder() {
  if (!fs.existsSync(DEFAULT_DIR) && fs.existsSync(LEGACY_DIR)) fs.copySync(LEGACY_DIR, DEFAULT_DIR);
  fs.ensureDirSync(DEFAULT_DIR);
  if (fs.existsSync(LEGACY_DIR)) {
    for (const file of [SETTINGS_FILE, STEPS_FILE]) {
      const destination = path.join(DEFAULT_DIR, file);
      const source = path.join(LEGACY_DIR, file);
      if (!fs.existsSync(destination) && fs.existsSync(source)) fs.copyFileSync(source, destination);
    }
  }
  const settingsPath = path.join(DEFAULT_DIR, SETTINGS_FILE);
  if (fs.existsSync(settingsPath)) {
    try { settings = fs.readJsonSync(settingsPath); } catch (e) { settings = {}; }
  } else {
    settings = { storagePath: DEFAULT_DIR, theme: 'dark', hotkeys: {}, positions: {}, overlayOpacity: 70, collapsedCorner: 'top-right' };
    fs.writeJsonSync(settingsPath, settings, { spaces: 2 });
  }
  if (settings.storagePath === LEGACY_DIR) settings.storagePath = DEFAULT_DIR;
  const opacity = Number(settings.overlayOpacity);
  settings.overlayOpacity = Number.isFinite(opacity) ? Math.min(100, Math.max(20, opacity)) : 70;
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(settings.collapsedCorner)) settings.collapsedCorner = 'top-right';
  saveSettings();
  const storagePath = settings.storagePath || DEFAULT_DIR;
  fs.ensureDirSync(storagePath);
  const stepsPath = path.join(storagePath, STEPS_FILE);
  if (fs.existsSync(stepsPath)) {
    try { stepsData = normalizeStepsData(fs.readJsonSync(stepsPath)); } catch (e) { stepsData = normalizeStepsData({}); }
  } else {
    const samplePath = path.join(__dirname, 'src', 'sample_steps.json');
    if (fs.existsSync(samplePath)) stepsData = normalizeStepsData(fs.readJsonSync(samplePath));
    fs.writeJsonSync(stepsPath, stepsData, { spaces: 2 });
  }
}

function normalizeStepsData(data) {
  if (data && Array.isArray(data.presentations)) {
    const presentations = data.presentations.map((presentation, presentationIndex) => ({
      id: presentation.id || `presentation-${presentationIndex + 1}`,
      title: presentation.title || `Presentation ${presentationIndex + 1}`,
      cases: Array.isArray(presentation.cases) ? presentation.cases.map((caseData, caseIndex) => ({
        id: caseData.id || `case-${presentationIndex + 1}-${caseIndex + 1}`,
        title: caseData.title || `Case ${caseIndex + 1}`,
        steps: Array.isArray(caseData.steps) ? caseData.steps : []
      })) : []
    }));
    if (!presentations.length) presentations.push(makeDefaultPresentation());
    presentations.forEach((presentation, index) => {
      if (!presentation.cases.length) presentation.cases.push(makeDefaultCase(index));
    });
    return { meta: { ...(data.meta || {}), appName: APP_NAME }, presentations };
  }

  const legacySteps = data && Array.isArray(data.steps) ? data.steps : [];
  return {
    meta: { ...(data && data.meta || {}), appName: APP_NAME },
    presentations: [{ ...makeDefaultPresentation(), cases: [{ ...makeDefaultCase(0), steps: legacySteps }] }]
  };
}

function makeDefaultPresentation() {
  return { id: `presentation-${Date.now()}`, title: 'Presentation 1', cases: [] };
}

function makeDefaultCase(index) {
  return { id: `case-${Date.now()}-${index}`, title: 'Case 1', steps: [] };
}

function saveSettings() {
  const settingsPath = path.join(DEFAULT_DIR, SETTINGS_FILE);
  fs.writeJsonSync(settingsPath, settings, { spaces: 2 });
}

function saveSteps() {
  const stepsPath = path.join(settings.storagePath || DEFAULT_DIR, STEPS_FILE);
  fs.writeJsonSync(stepsPath, stepsData, { spaces: 2 });
}

function createEditorWindow() {
  editorWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 620,
    icon: path.join(__dirname, 'assets', 'presentation-note.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  editorWindow.loadFile(path.join(__dirname, 'index.html'));
  editorWindow.on('close', (e) => {
    const choice = require('electron').dialog.showMessageBoxSync(editorWindow, {
      type: 'question',
      buttons: ['Cancel', 'Quit'],
      defaultId: 1,
      message: 'Are you sure you want to quit Presentation Note?'
    });
    if (choice === 0) e.preventDefault();
  });
  editorWindow.on('closed', () => {
    editorWindow = null;
    if (overlayWindow) overlayWindow.close();
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 420, height: 300, minWidth: 300, minHeight: 200, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  const savedPosition = settings.positions && settings.positions[screen.getPrimaryDisplay().id];
  if (savedPosition) overlayWindow.setPosition(savedPosition.x, savedPosition.y);
  expandedOverlayBounds = overlayWindow.getBounds();
  presentationOverlayBounds = expandedOverlayBounds;
  overlayModeSizes.presentation = { width: expandedOverlayBounds.width, height: expandedOverlayBounds.height };
  overlayWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'overlay' } });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.on('move', () => {
    const bounds = overlayWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    settings.positions = settings.positions || {};
    if (!overlayCollapsed && activeOverlayMode === 'presentation') {
      expandedOverlayBounds = bounds;
      presentationOverlayBounds = bounds;
      settings.positions[display.id] = { x: bounds.x, y: bounds.y };
      clearTimeout(positionSaveTimer);
      positionSaveTimer = setTimeout(saveSettings, 250);
    }
  });
  overlayWindow.on('resize', () => {
    if (!overlayCollapsed && activeOverlayMode === 'presentation') {
      expandedOverlayBounds = overlayWindow.getBounds();
      presentationOverlayBounds = expandedOverlayBounds;
      overlayModeSizes[activeOverlayMode] = { width: expandedOverlayBounds.width, height: expandedOverlayBounds.height };
    }
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

app.whenReady().then(() => {
  ensureDefaultFolder();
  createEditorWindow();
  createOverlayWindow();
  registerDefaultHotkeys();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createEditorWindow(); createOverlayWindow(); }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('get-initial-data', () => {
  return { settings, stepsData };
});

ipcMain.handle('save-settings', (event, newSettings) => {
  const previousPath = settings.storagePath || DEFAULT_DIR;
  settings = { ...settings, ...newSettings };
  const opacity = Number(settings.overlayOpacity);
  settings.overlayOpacity = Number.isFinite(opacity) ? Math.min(100, Math.max(20, opacity)) : 70;
  const nextPath = settings.storagePath || DEFAULT_DIR;
  fs.ensureDirSync(nextPath);
  if (nextPath !== previousPath) {
    const destination = path.join(nextPath, STEPS_FILE);
    if (!fs.existsSync(destination)) fs.copyFileSync(path.join(previousPath, STEPS_FILE), destination);
  }
  saveSettings();
  broadcastState(event.sender, { settings });
  return settings;
});

ipcMain.handle('save-steps', (event, newSteps) => {
  stepsData = normalizeStepsData(newSteps);
  saveSteps();
  broadcastState(event.sender, { stepsData });
  return { ok: true };
});

ipcMain.handle('pick-storage-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled) return null;
  return res.filePaths[0];
});

ipcMain.handle('register-hotkeys', (event, hotkeys) => {
  globalShortcut.unregisterAll();
  Object.entries(hotkeys || {}).forEach(([name, accel]) => {
    try {
      if (accel && accel.length) {
        globalShortcut.register(accel, () => dispatchHotkey(name));
      }
    } catch (e) {
      console.error('hotkey register failed', accel, e);
    }
  });
  settings.hotkeys = hotkeys;
  saveSettings();
  return { ok: true };
});

ipcMain.handle('set-click-through', (event, enabled) => {
  // keep forward: true so child elements (like collapse button) can still receive clicks if configured
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
  return { ok: true };
});

ipcMain.handle('set-overlay-visible', (event, visible) => {
  if (overlayWindow) visible ? overlayWindow.show() : overlayWindow.hide();
  return { ok: true };
});

ipcMain.handle('start-presentation', () => {
  showPresentation();
  return { ok: true };
});

ipcMain.handle('set-overlay-mode', (event, mode) => {
  if (!['presentation', 'agenda'].includes(mode)) return { ok: false };
  if (overlayWindow && !overlayCollapsed && activeOverlayMode === 'presentation') {
    const currentBounds = overlayWindow.getBounds();
    overlayModeSizes[activeOverlayMode] = { width: currentBounds.width, height: currentBounds.height };
    expandedOverlayBounds = currentBounds;
    presentationOverlayBounds = currentBounds;
  }
  if (overlayWindow && !overlayCollapsed && mode === 'agenda') {
    activeOverlayMode = 'agenda';
    overlayWindow.setAlwaysOnTop(false);
    overlayWindow.setResizable(true);
    overlayWindow.setMinimumSize(300, 200);
    overlayWindow.maximize();
    expandedOverlayBounds = overlayWindow.getBounds();
  } else if (overlayWindow && !overlayCollapsed && mode === 'presentation') {
    activeOverlayMode = 'agenda';
    if (overlayWindow.isMaximized()) overlayWindow.unmaximize();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setResizable(true);
    overlayWindow.setMinimumSize(300, 200);
    {
      const display = screen.getDisplayMatching(presentationOverlayBounds);
      const saved = { ...presentationOverlayBounds, ...overlayModeSizes.presentation };
      const width = Math.min(saved.width, display.workArea.width);
      const height = Math.min(saved.height, display.workArea.height);
      presentationOverlayBounds = {
        x: Math.max(display.workArea.x, Math.min(display.workArea.x + display.workArea.width - width, saved.x)),
        y: Math.max(display.workArea.y, Math.min(display.workArea.y + display.workArea.height - height, saved.y)),
        width,
        height
      };
      expandedOverlayBounds = presentationOverlayBounds;
      overlayWindow.setBounds(presentationOverlayBounds);
    }
    activeOverlayMode = 'presentation';
  } else {
    activeOverlayMode = mode;
    if (overlayCollapsed && mode === 'presentation') expandedOverlayBounds = presentationOverlayBounds;
  }
  return { ok: true };
});

ipcMain.handle('set-overlay-collapsed', (event, collapsed) => {
  if (!overlayWindow) return { ok: false };
  if (collapsed) {
    expandedOverlayBounds = overlayWindow.getBounds();
    overlayCollapsed = true;
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setResizable(false);
    overlayWindow.setMinimumSize(44, 44);
    overlayWindow.setSize(44, 44);
    const corners = {
      'top-left': { x: expandedOverlayBounds.x, y: expandedOverlayBounds.y },
      'top-right': { x: expandedOverlayBounds.x + expandedOverlayBounds.width - 44, y: expandedOverlayBounds.y },
      'bottom-left': { x: expandedOverlayBounds.x, y: expandedOverlayBounds.y + expandedOverlayBounds.height - 44 },
      'bottom-right': { x: expandedOverlayBounds.x + expandedOverlayBounds.width - 44, y: expandedOverlayBounds.y + expandedOverlayBounds.height - 44 }
    };
    const position = corners[settings.collapsedCorner] || corners['top-right'];
    overlayWindow.setPosition(position.x, position.y);
  } else {
    if (activeOverlayMode === 'agenda') {
      overlayWindow.setResizable(true);
      overlayWindow.setMinimumSize(300, 200);
      overlayWindow.setAlwaysOnTop(false);
      overlayWindow.maximize();
      expandedOverlayBounds = overlayWindow.getBounds();
      overlayCollapsed = false;
      return { ok: true };
    }
    const iconBounds = overlayWindow.getBounds();
    const display = screen.getDisplayMatching(iconBounds);
    const area = display.workArea;
    const width = Math.min(expandedOverlayBounds.width, area.width);
    const height = Math.min(expandedOverlayBounds.height, area.height);
    const cornerPositions = {
      'top-left': { x: iconBounds.x, y: iconBounds.y },
      'top-right': { x: iconBounds.x + iconBounds.width - width, y: iconBounds.y },
      'bottom-left': { x: iconBounds.x, y: iconBounds.y + iconBounds.height - height },
      'bottom-right': { x: iconBounds.x + iconBounds.width - width, y: iconBounds.y + iconBounds.height - height }
    };
    const position = cornerPositions[settings.collapsedCorner] || cornerPositions['top-right'];
    expandedOverlayBounds = {
      x: Math.max(area.x, Math.min(area.x + area.width - width, position.x)),
      y: Math.max(area.y, Math.min(area.y + area.height - height, position.y)),
      width,
      height
    };
    overlayCollapsed = false;
    overlayWindow.setResizable(true);
    overlayWindow.setMinimumSize(300, 200);
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setBounds(expandedOverlayBounds);
  }
  return { ok: true };
});

ipcMain.handle('get-overlay-bounds', () => {
  return overlayWindow ? overlayWindow.getBounds() : null;
});

ipcMain.handle('set-overlay-bounds', (event, bounds) => {
  if (!overlayWindow || !bounds) return { ok: false };
  const values = ['x', 'y', 'width', 'height'].map(key => Number(bounds[key]));
  if (!values.every(Number.isFinite)) return { ok: false };
  const [x, y, width, height] = values;
  const display = screen.getDisplayMatching({ x, y, width, height });
  const area = display.workArea;
  const minWidth = Math.min(overlayCollapsed ? 44 : 300, area.width);
  const minHeight = Math.min(overlayCollapsed ? 44 : 200, area.height);
  const maxWidth = overlayCollapsed ? Math.min(160, area.width) : Math.max(minWidth, area.width - 40);
  const maxHeight = overlayCollapsed ? Math.min(160, area.height) : Math.max(minHeight, area.height - 40);
  const nextWidth = overlayCollapsed ? 44 : Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
  const nextHeight = overlayCollapsed ? 44 : Math.max(minHeight, Math.min(maxHeight, Math.round(height)));
  const nextX = Math.max(area.x, Math.min(area.x + area.width - nextWidth, Math.round(x)));
  const nextY = Math.max(area.y, Math.min(area.y + area.height - nextHeight, Math.round(y)));
  const nextBounds = { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
  if (!overlayCollapsed) {
    expandedOverlayBounds = nextBounds;
    overlayModeSizes[activeOverlayMode] = { width: nextWidth, height: nextHeight };
  }
  overlayWindow.setBounds(nextBounds);
  return { ok: true };
});

ipcMain.handle('fit-overlay-content', (event, desiredHeight) => {
  if (!overlayWindow || overlayCollapsed || !Number.isFinite(Number(desiredHeight))) return { ok: false };
  if (activeOverlayMode === 'agenda') return { ok: true, bounds: overlayWindow.getBounds() };
  const bounds = overlayWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const minWidth = Math.min(300, area.width);
  const minHeight = Math.min(200, area.height);
  const maxWidth = Math.max(minWidth, area.width - 40);
  const maxHeight = Math.max(minHeight, area.height - 40);
  const width = Math.max(minWidth, Math.min(maxWidth, bounds.width));
  const desired = Math.ceil(Number(desiredHeight));
  const height = activeOverlayMode === 'agenda'
    ? Math.max(minHeight, Math.min(maxHeight, desired))
    : Math.max(Math.min(bounds.height, maxHeight), Math.min(maxHeight, desired));
  const x = Math.max(area.x, Math.min(area.x + area.width - width, bounds.x));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, bounds.y));
  expandedOverlayBounds = { x, y, width, height };
  presentationOverlayBounds = expandedOverlayBounds;
  overlayModeSizes[activeOverlayMode] = { width: expandedOverlayBounds.width, height };
  overlayWindow.setBounds(expandedOverlayBounds);
  return { ok: true, bounds: expandedOverlayBounds };
});

ipcMain.handle('focus-editor', () => {
  showEditor();
  return { ok: true };
});

ipcMain.handle('broadcast-state', (event, state) => {
  broadcastState(event.sender, state);
  return { ok: true };
});

ipcMain.handle('save-overlay-position', (event, pos) => {
  // pos: { x, y, displayId }
  settings.positions = settings.positions || {};
  settings.positions[pos.displayId] = { x: pos.x, y: pos.y };
  saveSettings();
  return { ok: true };
});

ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds }));
});

ipcMain.handle('import-steps', async (event) => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (res.canceled) return null;
  const data = fs.readJsonSync(res.filePaths[0]);
  if (!data || (!Array.isArray(data.steps) && !Array.isArray(data.presentations))) throw new Error('The selected file must contain steps or presentations.');
  stepsData = normalizeStepsData(data);
  saveSteps();
  broadcastState(event.sender, { stepsData });
  return stepsData;
});

ipcMain.handle('export-steps', async (event) => {
  const res = await dialog.showSaveDialog({ defaultPath: path.join(settings.storagePath || DEFAULT_DIR, STEPS_FILE), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (res.canceled) return null;
  fs.writeJsonSync(res.filePath, stepsData, { spaces: 2 });
  return { ok: true };
});

function registerDefaultHotkeys() {
  const defaults = {
    toggle: 'Alt+Shift+E',
    collapse: 'Alt+Shift+C',
    next: 'Alt+Shift+Right',
    prev: 'Alt+Shift+Left',
    toggleClickThrough: 'Alt+Shift+T'
  };
  ipcMain.handle('get-default-hotkeys', () => defaults);
  // register if not already set in settings
  const toRegister = settings.hotkeys && Object.keys(settings.hotkeys).length ? settings.hotkeys : defaults;
  Object.entries(toRegister).forEach(([name, accel]) => {
    try {
      globalShortcut.register(accel, () => dispatchHotkey(name));
    } catch (e) { console.error('hotkey register error', e); }
  });
}

function dispatchHotkey(name) {
  if (name === 'toggle' && overlayWindow) {
    if (overlayWindow.isVisible()) showEditor();
    else showPresentation();
  }
  if (overlayWindow) overlayWindow.webContents.send('hotkey', name);
  if (editorWindow) editorWindow.webContents.send('hotkey', name);
}

function showPresentation() {
  if (editorWindow) editorWindow.hide();
  if (overlayWindow) {
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function showEditor() {
  if (overlayWindow) overlayWindow.hide();
  if (editorWindow) {
    editorWindow.show();
    editorWindow.focus();
  }
}

function broadcastState(sender, state) {
  [editorWindow, overlayWindow].forEach((win) => {
    if (win && !win.isDestroyed() && win.webContents !== sender) {
      win.webContents.send('state-update', state);
    }
  });
}
