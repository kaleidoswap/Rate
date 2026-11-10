// Live iOS-simulator probe linked against the exact rgb-lib shipped by Rate.
// Uses throwaway keys in a private directory. Never reads the app's wallets.
import Foundation

struct ProbeError: Error, CustomStringConvertible { let description: String }
func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw ProbeError(description: message) }
}
func emit(_ event: String, _ fields: [String: Any] = [:]) {
    let data = try! JSONSerialization.data(withJSONObject: fields.merging(["event": event]) { _, b in b }, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    fflush(stdout)
}
let indexer = "https://esplora.signet.kaleidoswap.com"
let proxy = "rpcs://proxy.iriswallet.com/0.2/json-rpc"

@main struct Probe {
    static func main() {
        do {
            try check(CommandLine.arguments.count == 3, "Usage: probe STATE_DIR prepare|switch|send|status")
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let mode = CommandLine.arguments[2]
            if mode == "prepare" {
                for role in ["alice", "bob"] {
                    let w = try wallet(root, role, "mutinynet")
                    let publicFile = root.appendingPathComponent("\(role)-address.txt")
                    if !FileManager.default.fileExists(atPath: publicFile.path) {
                        try w.getAddress().write(to: publicFile, atomically: true, encoding: .utf8)
                    }
                    emit("wallet", ["role": role, "address": try String(contentsOf: publicFile, encoding: .utf8), "directory": w.getWalletDir()])
                }
            } else if mode == "connect-networks" {
                try connectNetworks(root)
            } else if mode == "switch" {
                try switches(root)
            } else if mode == "failure-tests" {
                try failureTests(root)
            } else if mode.hasPrefix("backup-") {
                try backupProbe(root, mode)
            } else if mode.hasPrefix("extended-") {
                try extended(root, mode)
            } else if mode.hasPrefix("app-") {
                try appTransfer(root, mode)
            } else if mode == "send" || mode == "status" {
                try transfer(root, start: mode == "send")
            } else { throw ProbeError(description: "Unknown mode") }
        } catch {
            emit("error", ["message": String(describing: error)])
            exit(1)
        }
    }
    static func wallet(_ root: URL, _ role: String, _ network: String) throws -> Wallet {
        let net: BitcoinNetwork
        switch network {
        case "mutinynet": net = .signetCustom
        case "signet": net = .signet
        case "testnet": net = .testnet
        case "mainnet": net = .mainnet
        default: throw ProbeError(description: "Unsupported network")
        }
        let secret = root.appendingPathComponent("\(role)-test-only-mnemonic")
        if !FileManager.default.fileExists(atPath: secret.path) {
            let mnemonic = generateKeys(bitcoinNetwork: .signetCustom, witnessVersion: .taproot).mnemonic
            try Data(mnemonic.utf8).write(to: secret, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: secret.path)
        }
        let k = try restoreKeys(bitcoinNetwork: net, mnemonic: String(contentsOf: secret, encoding: .utf8), witnessVersion: .taproot)
        var folder = network == "mutinynet" ? "rgb-mutinynet-signetcustom" : network == "mainnet" ? "." : "rgb-\(network)"
        let configFile = root.appendingPathComponent("network-config.json")
        if FileManager.default.fileExists(atPath: configFile.path) {
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: configFile)) as! [String: String]
            guard let selected = config[network] else { throw ProbeError(description: "Missing app network folder") }
            folder = selected
        }
        let dir = root.appendingPathComponent(role).appendingPathComponent(folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Wallet(walletData: WalletData(dataDir: dir.path, bitcoinNetwork: net, databaseType: .sqlite, maxAllocationsPerUtxo: 5, supportedSchemas: net == .mainnet ? [.nia, .cfa, .uda] : [.nia, .cfa, .uda, .ifa]), keys: SinglesigKeys(accountXpubVanilla: k.accountXpubVanilla, accountXpubColored: k.accountXpubColored, vanillaKeychain: nil, masterFingerprint: k.masterFingerprint, mnemonic: k.mnemonic, witnessVersion: k.witnessVersion))
    }
    static func snapshot(_ w: Wallet) throws -> [String: Any] {
        let b = try w.getBtcBalance(online: nil, skipSync: true)
        let assets = try w.listAssets(filterAssetSchemas: [.nia])
        let transfers = try w.listTransfers(assetId: nil) + (assets.nia ?? []).flatMap { try w.listTransfers(assetId: $0.assetId) }
        return ["directory": w.getWalletDir(), "vanilla": b.vanilla.settled, "colored": b.colored.settled, "transfers": transfers.map { ["idx": $0.idx, "status": String(describing: $0.status), "txid": $0.txid ?? "", "recipientId": $0.recipientId ?? ""] as [String: Any] }, "assets": (assets.nia ?? []).map { ["id": $0.assetId, "settled": $0.balance.settled, "spendable": $0.balance.spendable] as [String: Any] }]
    }
    static func connectNetworks(_ root: URL) throws {
        let hosts = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("network-hosts.json"))) as! [String: [String: Any]]
        for network in ["mainnet", "signet", "testnet", "mutinynet"] {
            let endpoint = hosts[network]!["indexerUrl"] as! String
            emit("network-connecting", ["network": network, "indexer": endpoint])
            let w = try wallet(root, "alice", network)
            let online = try w.goOnline(onlineOptions: OnlineOptions(indexerUrl: endpoint, skipConsistencyCheck: false, vanillaSyncLookback: 20))
            let balance = try w.getBtcBalance(online: online, skipSync: false)
            if network != "mutinynet" {
                try check(balance.vanilla.settled == 0 && balance.colored.settled == 0, "Unexpected cross-network balance")
            }
            emit("network-connected", ["network": network, "indexer": endpoint, "vanilla": balance.vanilla.settled, "colored": balance.colored.settled])
        }
    }
    static func switches(_ root: URL) throws {
        var original: Wallet? = try wallet(root, "alice", "mutinynet")
        let before = try snapshot(original!)
        original = nil
        var dirs = Set([before["directory"] as! String])
        for network in ["mainnet", "signet", "testnet"] {
            var other: Wallet? = try wallet(root, "alice", network)
            let state = try snapshot(other!)
            try check(dirs.insert(state["directory"] as! String).inserted, "Networks share a directory")
            try check((state["assets"] as! [[String: Any]]).isEmpty, "Mutinynet assets leaked into another network")
            emit("network-isolated", state.merging(["network": network]) { a, _ in a })
            other = nil
        }
        let reopened = try wallet(root, "alice", "mutinynet")
        let after = try snapshot(reopened)
        let canonical: ([String: Any]) throws -> Data = { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
        try check(try canonical(before) == canonical(after), "Mutinynet state changed across network switch")
        emit("switch-pass", after)
    }
    static func appTransfer(_ root: URL, _ mode: String) throws {
        let invoiceFile = root.appendingPathComponent("app-invoice.json")
        let receiptFile = root.appendingPathComponent("app-transfer.json")
        let original = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("transfer.json"))) as! [String: Any]
        let assetId = original["assetId"] as! String
        let alice = try wallet(root, "alice", "mutinynet")
        let bob = try wallet(root, "bob", "mutinynet")
        if mode == "app-prepare" {
            if !FileManager.default.fileExists(atPath: invoiceFile.path) {
                let receive = try bob.witnessReceive(assetId: assetId, assignment: .fungible(amount: 25), expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600, transportEndpoints: [proxy], minConfirmations: 1)
                let decoded = try Invoice(invoiceString: receive.invoice).invoiceData()
                let payload: [String: Any] = ["invoice": receive.invoice, "decoded": Mappers.js(decoded).compactMapValues { $0 }, "assetId": assetId, "amount": 25]
                try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]).write(to: invoiceFile, options: [.atomic])
            }
            emit("app-invoice-ready")
            return
        }
        let aOnline = try alice.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        let bOnline = try bob.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        if mode == "app-send" {
            try check(!FileManager.default.fileExists(atPath: receiptFile.path), "App send already attempted; use app-status, never resend")
            let params = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("app-params.json"))) as! [String: Any]
            let a = Args(params)
            let map = try a.raw("recipientMap")
            var recipients: [String: [Recipient]] = [:]
            for id in map.keys { recipients[id] = try Args(map).objects(id).map { try Mappers.recipient($0) } }
            try check(recipients.count == 1 && recipients[assetId]?.count == 1 && recipients[assetId]![0].assignment == .fungible(amount: 25), "Unexpected live test transfer")
            try Data("{\"stage\":\"send-started\"}".utf8).write(to: receiptFile, options: [.atomic])
            let sent = try alice.send(online: aOnline, recipientMap: recipients, donation: a.bool("donation", false), feeRate: try a.u64("feeRate"), minConfirmations: try a.u8("minConfirmations"), expirationTimestamp: try a.u64("expirationTimestamp"))
            let result = Mappers.js(sent)
            try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]).write(to: receiptFile, options: [.atomic])
            emit("app-submitted", ["txid": sent.txid, "batchTransferIdx": sent.batchTransferIdx])
            return
        }
        try check(mode == "app-status", "Unknown app probe mode")
        _ = try bob.refresh(online: bOnline, assetId: nil, filter: [], skipSync: false)
        _ = try alice.refresh(online: aOnline, assetId: nil, filter: [], skipSync: false)
        let aTransfers = try alice.listTransfers(assetId: assetId)
        let bTransfers = try bob.listTransfers(assetId: assetId)
        let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: receiptFile)) as! [String: Any]
        let txid = receipt["txid"] as? String
        emit("app-transfers", ["txid": txid ?? "", "assetId": assetId, "alice": aTransfers.filter { $0.txid == txid }.map { String(describing: $0.status) }, "bob": bTransfers.filter { $0.txid == txid }.map { String(describing: $0.status) }])
        if aTransfers.contains(where: { $0.txid == txid && $0.status == .settled }) && bTransfers.contains(where: { $0.txid == txid && $0.status == .settled }) {
            let ab = try alice.getAssetBalance(assetId: assetId)
            let bb = try bob.getAssetBalance(assetId: assetId)
            try check(ab.settled == 875 && bb.settled == 125, "Unexpected app transfer balances")
            emit("app-transfer-pass", ["assetId": assetId, "alice": ab.settled, "bob": bb.settled, "txid": txid ?? ""])
        }
    }
    static func failureTests(_ root: URL) throws {
        let empty = try wallet(root, "empty", "mutinynet")
        let eo = try empty.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        do {
            _ = try empty.createUtxos(online: eo, upTo: true, num: 1, size: 1000, feeRate: 1, skipSync: false)
            throw ProbeError(description: "Empty wallet unexpectedly created outputs")
        } catch let e as RgbLibError {
            try check(Errors.code(e) == "ERR_RGB_INSUFFICIENT_BITCOINS", "Unexpected empty wallet error: \(Errors.code(e))")
            emit("insufficient-btc-pass", ["code": Errors.code(e)])
        }
        let disconnected = try wallet(root, "disconnected", "mutinynet")
        do {
            _ = try disconnected.goOnline(onlineOptions: OnlineOptions(indexerUrl: "http://127.0.0.1:1", skipConsistencyCheck: false, vanillaSyncLookback: 20))
            throw ProbeError(description: "Unavailable indexer unexpectedly connected")
        } catch let e as RgbLibError {
            emit("unavailable-indexer-pass", ["code": Errors.code(e), "message": Errors.message(e)])
        }
        let bob = try wallet(root, "bob", "mutinynet")
        let bo = try bob.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        let asset = (try bob.listAssets(filterAssetSchemas: [.nia])).nia![0].assetId
        let alice = try wallet(root, "alice", "mutinynet")
        let badProxy = "rpc://127.0.0.1:1/json-rpc"
        let invoice = try alice.witnessReceive(assetId: asset, assignment: .fungible(amount: 1), expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600, transportEndpoints: [badProxy], minConfirmations: 1)
        let before = try bob.listTransfers(assetId: asset).filter { $0.kind == .send }.count
        let balance = try bob.getAssetBalance(assetId: asset)
        do {
            _ = try bob.send(online: bo, recipientMap: [asset: [Recipient(recipientId: invoice.recipientId, witnessData: WitnessData(amountSat: 1000, blinding: nil), assignment: .fungible(amount: 1), transportEndpoints: [badProxy])]], donation: false, feeRate: 1, minConfirmations: 1, expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600)
            throw ProbeError(description: "Unavailable proxy unexpectedly accepted transfer")
        } catch let e as RgbLibError {
            try check(Errors.code(e).contains("TRANSPORT"), "Unexpected unavailable proxy error: \(Errors.code(e))")
            try check(try bob.listTransfers(assetId: asset).filter { $0.kind == .send }.count == before, "Failed proxy left a send behind")
            let after = try bob.getAssetBalance(assetId: asset)
            try check(after.settled == balance.settled && after.spendable == balance.spendable, "Failed proxy changed asset balance")
            emit("unavailable-proxy-pass", ["code": Errors.code(e), "message": Errors.message(e), "balance": after.settled])
        }
    }
    static func backupProbe(_ root: URL, _ mode: String) throws {
        let request = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("backup-request.json"))) as! [String: String]
        let file = request["path"]!
        let password = request["password"]!
        if mode == "backup-export" {
            let source = try wallet(root, "bob", "mutinynet")
            try source.backup(backupPath: file, password: password)
            var state = try snapshot(source)
            state.removeValue(forKey: "directory")
            try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]).write(to: root.appendingPathComponent("backup-expected.json"), options: [.atomic])
            emit("native-backup-exported")
            return
        }
        let target = URL(fileURLWithPath: request["target"]!)
        let dir = target.appendingPathComponent("bob/rgb-mutinynet-signetcustom")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try restoreBackup(backupPath: file, password: password, dataDir: dir.path)
        let restored = try wallet(target, "bob", "mutinynet")
        var state = try snapshot(restored)
        state.removeValue(forKey: "directory")
        let expected = try Data(contentsOf: root.appendingPathComponent("backup-expected.json"))
        try check(try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) == expected, "Restored balances/history differ")
        let online = try restored.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        _ = try restored.refresh(online: online, assetId: nil, filter: [], skipSync: false)
        emit("native-backup-restore-pass", ["state": state])
    }
    static func extended(_ root: URL, _ mode: String) throws {
        let original = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("transfer.json"))) as! [String: Any]
        let asset = original["assetId"] as! String
        let receiptFile = root.appendingPathComponent("reverse-transfer.json")
        if mode == "extended-invalid-invoices" {
            let originalInvoice = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("reverse-invoice.json"))) as! [String: Any]
            let expired = (originalInvoice["invoice"] as! String).replacingOccurrences(of: "expiry=[0-9]+", with: "expiry=1", options: .regularExpression)
            let signet = try wallet(root, "alice", "signet")
            let foreign = try signet.witnessReceive(assetId: nil, assignment: .fungible(amount: 25), expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600, transportEndpoints: [proxy], minConfirmations: 1)
            let fixtures = try [expired, foreign.invoice].map { invoice in
                ["invoice": invoice, "decoded": Mappers.js(try Invoice(invoiceString: invoice).invoiceData()).compactMapValues { $0 }] as [String: Any]
            }
            try JSONSerialization.data(withJSONObject: fixtures).write(to: root.appendingPathComponent("invalid-invoices.json"), options: [.atomic])
            emit("native-invalid-invoices-decoded")
            return
        }
        if mode == "extended-prepare" {
            let alice = try wallet(root, "alice", "mutinynet")
            let file = root.appendingPathComponent("reverse-invoice.json")
            try check(!FileManager.default.fileExists(atPath: file.path), "Reverse invoice already exists")
            let receive = try alice.witnessReceive(assetId: asset, assignment: .fungible(amount: 25), expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 7200, transportEndpoints: [proxy], minConfirmations: 1)
            let decoded = try Invoice(invoiceString: receive.invoice).invoiceData()
            try JSONSerialization.data(withJSONObject: ["invoice": receive.invoice, "decoded": Mappers.js(decoded).compactMapValues { $0 }, "assetId": asset, "amount": 25], options: [.sortedKeys]).write(to: file, options: [.atomic])
            emit("reverse-invoice-ready")
            return
        }
        var bob: Wallet? = try wallet(root, "bob", "mutinynet")
        let online = try bob!.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        if mode == "extended-send" {
            try check(!FileManager.default.fileExists(atPath: receiptFile.path), "Reverse send already attempted; never resend")
            let params = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("reverse-params.json"))) as! [String: Any]
            let a = Args(params)
            let map = try a.raw("recipientMap")
            var recipients: [String: [Recipient]] = [:]
            for id in map.keys { recipients[id] = try Args(map).objects(id).map { try Mappers.recipient($0) } }
            try check(recipients.count == 1 && recipients[asset]?.count == 1 && recipients[asset]![0].assignment == .fungible(amount: 25), "Unexpected reverse amount")
            // Dry-run first: insufficient BTC must not leave a pending transfer.
            do {
                _ = try bob!.sendBegin(online: online, recipientMap: recipients, donation: false, feeRate: 1, minConfirmations: 1, expirationTimestamp: try a.u64("expirationTimestamp"), dryRun: true)
                emit("reverse-dry-run-pass")
            } catch {
                emit("reverse-dry-run-error", ["message": String(describing: error), "balance": try snapshot(bob!)])
                throw error
            }
            try Data("{\"stage\":\"send-started\"}".utf8).write(to: receiptFile, options: [.atomic])
            let sent = try bob!.send(online: online, recipientMap: recipients, donation: false, feeRate: 1, minConfirmations: 1, expirationTimestamp: try a.u64("expirationTimestamp"))
            try JSONSerialization.data(withJSONObject: Mappers.js(sent), options: [.sortedKeys]).write(to: receiptFile, options: [.atomic])
            emit("reverse-submitted-recipient-offline", ["txid": sent.txid])
            return
        }
        if mode == "extended-utxos" {
            let result = try bob!.createUtxos(online: online, upTo: true, num: 3, size: 1000, feeRate: 1, skipSync: false)
            emit("bob-utxos-ready", ["created": result])
            return
        }
        if mode == "extended-fund" {
            let file = root.appendingPathComponent("bob-funding.json")
            try check(!FileManager.default.fileExists(atPath: file.path), "Funding already attempted")
            let address = try bob!.getAddress()
            let alice = try wallet(root, "alice", "mutinynet")
            let ao = try alice.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
            try Data("{}".utf8).write(to: file, options: [.atomic])
            let txid = try alice.sendBtc(online: ao, address: address, amount: 20000, feeRate: 1, skipSync: false)
            try JSONSerialization.data(withJSONObject: ["txid": txid]).write(to: file, options: [.atomic])
            emit("bob-funded-test-btc", ["txid": txid, "amount": 20000])
            return
        }
        let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: receiptFile)) as! [String: Any]
        let txid = receipt["txid"] as! String
        if mode == "extended-offline" {
            _ = try bob!.refresh(online: online, assetId: nil, filter: [], skipSync: false)
            let pending = try bob!.listTransfers(assetId: asset).filter { $0.txid == txid }
            try check(pending.count == 1 && pending[0].status == .waitingCounterparty, "Recipient offline should remain waiting counterparty")
            let before = try snapshot(bob!)
            bob = nil
            for network in ["mainnet", "signet", "testnet"] {
                let other = try wallet(root, "bob", network)
                try check((try snapshot(other)["assets"] as! [[String: Any]]).isEmpty, "Pending asset leaked across networks")
            }
            bob = try wallet(root, "bob", "mutinynet")
            let canonical: ([String: Any]) throws -> Data = { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
            try check(try canonical(before) == canonical(snapshot(bob!)), "Pending transfer changed across restart/network switch")
            emit("offline-restart-network-pass", ["txid": txid, "state": before])
            return
        }
        try check(mode == "extended-status", "Unknown extended mode")
        let alice = try wallet(root, "alice", "mutinynet")
        let ao = try alice.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        _ = try alice.refresh(online: ao, assetId: nil, filter: [], skipSync: false)
        _ = try bob!.refresh(online: online, assetId: nil, filter: [], skipSync: false)
        let at = try alice.listTransfers(assetId: asset).filter { $0.txid == txid }
        let bt = try bob!.listTransfers(assetId: asset).filter { $0.txid == txid }
        emit("reverse-status", ["txid": txid, "assetId": asset, "alice": at.map { String(describing: $0.status) }, "bob": bt.map { String(describing: $0.status) }])
        if at.contains(where: { $0.status == .settled }) && bt.contains(where: { $0.status == .settled }) {
            let ab = try alice.getAssetBalance(assetId: asset)
            let bb = try bob!.getAssetBalance(assetId: asset)
            try check(ab.settled == 900 && bb.settled == 100 && at.count == 1 && bt.count == 1, "Incorrect balances or duplicate reverse transfer")
            emit("reverse-pass", ["txid": txid, "alice": ab.settled, "bob": bb.settled])
        }
    }
    static func transfer(_ root: URL, start: Bool) throws {
        let alice = try wallet(root, "alice", "mutinynet")
        let bob = try wallet(root, "bob", "mutinynet")
        emit("connecting", ["indexer": indexer])
        let aOnline = try alice.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        let bOnline = try bob.goOnline(onlineOptions: OnlineOptions(indexerUrl: indexer, skipConsistencyCheck: false, vanillaSyncLookback: 20))
        let balance = try alice.getBtcBalance(online: aOnline, skipSync: false)
        emit("funding", ["spendable": balance.vanilla.spendable, "settled": balance.vanilla.settled])
        let receiptFile = root.appendingPathComponent("transfer.json")
        if start && !FileManager.default.fileExists(atPath: receiptFile.path) {
            try check(balance.vanilla.spendable >= 10000, "FUNDING_REQUIRED: fund the prepared Alice address with 100000 Mutinynet sats")
            _ = try alice.createUtxos(online: aOnline, upTo: true, num: 3, size: 1000, feeRate: 1, skipSync: false)
            let asset = try alice.issueAssetNia(ticker: "RATEQA", name: "Rate Mutinynet E2E", precision: 0, amounts: [1000])
            let receive = try bob.witnessReceive(assetId: nil, assignment: .fungible(amount: 100), expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600, transportEndpoints: [proxy], minConfirmations: 1)
            let recipient = Recipient(recipientId: receive.recipientId, witnessData: WitnessData(amountSat: 1000, blinding: nil), assignment: .fungible(amount: 100), transportEndpoints: [proxy])
            // Persist intent before the non-idempotent send; never auto-retry it.
            var receipt: [String: Any] = ["assetId": asset.assetId, "recipientId": receive.recipientId, "amount": 100, "stage": "send-started"]
            try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(to: receiptFile, options: [.atomic])
            let sent = try alice.send(online: aOnline, recipientMap: [asset.assetId: [recipient]], donation: false, feeRate: 1, minConfirmations: 1, expirationTimestamp: UInt64(Date().timeIntervalSince1970) + 3600)
            receipt["txid"] = sent.txid
            receipt["stage"] = "submitted"
            try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(to: receiptFile, options: [.atomic])
            emit("submitted", receipt)
        }
        if !FileManager.default.fileExists(atPath: receiptFile.path) { return }
        let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: receiptFile)) as! [String: Any]
        let assetId = receipt["assetId"] as! String
        // Each invocation advances both ends once, so retries never resend funds.
        let bUpdated = try bob.refresh(online: bOnline, assetId: nil, filter: [], skipSync: false)
        let aUpdated = try alice.refresh(online: aOnline, assetId: nil, filter: [], skipSync: false)
        emit("refreshed", ["alice": aUpdated.count, "bob": bUpdated.count])
        let aTransfers = try alice.listTransfers(assetId: assetId)
        let bTransfers = (try? bob.listTransfers(assetId: assetId)) ?? []
        let a = aTransfers.filter { $0.kind == .send }
        emit("transfers", ["alice": a.map { ["status": String(describing: $0.status), "txid": $0.txid ?? ""] }, "bob": bTransfers.map { ["status": String(describing: $0.status), "txid": $0.txid ?? ""] }])
        if a.contains(where: { $0.status == .settled }) && bTransfers.contains(where: { $0.status == .settled }) {
            let ab = try alice.getAssetBalance(assetId: assetId)
            let bb = try bob.getAssetBalance(assetId: assetId)
            try check(ab.settled == 900 && bb.settled == 100, "Unexpected final asset balances")
            emit("transfer-pass", ["assetId": assetId, "alice": ab.settled, "bob": bb.settled, "txid": receipt["txid"] ?? ""])
        }
    }
}
