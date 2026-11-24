import Foundation

private struct CheckFailed: Error {
    let message: String
}

private func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw CheckFailed(message: message) }
}

private struct WalletState: Equatable {
    let descriptors: WalletDescriptors
    let bitcoin: BtcBalance
    let assets: Assets
    let transfers: [Transfer]

    init(_ wallet: Wallet) throws {
        descriptors = wallet.getDescriptors()
        bitcoin = try wallet.getBtcBalance(online: nil, skipSync: true)
        assets = try wallet.listAssets(filterAssetSchemas: [.bfa, .nia])
        transfers = try wallet.listTransfers(assetFilter: .anyOrNone, scope: .all)
    }
}

private func createAndBackUp(
    in directory: URL, keys: Keys, backup: URL, password: String
) throws -> (firstAddress: String, state: WalletState) {
    let data = WalletData(
        dataDir: directory.path,
        bitcoinNetwork: .regtest,
        databaseType: .sqlite,
        maxAllocationsPerUtxo: 5,
        supportedSchemas: [.nia, .bfa],
        allowRecklessSchemas: false
    )
    let wallet = try Wallet(walletData: data, keys: SinglesigKeys(
        accountXpubVanilla: keys.accountXpubVanilla,
        accountXpubColored: keys.accountXpubColored,
        vanillaKeychain: nil,
        masterFingerprint: keys.masterFingerprint,
        mnemonic: keys.mnemonic,
        witnessVersion: keys.witnessVersion
    ))
    let firstAddress = try wallet.getAddress()
    try check(firstAddress.hasPrefix("bcrt1"), "The fresh wallet did not return a Regtest address.")
    try check(wallet.getWalletData().supportedSchemas.contains(.bfa), "The native wallet did not enable BFA.")
    try check(try wallet.backupInfo(), "A revealed address did not mark the wallet for backup.")
    try wallet.backup(backupPath: backup.path, password: password)
    try check(!wallet.backupInfo(), "The backup did not clear the backup-required flag.")
    let fileSize = try backup.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    try check(fileSize > 0, "The encrypted backup file is empty.")
    return (firstAddress, try WalletState(wallet))
}

private func nextAddress(in directory: URL, keys: Keys, expected: WalletState) throws -> String {
    let wallet = try Wallet.load(
        dataDir: directory.path,
        masterFingerprint: keys.masterFingerprint,
        mnemonic: keys.mnemonic
    )
    try check(wallet.getWalletData().bitcoinNetwork == .regtest, "The loaded network changed.")
    try check(wallet.getKeys().masterFingerprint == keys.masterFingerprint, "The loaded wallet fingerprint changed.")
    try check(try WalletState(wallet) == expected, "The loaded wallet state differs from the original state.")
    try check(!wallet.backupInfo(), "The loaded wallet lost its last backup status.")
    return try wallet.getAddress()
}

@main
struct OfflineBfaProbe {
    static func main() {
        var stage = "prepare scratch directories"
        do {
            try check(CommandLine.arguments.count == 2, "Pass the private scratch directory created by run-ios.sh.")
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let original = root.appendingPathComponent("original", isDirectory: true)
            let restored = root.appendingPathComponent("restored", isDirectory: true)
            let rejected = root.appendingPathComponent("wrong-password", isDirectory: true)
            for directory in [original, restored, rejected] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            let keys = generateKeys(bitcoinNetwork: .regtest, witnessVersion: .taproot)
            let password = UUID().uuidString
            let backup = root.appendingPathComponent("wallet.rgbbackup")

            stage = "create and back up the fresh Regtest wallet"
            let expected = try createAndBackUp(in: original, keys: keys, backup: backup, password: password)
            print("PASS created a Regtest wallet with BFA support and encrypted its backup")

            stage = "open the original wallet on disk"
            let reopenedAddress = try nextAddress(in: original, keys: keys, expected: expected.state)
            try check(reopenedAddress != expected.firstAddress, "The reopened wallet reused its first address.")
            print("PASS reopened the same wallet and advanced its address index")

            stage = "reject the wrong backup password"
            do {
                try restoreBackup(backupPath: backup.path, password: UUID().uuidString, dataDir: rejected.path)
                throw CheckFailed(message: "The wrong backup password was accepted.")
            } catch RgbLibError.WrongPassword {
                let wrongWallet = rejected.appendingPathComponent(keys.masterFingerprint)
                try check(!FileManager.default.fileExists(atPath: wrongWallet.path), "The failed restore created a wallet directory.")
            }
            print("PASS rejected a wrong backup password without creating a wallet")

            stage = "restore and open in a clean directory"
            try restoreBackup(backupPath: backup.path, password: password, dataDir: restored.path)
            let restoredAddress = try nextAddress(in: restored, keys: keys, expected: expected.state)
            try check(restoredAddress == reopenedAddress, "The restored address index differs from the original.")
            print("PASS restored matching wallet state and address index in a clean directory")
        } catch let failure as CheckFailed {
            fputs("FAIL \(stage): \(failure.message)\n", stderr)
            exit(1)
        } catch {
            // Do not print native error payloads. They can contain wallet data or paths.
            let kind = Mirror(reflecting: error).children.first?.label ?? String(describing: type(of: error))
            fputs("FAIL \(stage): \(kind)\n", stderr)
            exit(1)
        }
    }
}
