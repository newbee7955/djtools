const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { execSync } = require('child_process');

async function packagePlugin(pluginRelativeDir) {
  const pluginDir = path.resolve(__dirname, '..', pluginRelativeDir);
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`找不到 manifest.json: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const { id, version } = manifest;
  console.log(`\n========================================`);
  console.log(`[Packager] 正在打包并签名插件: ${id} @ v${version}`);
  console.log(`========================================`);

  // 1. 确保 dist 产物最新
  const distDir = path.join(pluginDir, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log(`[Packager] 未检测到 dist 产物，正在执行 npm run build...`);
    execSync(`npm run build`, { cwd: pluginDir, stdio: 'inherit' });
  }

  // 2. 准备 registry/releases 存储目录
  const registryDir = path.resolve(__dirname, '../registry');
  const releasesDir = path.join(registryDir, 'releases');
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  const zipFileName = `${id}-v${version}.zip`;
  const outputZipPath = path.join(releasesDir, zipFileName);
  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
  }

  // 3. 使用 archiver 制作干净的 ZIP 包
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    // 放入 manifest.json
    archive.file(manifestPath, { name: 'manifest.json' });
    // 放入 dist 目录下的所有静态产物
    archive.directory(distDir, 'dist');
    archive.finalize();
  });

  const zipStat = fs.statSync(outputZipPath);
  console.log(`[Packager] ZIP 打包完成: ${outputZipPath} (${(zipStat.size / 1024).toFixed(1)} KB)`);

  // 4. 计算 SHA-256
  const zipBuffer = fs.readFileSync(outputZipPath);
  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  console.log(`[Packager] SHA-256: ${sha256}`);

  // 5. 使用官方 Ed25519 私钥签名
  const privateKeyPath = path.resolve(__dirname, '.keys/ed25519_private.pem');
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error('未找到官方私钥，请先运行 scripts/generate-keys.cjs');
  }
  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  const signature = crypto.sign(null, Buffer.from(sha256, 'utf-8'), privateKey).toString('base64');
  console.log(`[Packager] Ed25519 签名生成成功: ${signature.slice(0, 32)}...`);

  // 6. 更新或追加 registry/plugins-registry.json
  const registryJsonPath = path.join(registryDir, 'plugins-registry.json');
  let registryData = {
    schemaVersion: 2,
    registryVersion: 1,
    updatedAt: new Date().toISOString(),
    plugins: []
  };

  if (fs.existsSync(registryJsonPath)) {
    try {
      registryData = JSON.parse(fs.readFileSync(registryJsonPath, 'utf-8'));
    } catch (e) {}
  }

  registryData.registryVersion = (registryData.registryVersion || 1) + 1;
  registryData.updatedAt = new Date().toISOString();

  // 寻找或创建当前 plugin entry
  let pluginEntry = registryData.plugins.find((p) => p.id === id);
  if (!pluginEntry) {
    pluginEntry = {
      id: manifest.id,
      publisher: manifest.publisher || 'doujiao-official',
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon || 'assets/icon.png',
      releases: []
    };
    registryData.plugins.push(pluginEntry);
  } else {
    pluginEntry.name = manifest.name || pluginEntry.name;
    pluginEntry.description = manifest.description || pluginEntry.description;
  }

  // 构建 release 记录
  const artifactUrl = `https://raw.githubusercontent.com/newbee7955/djtools/main/registry/releases/${zipFileName}`;
  const newRelease = {
    version: manifest.version,
    channel: 'stable',
    publishedAt: new Date().toISOString(),
    changelog: manifest.changelog || `【v${manifest.version}】常规性能优化与体验改进`,

    engines: manifest.engines,
    permissions: manifest.permissions,
    artifacts: [
      {
        platform: 'any',
        arch: 'any',
        url: artifactUrl,
        size: zipStat.size,
        sha256: sha256,
        signature: signature
      }
    ]
  };

  // 过滤掉同版本的旧 release
  pluginEntry.releases = pluginEntry.releases.filter((r) => r.version !== manifest.version);
  pluginEntry.releases.unshift(newRelease);

  fs.writeFileSync(registryJsonPath, JSON.stringify(registryData, null, 2), 'utf-8');
  console.log(`[Packager] 中心索引已更新: ${registryJsonPath}`);
  return { id, version, zipFileName, sha256, signature };
}

// 命令行直接执行支持: node scripts/package-plugin.cjs plugins/douyin
if (require.main === module) {
  const target = process.argv[2] || 'plugins/douyin';
  packagePlugin(target).catch((err) => {
    console.error('[Packager] 错误:', err);
    process.exit(1);
  });
}

module.exports = { packagePlugin };
