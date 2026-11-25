package com.kaleidoswap.rgb

import com.utexo.BitcoinNetwork
import com.utexo.RgbLibException
import com.utexo.WitnessVersion
import java.io.File
import java.util.UUID
import org.json.JSONObject

/**
 * Where rgb-lib keeps wallets: the app's files folder (the folder react-native-rgb
 * used, so wallets made by earlier builds open in place), or a named folder inside it.
 */
object DataDirs {
  const val MANIFEST = "wallet_manifest.json"
  const val BDK_DB = "bdk_db"
  const val LEGACY_BDK_BACKUP = "bdk_db.pre-beta7"
  /** rgb-lib's lock on a wallet's RGB runtime, removed when the call holding it ends. */
  const val RUNTIME_LOCK = "rgb_runtime.lock"

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

  /** The decrypted backup stays in a temporary directory until its identity is verified. */
  fun restoreBackupForWallet(
    base: File, path: String, password: String, subdir: String?, fingerprint: String,
    network: BitcoinNetwork, vanillaXpub: String, coloredXpub: String, witnessVersion: WitnessVersion,
  ) {
    val destination = walletDir(base, subdir, fingerprint)
    if (destination.exists()) throw RgbLibException.WalletDirAlreadyExists(destination.absolutePath)
    val parent = checkNotNull(destination.parentFile)
    // The native files dispatcher is serial, so a previous staging directory is orphaned.
    val stagingPrefix = ".rgb-restore-"
    parent.listFiles()?.filter { file ->
      file.name.startsWith(stagingPrefix) && runCatching {
        UUID.fromString(file.name.removePrefix(stagingPrefix))
      }.isSuccess
    }?.forEach { it.deleteRecursively() }
    val staging = File(parent, stagingPrefix + UUID.randomUUID())
    if (!staging.mkdir()) throw IllegalStateException("Could not stage the RGB backup")
    try {
      com.utexo.restoreBackup(path, password, staging.absolutePath)
      val source = File(staging, fingerprint)
      if (!source.isDirectory) throw InvalidArgument("This RGB backup belongs to another wallet.")
      val info = runCatching { JSONObject(File(source, MANIFEST).readText()) }.getOrNull()
        ?: throw InvalidArgument("This RGB backup has no readable wallet manifest. Export a newer backup from the original wallet.")
      if (info.optInt("version") != 1 || info.optString("database_type") != "Sqlite" || !File(source, "rgb_lib_db").isFile) {
        throw InvalidArgument("This RGB backup is missing supported wallet data.")
      }
      if (!info.optString("bitcoin_network").equals(network.name.replace("_", ""), ignoreCase = true)) {
        throw InvalidArgument("This RGB backup belongs to a different Bitcoin network.")
      }
      if (!info.optString("witness_version").equals(witnessVersion.name.replace("_", ""), ignoreCase = true) ||
          info.optInt("vanilla_keychain", -1) != 0) {
        throw InvalidArgument("This RGB backup uses different wallet key settings.")
      }
      if (info.optString("master_fingerprint") != fingerprint ||
          info.optString("account_xpub_vanilla") != vanillaXpub ||
          info.optString("account_xpub_colored") != coloredXpub) {
        throw InvalidArgument("This RGB backup belongs to another wallet.")
      }
      if (!source.renameTo(destination)) throw IllegalStateException("Could not move the restored RGB wallet into place")
    } finally {
      staging.deleteRecursively()
    }
  }

  fun state(walletDir: File): Map<String, Any?> = mapOf(
    "exists" to walletDir.isDirectory,
    "hasManifest" to File(walletDir, MANIFEST).isFile,
    "hasBdkDb" to File(walletDir, BDK_DB).exists(),
    "hasLegacyBdkBackup" to (walletDir.listFiles()?.any { it.name.startsWith(LEGACY_BDK_BACKUP) } ?: false),
    "hasRuntimeLock" to File(walletDir, RUNTIME_LOCK).exists(),
  )

  /**
   * rgb-lib holds `rgb_runtime.lock` while a call uses the wallet's RGB runtime and
   * deletes it when the call ends. A process killed mid-call (the OS, a crash, a
   * force stop) leaves it behind, and every later open waits up to an hour for it
   * before failing with "unreleased lock file": RGB never connects again. Only call
   * when no wallet in this process has the folder open. True when one was removed.
   */
  fun clearStaleRuntimeLock(walletDir: File): Boolean {
    val lock = File(walletDir, RUNTIME_LOCK)
    return lock.isFile && lock.delete()
  }

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
