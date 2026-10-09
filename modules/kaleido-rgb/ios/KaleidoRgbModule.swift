import ExpoModulesCore
import Foundation

let rgbLibVersion = "0.3.0-beta.7"

struct NotOnline: Error {}

/// One open rgb-lib wallet. rgb-lib blocks and keeps one SQLite database per
/// wallet, so every call on it runs on this wallet's own serial queue, in call order.
final class Session {
  let wallet: Wallet
  var online: Online?
  let queue: DispatchQueue

  init(wallet: Wallet, handle: Int) {
    self.wallet = wallet
    self.queue = DispatchQueue(label: "com.kaleidoswap.rgb.wallet.\(handle)", qos: .userInitiated)
  }

  func requireOnline() throws -> Online {
    guard let online = online else { throw NotOnline() }
    return online
  }
}

final class WalletSessions {
  private var sessions: [Int: Session] = [:]
  private var nextHandle = 1
  private let lock = NSLock()

  func add(_ wallet: Wallet) -> Int {
    lock.lock(); defer { lock.unlock() }
    let handle = nextHandle
    nextHandle += 1
    sessions[handle] = Session(wallet: wallet, handle: handle)
    return handle
  }

  func get(_ handle: Int) -> Session? {
    lock.lock(); defer { lock.unlock() }
    return sessions[handle]
  }

  func remove(_ handle: Int) -> Session? {
    lock.lock(); defer { lock.unlock() }
    return sessions.removeValue(forKey: handle)
  }
}

/// nil → NSNull, recursively, so results cross to JS as plain objects.
func plain(_ value: Any?) -> Any {
  guard let value = value else { return NSNull() }
  if let dict = value as? [String: Any?] {
    var out: [String: Any] = [:]
    for (k, v) in dict { out[k] = plain(v) }
    return out
  }
  if let list = value as? [Any?] { return list.map { plain($0) } }
  return value
}

/// Resolves with the result, or rejects with a stable code: `ERR_RGB_<RGB_LIB_ERROR>` for rgb-lib's own.
func settle(_ promise: Promise, _ body: () throws -> Any?) {
  do {
    promise.resolve(plain(try body()))
  } catch let e as RgbLibError {
    promise.reject(Errors.code(e), Errors.message(e))
  } catch let e as InvalidArgument {
    promise.reject("ERR_RGB_INVALID_ARGUMENT", e.description)
  } catch is NotOnline {
    promise.reject("ERR_RGB_NOT_ONLINE", "The RGB wallet is not online: call goOnline first")
  } catch {
    promise.reject("ERR_RGB_NATIVE", error.localizedDescription)
  }
}

/// rgb-lib (RGB-Tools' official Swift bindings) for the app. Every call takes a
/// plain object of arguments; wallet calls take the handle `openWallet` returned
/// first and run on that wallet's own queue (see Session).
public class KaleidoRgbModule: Module {
  private let sessions = WalletSessions()
  // Opening, restoring and moving wallet folders: one at a time, off the JS thread.
  private let files = DispatchQueue(label: "com.kaleidoswap.rgb.files", qos: .userInitiated)

  private func onFiles(_ promise: Promise, _ body: @escaping () throws -> Any?) {
    files.async { settle(promise, body) }
  }

  private func walletOp(_ name: String, _ body: @escaping (Session, Args) throws -> Any?) -> AnyDefinition {
    return AsyncFunction(name) { [weak self] (handle: Int, args: [String: Any], promise: Promise) in
      guard let session = self?.sessions.get(handle) else {
        promise.reject("ERR_RGB_WALLET_NOT_FOUND", "No open RGB wallet with handle \(handle)")
        return
      }
      session.queue.async { settle(promise) { try body(session, Args(args)) } }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("KaleidoRgb")

    Function("rgbLibVersion") { rgbLibVersion }

    AsyncFunction("generateKeys") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        return Mappers.js(generateKeys(bitcoinNetwork: try Mappers.network(try a.string("network")), witnessVersion: try Mappers.witnessVersion(a.stringOrNil("witnessVersion"))))
      }
    }

