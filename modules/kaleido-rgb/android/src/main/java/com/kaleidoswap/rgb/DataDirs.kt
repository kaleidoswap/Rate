package com.kaleidoswap.rgb

import java.io.File

/**
 * Where rgb-lib keeps wallets: the app's files folder (the folder react-native-rgb
 * used, so wallets made by earlier builds open in place), or a named folder inside it.
 */
object DataDirs {
  const val MANIFEST = "wallet_manifest.json"
  const val BDK_DB = "bdk_db"
  const val LEGACY_BDK_BACKUP = "bdk_db.pre-beta7"

  private val subdirPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
  private val fingerprintPattern = Regex("^[0-9a-fA-F]{8}$")

  fun dataDir(base: File, subdir: String?): File {
    if (subdir.isNullOrEmpty()) {
      if (!base.isDirectory && !base.mkdirs()) throw IllegalStateException("Could not create the RGB data folder")
      return base
    }
    if (!subdirPattern.matches(subdir)) throw InvalidArgument("Invalid RGB data folder: $subdir")
    val dir = File(base, subdir)
    if (!dir.isDirectory && !dir.mkdirs()) throw IllegalStateException("Could not create RGB data folder: $subdir")
    return dir
  }

  fun walletDir(base: File, subdir: String?, fingerprint: String): File {
    if (!fingerprintPattern.matches(fingerprint)) throw InvalidArgument("Invalid master fingerprint")
    return File(dataDir(base, subdir), fingerprint)
  }

  fun state(walletDir: File): Map<String, Any?> = mapOf(
    "exists" to walletDir.isDirectory,
    "hasManifest" to File(walletDir, MANIFEST).isFile,
    "hasBdkDb" to File(walletDir, BDK_DB).exists(),
    "hasLegacyBdkBackup" to (walletDir.listFiles()?.any { it.name.startsWith(LEGACY_BDK_BACKUP) } ?: false),
  )

  /**
   * rgb-lib 0.3.0-beta.6 moved to BDK 3, whose cache file can't read the one earlier
   * versions wrote. A wallet folder without a manifest was last opened by such a
   * version: move its BDK cache aside (never delete it, never touch the RGB database)
   * so the next open starts a fresh cache, rebuilt by the full scan in goOnline.
   * Returns the backup's name, or null when there was nothing to move.
   */
  fun moveAsideLegacyBdkCache(walletDir: File): String? {
    if (File(walletDir, MANIFEST).exists()) throw IllegalStateException("Refusing to move the BDK cache of a wallet opened by rgb-lib 0.3.0-beta.7")
    val cache = File(walletDir, BDK_DB)
    if (!cache.exists()) return null
    var name = LEGACY_BDK_BACKUP
    var n = 1
    while (File(walletDir, name).exists()) name = "$LEGACY_BDK_BACKUP.${++n}"
    if (!cache.renameTo(File(walletDir, name))) throw IllegalStateException("Could not move the old BDK cache aside")
    return name
  }
}
