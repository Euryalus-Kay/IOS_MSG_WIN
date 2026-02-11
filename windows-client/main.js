const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    serverUrl: 'http://localhost:3782',
    windowBounds: { width: 1200, height: 800 }
  }
});

let mainWindow;

function createWindow() {
  const bounds = store.get('windowBounds');
  const isDark = nativeTheme.shouldUseDarkColors;

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    title: 'iMessage',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isDark ? '#1c1c1e' : '#f6f6f8',
      symbolColor: isDark ? '#f5f5f7' : '#1d1d1f',
      height: 52
    },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true
    },
    backgroundColor: isDark ? '#1c1c1e' : '#f5f5f7',
    show: false,
    vibrancy: 'sidebar',
    visualEffectState: 'active'
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    store.set('windowBounds', { width, height });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update titlebar color when theme changes
  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors;
    if (mainWindow) {
      mainWindow.setTitleBarOverlay({
        color: dark ? '#1c1c1e' : '#f6f6f8',
        symbolColor: dark ? '#f5f5f7' : '#1d1d1f'
      });
    }
  });
}

// IPC handlers
ipcMain.handle('get-server-url', () => store.get('serverUrl'));
ipcMain.handle('set-server-url', (_, url) => {
  store.set('serverUrl', url);
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
