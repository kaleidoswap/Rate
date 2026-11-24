import Foundation

private struct CheckFailed: Error {
    let message: String
}

private func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw CheckFailed(message: message) }
}

private struct Fixture: Codable {
    let mnemonic: String
    let password: String
    let firstAddress: String
    let nextAddress: String
    let vanillaDescriptor: String
    let coloredDescriptor: String
}

private func openWallet(in directory: URL, keys: Keys) throws -> Wallet {
    #if STANDARD_BETA7
    let data = WalletData(
        dataDir: directory.path, bitcoinNetwork: .regtest, databaseType: .sqlite,
        maxAllocationsPerUtxo: 5, supportedSchemas: [.nia, .cfa, .uda, .ifa]
    )
    #else
    let data = WalletData(
        dataDir: directory.path, bitcoinNetwork: .regtest, databaseType: .sqlite,
        maxAllocationsPerUtxo: 5, supportedSchemas: [.nia, .cfa, .uda, .ifa, .bfa],
        allowRecklessSchemas: false
    )
    #endif
    return try Wallet(walletData: data, keys: SinglesigKeys(
        accountXpubVanilla: keys.accountXpubVanilla,
        accountXpubColored: keys.accountXpubColored,
        vanillaKeychain: nil,
        masterFingerprint: keys.masterFingerprint,
        mnemonic: keys.mnemonic,
        witnessVersion: keys.witnessVersion
    ))
}

@main
struct Beta7CompatProbe {
    static func main() {
        do {
            try check(CommandLine.arguments.count == 2, "Pass the scratch directory created by the probe script.")
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let archive = root.appendingPathComponent("standard.rgbbackup")
            let fixtureFile = root.appendingPathComponent("fixture.json")
            let copy = root.appendingPathComponent("upgrade-copy", isDirectory: true)
            #if STANDARD_BETA7
            let original = root.appendingPathComponent("standard-original", isDirectory: true)
            try FileManager.default.createDirectory(at: original, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let keys = generateKeys(bitcoinNetwork: .regtest, witnessVersion: .taproot)
            let password = UUID().uuidString
            let firstAddress: String
            let descriptors: WalletDescriptors
            do {
                let wallet = try openWallet(in: original, keys: keys)
                descriptors = wallet.getDescriptors()
                firstAddress = try wallet.getAddress()
                try check(firstAddress.hasPrefix("bcrt1"), "Standard beta.7 did not generate a Regtest address.")
                try wallet.backup(backupPath: archive.path, password: password)
            }
            try FileManager.default.copyItem(at: original, to: copy)
            let nextAddress = try openWallet(in: original, keys: keys).getAddress()
            try check(nextAddress != firstAddress, "Standard beta.7 did not persist its own address index.")
            let fixture = Fixture(
                mnemonic: keys.mnemonic, password: password, firstAddress: firstAddress, nextAddress: nextAddress,
                vanillaDescriptor: descriptors.vanilla, coloredDescriptor: descriptors.colored
            )
            try JSONEncoder().encode(fixture).write(to: fixtureFile, options: .atomic)
            print("PASS standard beta.7 created a closed Regtest wallet copy and encrypted backup")
            #else
            let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureFile))
            let keys = try restoreKeys(bitcoinNetwork: .regtest, mnemonic: fixture.mnemonic, witnessVersion: .taproot)
            try verify(directory: copy, keys: keys, fixture: fixture)
            print("PASS bfa.8 reopened the beta.7 wallet copy and preserved its address index")

            let restored = root.appendingPathComponent("restored", isDirectory: true)
            try restoreBackup(backupPath: archive.path, password: fixture.password, dataDir: restored.path)
            try verify(directory: restored, keys: keys, fixture: fixture)
            print("PASS bfa.8 restored the beta.7 encrypted backup with matching wallet state")
            #endif
        } catch let failure as CheckFailed {
            fputs("FAIL \(failure.message)\n", stderr)
            exit(1)
        } catch {
            let kind = Mirror(reflecting: error).children.first?.label ?? String(describing: type(of: error))
            fputs("FAIL beta.7 compatibility probe: \(kind)\n", stderr)
            exit(1)
        }
    }

    #if !STANDARD_BETA7
    private static func verify(directory: URL, keys: Keys, fixture: Fixture) throws {
        try check(FileManager.default.fileExists(atPath: directory.appendingPathComponent(keys.masterFingerprint).path),
                  "The beta.7 wallet directory is missing.")
        let wallet = try openWallet(in: directory, keys: keys)
        let descriptors = wallet.getDescriptors()
        try check(descriptors.vanilla == fixture.vanillaDescriptor && descriptors.colored == fixture.coloredDescriptor,
                  "The migrated wallet descriptors differ.")
        let balance = try wallet.getBtcBalance(online: nil, skipSync: true)
        let empty = Balance(settled: 0, future: 0, spendable: 0)
        try check(balance.vanilla == empty && balance.colored == empty, "The unfunded fixture has an unexpected BTC balance.")
        try check(try wallet.listTransfers(assetFilter: .anyOrNone, scope: .all).isEmpty,
                  "The offline fixture has unexpected transfers.")
        let address = try wallet.getAddress()
        try check(address != fixture.firstAddress && address == fixture.nextAddress, "The migrated address index differs.")
    }
    #endif
}
