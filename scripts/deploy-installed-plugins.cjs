const fs = require('fs');
const path = require('path');

const cliArgs = process.argv.slice(2);
const pluginsToDeploy = cliArgs.length > 0 ? cliArgs : ['dev-toys', 'media-converter', 'ocr-recognizer', 'markdown-editor'];
const appDataPluginsDir = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'),
  '@doujiao',
  'host',
  'plugins'
);

console.log('[Deploy] 正在部署新插件至本地 AppData 运行目录:', appDataPluginsDir);

for (const pluginId of pluginsToDeploy) {
  const pluginSrcDir = path.resolve(__dirname, '..', 'plugins', pluginId);
  const manifestPath = path.join(pluginSrcDir, 'manifest.json');
  const distDir = path.join(pluginSrcDir, 'dist');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(distDir)) {
    console.warn(`[Deploy] 跳过 ${pluginId}: 缺少 manifest.json 或 dist 产物`);
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const version = manifest.version;

  const targetPluginDir = path.join(appDataPluginsDir, pluginId);
  const targetVersionDir = path.join(targetPluginDir, 'versions', version);

  fs.mkdirSync(targetVersionDir, { recursive: true });

  // 复制 manifest.json
  fs.copyFileSync(manifestPath, path.join(targetVersionDir, 'manifest.json'));

  // 复制 dist
  fs.cpSync(distDir, path.join(targetVersionDir, 'dist'), { recursive: true });

  // 写入 state.json
  const stateJsonPath = path.join(targetPluginDir, 'state.json');
  let state = {
    activeVersion: version,
    lastUpdated: new Date().toISOString(),
    installedVersions: [version]
  };

  if (fs.existsSync(stateJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(stateJsonPath, 'utf-8'));
      if (!existing.installedVersions?.includes(version)) {
        existing.installedVersions = [...(existing.installedVersions || []), version];
      }
      existing.activeVersion = version;
      existing.lastUpdated = new Date().toISOString();
      state = existing;
    } catch {}
  }

  fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2), 'utf-8');
  console.log(`[Deploy] ✓ 成功部署 ${pluginId} v${version} 至 ${targetVersionDir}`);
}

console.log('[Deploy] 全部新插件部署完成！');
