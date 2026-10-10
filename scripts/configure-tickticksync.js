const fs = require('node:fs');
const path = require('node:path');

const vault = 'F:/Obsidian';
const configPath = path.join(vault, '.obsidian/plugins/tickticksync/data.json');
const backupPath = path.join(vault, '.obsidian/plugins/tickticksync/data.before-hz-workbench.json');
const taskFolder = path.join(vault, '08 系统/TickTick');
const backupFolder = path.join(taskFolder, '备份');

if (!fs.existsSync(configPath)) throw new Error('TickTickSync 配置不存在');
if (!fs.existsSync(backupPath)) fs.copyFileSync(configPath, backupPath);
fs.mkdirSync(backupFolder, { recursive: true });

const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
Object.assign(settings, {
  automaticSynchronizationInterval: 300,
  enableFullVaultSync: true,
  debugMode: false,
  logLevel: 'info',
  SyncProject: '',
  SyncTag: '',
  TickTickTasksFilePath: '08 系统/TickTick',
  keepProjectFolders: false,
  syncNotes: true,
  bkupFolder: '08 系统/TickTick/备份',
  skipBackup: false,
});
fs.writeFileSync(configPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
console.log('TICKTICKSYNC_CONFIGURED');