    AsyncFunction("restoreKeys") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        return Mappers.js(try restoreKeys(bitcoinNetwork: try Mappers.network(try a.string("network")), mnemonic: try a.string("mnemonic"), witnessVersion: try Mappers.witnessVersion(a.stringOrNil("witnessVersion"))))
      }
    }

    AsyncFunction("decodeInvoice") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) { Mappers.js(try Invoice(invoiceString: try Args(args).string("invoice")).invoiceData()) }
    }

    AsyncFunction("dataDir") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) { try DataDirs.dataDir(Args(args).stringOrNil("subdir")).path }
    }

    AsyncFunction("walletDirState") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        return DataDirs.state(try DataDirs.walletDir(a.stringOrNil("subdir"), try a.string("masterFingerprint")))
      }
    }

    AsyncFunction("moveAsideLegacyBdkCache") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        return try DataDirs.moveAsideLegacyBdkCache(try DataDirs.walletDir(a.stringOrNil("subdir"), try a.string("masterFingerprint")))
      }
    }

    AsyncFunction("restoreBackup") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        try restoreBackup(backupPath: try a.string("backupPath"), password: try a.string("password"), dataDir: try DataDirs.dataDir(a.stringOrNil("subdir")).path)
        return nil
      }
    }

    AsyncFunction("openWallet") { (args: [String: Any], promise: Promise) in
      self.onFiles(promise) {
        let a = Args(args)
        let k = try a.obj("keys")
        let keys = SinglesigKeys(
          accountXpubVanilla: try k.string("accountXpubVanilla"),
          accountXpubColored: try k.string("accountXpubColored"),
          vanillaKeychain: try k.u8OrNil("vanillaKeychain"),
          masterFingerprint: try k.string("masterFingerprint"),
          mnemonic: k.stringOrNil("mnemonic"),
          witnessVersion: try Mappers.witnessVersion(k.stringOrNil("witnessVersion"))
        )
        let data = WalletData(
          dataDir: try DataDirs.dataDir(a.stringOrNil("subdir")).path,
          bitcoinNetwork: try Mappers.network(try a.string("network")),
          databaseType: .sqlite,
          maxAllocationsPerUtxo: try a.u32("maxAllocationsPerUtxo"),
          supportedSchemas: try a.strings("supportedSchemas").map { try Mappers.schema($0) }
        )
        return self.sessions.add(try Wallet(walletData: data, keys: keys))
      }
    }

    AsyncFunction("closeWallet") { (handle: Int, promise: Promise) in
      guard let session = self.sessions.remove(handle) else {
        promise.resolve(nil)
        return
      }
      // Dropping the last reference frees the native wallet once queued calls finish.
      session.queue.async {
        session.online = nil
        promise.resolve(nil)
      }
    }

    walletOp("goOnline") { s, a in
      s.online = try s.wallet.goOnline(onlineOptions: OnlineOptions(
        indexerUrl: try a.string("indexerUrl"),
        skipConsistencyCheck: a.bool("skipConsistencyCheck", false),
        vanillaSyncLookback: try a.u32("vanillaSyncLookback")
      ))
      return nil
    }
    walletOp("getBtcBalance") { s, a in Mappers.js(try s.wallet.getBtcBalance(online: s.online, skipSync: a.bool("skipSync", false))) }
    walletOp("getAddress") { s, _ in try s.wallet.getAddress() }
    walletOp("refresh") { s, a in
      Mappers.js(try s.wallet.refresh(online: try s.requireOnline(), assetId: a.stringOrNil("assetId"), filter: try a.objects("filter").map { try Mappers.refreshFilter($0) }, skipSync: a.bool("skipSync", false)))
    }
    walletOp("sync") { s, a in
      try s.wallet.sync(online: try s.requireOnline(), options: try Mappers.syncOptions(a))
      return nil
    }
    walletOp("listAssets") { s, a in Mappers.js(try s.wallet.listAssets(filterAssetSchemas: try a.strings("schemas").map { try Mappers.schema($0) })) }
    walletOp("getAssetBalance") { s, a in Mappers.js(try s.wallet.getAssetBalance(assetId: try a.string("assetId"))) }
    walletOp("getAssetMetadata") { s, a in Mappers.js(try s.wallet.getAssetMetadata(assetId: try a.string("assetId"))) }
    walletOp("getMediaDir") { s, _ in s.wallet.getMediaDir() }
    walletOp("getWalletDir") { s, _ in s.wallet.getWalletDir() }
    walletOp("blindReceive") { s, a in
      Mappers.js(try s.wallet.blindReceive(assetId: a.stringOrNil("assetId"), assignment: try Mappers.assignment(try a.obj("assignment")), expirationTimestamp: try a.u64("expirationTimestamp"), transportEndpoints: try a.strings("transportEndpoints"), minConfirmations: try a.u8("minConfirmations")))
    }
    walletOp("witnessReceive") { s, a in
      Mappers.js(try s.wallet.witnessReceive(assetId: a.stringOrNil("assetId"), assignment: try Mappers.assignment(try a.obj("assignment")), expirationTimestamp: try a.u64("expirationTimestamp"), transportEndpoints: try a.strings("transportEndpoints"), minConfirmations: try a.u8("minConfirmations")))
    }
    walletOp("send") { s, a in
      let map = try a.raw("recipientMap")
      var recipients: [String: [Recipient]] = [:]
      for assetId in map.keys { recipients[assetId] = try Args(map).objects(assetId).map { try Mappers.recipient($0) } }
      return Mappers.js(try s.wallet.send(online: try s.requireOnline(), recipientMap: recipients, donation: a.bool("donation", false), feeRate: try a.u64("feeRate"), minConfirmations: try a.u8("minConfirmations"), expirationTimestamp: try a.u64("expirationTimestamp")))
    }
    walletOp("sendBtc") { s, a in
      try s.wallet.sendBtc(online: try s.requireOnline(), address: try a.string("address"), amount: try a.u64("amount"), feeRate: try a.u64("feeRate"), skipSync: a.bool("skipSync", false))
    }
    walletOp("drainTo") { s, a in try s.wallet.drainTo(online: try s.requireOnline(), address: try a.string("address"), feeRate: try a.u64("feeRate")) }
    walletOp("listTransactions") { s, a in try s.wallet.listTransactions(online: s.online, skipSync: a.bool("skipSync", false)).map { Mappers.js($0) } }
    walletOp("listTransfers") { s, a in try s.wallet.listTransfers(assetId: a.stringOrNil("assetId")).map { Mappers.js($0) } }
    walletOp("listUnspents") { s, a in
      try s.wallet.listUnspents(online: s.online, settledOnly: a.bool("settledOnly", false), skipSync: a.bool("skipSync", false)).map { Mappers.js($0) }
    }
    walletOp("createUtxos") { s, a in
      Int(try s.wallet.createUtxos(online: try s.requireOnline(), upTo: a.bool("upTo", true), num: try a.u8OrNil("num"), size: try a.u32OrNil("size"), feeRate: try a.u64("feeRate"), skipSync: a.bool("skipSync", false)))
    }
    walletOp("failTransfers") { s, a in
      try s.wallet.failTransfers(online: try s.requireOnline(), batchTransferIdx: a.i32OrNil("batchTransferIdx"), noAssetOnly: a.bool("noAssetOnly", false), skipSync: a.bool("skipSync", false))
    }
    walletOp("deleteTransfers") { s, a in try s.wallet.deleteTransfers(batchTransferIdx: a.i32OrNil("batchTransferIdx"), noAssetOnly: a.bool("noAssetOnly", false)) }
    walletOp("signPsbt") { s, a in try s.wallet.signPsbt(unsignedPsbt: try a.string("psbt")) }
    walletOp("issueAssetNia") { s, a in
      Mappers.js(try s.wallet.issueAssetNia(ticker: try a.string("ticker"), name: try a.string("name"), precision: try a.u8("precision"), amounts: try a.u64s("amounts")))
    }
    walletOp("issueAssetCfa") { s, a in
      Mappers.js(try s.wallet.issueAssetCfa(name: try a.string("name"), details: a.stringOrNil("details"), precision: try a.u8("precision"), amounts: try a.u64s("amounts"), filePath: a.stringOrNil("filePath")))
    }
    walletOp("issueAssetUda") { s, a in
      Mappers.js(try s.wallet.issueAssetUda(ticker: try a.string("ticker"), name: try a.string("name"), details: a.stringOrNil("details"), precision: try a.u8("precision"), mediaFilePath: a.stringOrNil("mediaFilePath"), attachmentsFilePaths: try a.strings("attachmentsFilePaths")))
    }
    walletOp("issueAssetIfa") { s, a in
      Mappers.js(try s.wallet.issueAssetIfa(ticker: try a.string("ticker"), name: try a.string("name"), precision: try a.u8("precision"), amounts: try a.u64s("amounts"), inflationAmounts: try a.u64s("inflationAmounts"), rejectListUrl: a.stringOrNil("rejectListUrl")))
    }
    walletOp("inflate") { s, a in
      Mappers.js(try s.wallet.inflate(online: try s.requireOnline(), assetId: try a.string("assetId"), inflationAmounts: try a.u64s("inflationAmounts"), feeRate: try a.u64("feeRate"), minConfirmations: try a.u8("minConfirmations")))
    }
    walletOp("burn") { s, a in
      Mappers.js(try s.wallet.burn(online: try s.requireOnline(), assetId: try a.string("assetId"), amount: try a.u64("amount"), feeRate: try a.u64("feeRate"), minConfirmations: try a.u8("minConfirmations")))
    }
    walletOp("backup") { s, a in
      try s.wallet.backup(backupPath: try a.string("backupPath"), password: try a.string("password"))
      return nil
    }
    walletOp("backupInfo") { s, _ in try s.wallet.backupInfo() }
    walletOp("getFeeEstimation") { s, a in try s.wallet.getFeeEstimation(online: try s.requireOnline(), blocks: try a.u16("blocks")) }
  }
}
