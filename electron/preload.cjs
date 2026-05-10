const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('noclickDesktop', {
  platform: process.platform,
  shell: 'electron',
})
