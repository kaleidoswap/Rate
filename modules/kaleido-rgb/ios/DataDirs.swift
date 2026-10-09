import Foundation

/// Where rgb-lib keeps wallets: the app's Documents folder (the folder react-native-rgb
/// used, so wallets made by earlier builds open in place), or a named folder inside it.
enum DataDirs {
  static let manifest = "wallet_manifest.json"
  static let bdkDb = "bdk_db"
  static let legacyBdkBackup = "bdk_db.pre-beta7"

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
    ]
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
