'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');

const PORT = process.env.PORT || 3000;
let mainWindow = null;

// Poll until the Express server is accepting connections.
function waitForServer(retries = 30, delayMs = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const try_ = () => {
      const req = http.get(`http://localhost:${PORT}`, res => {
        res.destroy();
        resolve();
      });
      req.on('error', () => {
        if (++attempts >= retries) {
          return reject(new Error(`Server did not start on port ${PORT}`));
        }
        setTimeout(try_, delayMs);
      });
      req.end();
    };
    try_();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    require('./server.js');
    await waitForServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('SilverSprints — Startup Error', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
