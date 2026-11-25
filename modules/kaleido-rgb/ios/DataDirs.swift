import Foundation

/// Where rgb-lib keeps wallets: the app's Documents folder (the folder react-native-rgb
/// used, so wallets made by earlier builds open in place), or a named folder inside it.
enum DataDirs {
  static let manifest = "wallet_manifest.json"
  static let bdkDb = "bdk_db"
  static let legacyBdkBackup = "bdk_db.pre-beta7"
  /// rgb-lib's lock on a wallet's RGB runtime, removed when the call holding it ends.
  static let runtimeLock = "rgb_runtime.lock"

  static func base() -> URL {
    return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  static func dataDir(_ subdir: String?) throws -> URL {
    let root = base()
    guard let name = subdir, !name.isEmpty else {
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      return root
    }
    guard name.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else {
      throw InvalidArgument(description: "Invalid RGB data folder: \(name)")
    }
    let dir = root.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func walletDir(_ subdir: String?, _ fingerprint: String) throws -> URL {
    guard fingerprint.range(of: "^[0-9a-fA-F]{8}$", options: .regularExpression) != nil else {
      throw InvalidArgument(description: "Invalid master fingerprint")
    }
    return try dataDir(subdir).appendingPathComponent(fingerprint, isDirectory: true)
  }

  /// The decrypted backup stays in a temporary directory until its identity is verified.
  static func restoreBackupForWallet(
    path: String, password: String, subdir: String?, fingerprint: String, network: BitcoinNetwork,
    vanillaXpub: String, coloredXpub: String, witnessVersion: WitnessVersion
  ) throws {
    let files = FileManager.default
    let destination = try walletDir(subdir, fingerprint)
    if files.fileExists(atPath: destination.path) {
      throw RgbLibError.WalletDirAlreadyExists(path: destination.path)
    }
    let parent = destination.deletingLastPathComponent()
    // The native files queue is serial, so a previous staging directory is orphaned.
    let stagingPrefix = ".rgb-restore-"
    let siblings = (try? files.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? []
    for orphan in siblings where orphan.lastPathComponent.hasPrefix(stagingPrefix) {
      if UUID(uuidString: String(orphan.lastPathComponent.dropFirst(stagingPrefix.count))) != nil {
        try? files.removeItem(at: orphan)
      }
    }
    var staging = parent.appendingPathComponent(".rgb-restore-\(UUID().uuidString)", isDirectory: true)
    try files.createDirectory(at: staging, withIntermediateDirectories: false)
    defer { try? files.removeItem(at: staging) }
    var restoreResources = URLResourceValues()
    restoreResources.isExcludedFromBackup = true
    try staging.setResourceValues(restoreResources)
    try restoreBackup(backupPath: path, password: password, dataDir: staging.path)
    let source = staging.appendingPathComponent(fingerprint, isDirectory: true)
    let manifestPath = source.appendingPathComponent(manifest)
    guard files.fileExists(atPath: source.path) else {
      throw InvalidArgument(description: "This RGB backup belongs to another wallet.")
    }
    guard let manifestData = try? Data(contentsOf: manifestPath),
          let info = (try? JSONSerialization.jsonObject(with: manifestData)) as? [String: Any] else {
      throw InvalidArgument(description: "This RGB backup has no readable wallet manifest. Export a newer backup from the original wallet.")
    }
    guard info["version"] as? Int == 1, info["database_type"] as? String == "Sqlite", exists(source.appendingPathComponent("rgb_lib_db"), directory: false) else {
      throw InvalidArgument(description: "This RGB backup is missing supported wallet data.")
    }
    let networkName = Mappers.networkName(network).replacingOccurrences(of: "_", with: "").lowercased()
    guard (info["bitcoin_network"] as? String)?.lowercased() == networkName else {
      throw InvalidArgument(description: "This RGB backup belongs to a different Bitcoin network.")
    }
    let witness = Mappers.witnessVersionName(witnessVersion).replacingOccurrences(of: "_", with: "").lowercased()
    guard (info["witness_version"] as? String)?.lowercased() == witness,
          info["vanilla_keychain"] as? Int == 0 else {
      throw InvalidArgument(description: "This RGB backup uses different wallet key settings.")
    }
    guard info["master_fingerprint"] as? String == fingerprint,
          info["account_xpub_vanilla"] as? String == vanillaXpub,
          info["account_xpub_colored"] as? String == coloredXpub else {
      throw InvalidArgument(description: "This RGB backup belongs to another wallet.")
    }
    try files.moveItem(at: source, to: destination)
  }

  private static func exists(_ url: URL, directory: Bool? = nil) -> Bool {
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return false }
    if let directory = directory { return isDir.boolValue == directory }
    return true
  }

  static func state(_ walletDir: URL) -> [String: Any] {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: walletDir.path)) ?? []
    return [
      "exists": exists(walletDir, directory: true),
      "hasManifest": exists(walletDir.appendingPathComponent(manifest), directory: false),
      "hasBdkDb": exists(walletDir.appendingPathComponent(bdkDb)),
      "hasLegacyBdkBackup": names.contains { $0.hasPrefix(legacyBdkBackup) },
      "hasRuntimeLock": exists(walletDir.appendingPathComponent(runtimeLock), directory: false),
    ]
  }

  /// rgb-lib holds `rgb_runtime.lock` while a call uses the wallet's RGB runtime and
  /// deletes it when the call ends. A process killed mid-call (the OS, a crash, a
  /// force quit) leaves it behind, and every later open waits up to an hour for it
  /// before failing with "unreleased lock file": RGB never connects again. Only call
  /// when no wallet in this process has the folder open. True when one was removed.
  static func clearStaleRuntimeLock(_ walletDir: URL) -> Bool {
    let lock = walletDir.appendingPathComponent(runtimeLock)
    guard exists(lock, directory: false) else { return false }
    return (try? FileManager.default.removeItem(at: lock)) != nil
  }

  /// rgb-lib 0.3.0-beta.6 moved to BDK 3, whose cache file can't read the one earlier
  /// versions wrote. A wallet folder without a manifest was last opened by such a
  /// version: move its BDK cache aside (never delete it, never touch the RGB database)
  /// so the next open starts a fresh cache, rebuilt by the full scan in goOnline.
  /// Returns the backup's name, or "" when there was nothing to move.
  static func moveAsideLegacyBdkCache(_ walletDir: URL) throws -> String {
    if exists(walletDir.appendingPathComponent(manifest)) {
      throw InvalidArgument(description: "Refusing to move the BDK cache of a wallet opened by rgb-lib 0.3.0-beta.7")
    }
    let cache = walletDir.appendingPathComponent(bdkDb)
    guard exists(cache) else { return "" }
    var name = legacyBdkBackup
    var n = 1
    while exists(walletDir.appendingPathComponent(name)) {
      n += 1
      name = "\(legacyBdkBackup).\(n)"
    }
    try FileManager.default.moveItem(at: cache, to: walletDir.appendingPathComponent(name))
    return name
  }
}
