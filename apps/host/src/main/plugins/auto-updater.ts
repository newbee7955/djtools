import semver from 'semver'
import { PluginManager } from './plugin-manager'
import { RegistryClient, RegistryRelease } from './registry-client'
import type { PluginCapability } from '@doujiao/plugin-sdk'

export interface PluginUpdateCheckResult {
  pluginId: string
  name: string
  currentVersion: string
  latestVersion: string
  changelog: string
  hasPermissionChanges: boolean
  addedCapabilities: string[]
  addedHosts: string[]
  release: RegistryRelease
}

export class PluginAutoUpdater {
  private static instance: PluginAutoUpdater

  private constructor() {}

  public static getInstance(): PluginAutoUpdater {
    if (!PluginAutoUpdater.instance) {
      PluginAutoUpdater.instance = new PluginAutoUpdater()
    }
    return PluginAutoUpdater.instance
  }

  /**
   * 检查所有已安装插件的更新，并深度审计权限变更差异 (Permission Diff)
   */
  public async checkForUpdates(): Promise<PluginUpdateCheckResult[]> {
    const pluginManager = PluginManager.getInstance()
    const registryClient = RegistryClient.getInstance()

    const installedPlugins = pluginManager.listAllPlugins()
    const registry = await registryClient.fetchRegistry()

    const updates: PluginUpdateCheckResult[] = []

    for (const local of installedPlugins) {
      const regItem = registry.plugins.find((p) => p.id === local.id)
      if (!regItem || regItem.releases.length === 0) continue

      const latestRelease = regItem.releases[0]
      if (semver.gt(latestRelease.version, local.version)) {
        // 分析权限变更差异 (Permission Diff)
        const oldPermissions = local.manifest.permissions || []
        const newPermissions = latestRelease.permissions || []

        const diff = this.computePermissionDiff(oldPermissions, newPermissions)

        updates.push({
          pluginId: local.id,
          name: local.name,
          currentVersion: local.version,
          latestVersion: latestRelease.version,
          changelog: latestRelease.changelog,
          hasPermissionChanges: diff.hasChanges,
          addedCapabilities: diff.addedCapabilities,
          addedHosts: diff.addedHosts,
          release: latestRelease
        })
      }
    }

    return updates
  }

  private computePermissionDiff(
    oldPerms: PluginCapability[],
    newPerms: PluginCapability[]
  ): { hasChanges: boolean; addedCapabilities: string[]; addedHosts: string[] } {
    const oldCaps = new Set(oldPerms.map((p) => p.capability))
    const newCaps = new Set(newPerms.map((p) => p.capability))

    const addedCapabilities: string[] = []
    for (const cap of newCaps) {
      if (!oldCaps.has(cap)) {
        addedCapabilities.push(cap)
      }
    }

    // 分析网络域名权限扩展
    const getHosts = (perms: PluginCapability[]): Set<string> => {
      const hosts = new Set<string>()
      perms.forEach((p: any) => {
        if (p.capability === 'network.request' && Array.isArray(p.hosts)) {
          p.hosts.forEach((h: string) => hosts.add(h))
        }
      })
      return hosts
    }

    const oldHosts = getHosts(oldPerms)
    const newHosts = getHosts(newPerms)
    const addedHosts: string[] = []

    for (const host of newHosts) {
      if (!oldHosts.has(host)) {
        addedHosts.push(host)
      }
    }

    const hasChanges = addedCapabilities.length > 0 || addedHosts.length > 0
    return { hasChanges, addedCapabilities, addedHosts }
  }
}
