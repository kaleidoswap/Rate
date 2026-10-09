import Foundation

struct InvalidArgument: Error, CustomStringConvertible {
  let description: String
}

/// Typed reads from the plain JS object every call receives.
struct Args {
  let map: [String: Any]

  init(_ map: [String: Any]) { self.map = map }

  private func value(_ key: String) -> Any? {
    guard let v = map[key], !(v is NSNull) else { return nil }
    return v
  }

  func has(_ key: String) -> Bool { value(key) != nil }

  func string(_ key: String) throws -> String {
    guard let s = value(key) as? String else { throw InvalidArgument(description: "\(key) must be a string") }
    return s
  }

  func stringOrNil(_ key: String) -> String? { value(key) as? String }

  func bool(_ key: String, _ fallback: Bool) -> Bool { (value(key) as? NSNumber)?.boolValue ?? fallback }

  func number(_ key: String) throws -> Double {
    guard let n = value(key) as? NSNumber else { throw InvalidArgument(description: "\(key) must be a number") }
    return n.doubleValue
  }

  private func whole(_ key: String, _ n: Double, max: Double) throws -> Double {
    guard n >= 0, n == n.rounded(), n <= max else { throw InvalidArgument(description: "\(key) must be a whole number from 0 to \(max)") }
    return n
  }

  func u64(_ key: String) throws -> UInt64 { UInt64(try whole(key, try number(key), max: 9_007_199_254_740_991)) }
  func u64OrNil(_ key: String) throws -> UInt64? { has(key) ? try u64(key) : nil }
  func u32(_ key: String) throws -> UInt32 { UInt32(try whole(key, try number(key), max: Double(UInt32.max))) }
  func u32OrNil(_ key: String) throws -> UInt32? { has(key) ? try u32(key) : nil }
  func u16(_ key: String) throws -> UInt16 { UInt16(try whole(key, try number(key), max: Double(UInt16.max))) }
  func u8(_ key: String) throws -> UInt8 { UInt8(try whole(key, try number(key), max: 255)) }
  func u8OrNil(_ key: String) throws -> UInt8? { has(key) ? try u8(key) : nil }
  func i32OrNil(_ key: String) -> Int32? { (value(key) as? NSNumber).map { Int32(truncating: $0) } }

  func strings(_ key: String) throws -> [String] {
    guard let list = value(key) else { return [] }
    guard let strings = list as? [String] else { throw InvalidArgument(description: "\(key) must hold strings") }
    return strings
  }

  func u64s(_ key: String) throws -> [UInt64] {
    guard let list = value(key) else { return [] }
    guard let numbers = list as? [NSNumber] else { throw InvalidArgument(description: "\(key) must hold numbers") }
    return try numbers.map { UInt64(try whole(key, $0.doubleValue, max: 9_007_199_254_740_991)) }
  }

  func obj(_ key: String) throws -> Args {
    guard let o = value(key) as? [String: Any] else { throw InvalidArgument(description: "\(key) must be an object") }
    return Args(o)
  }

  func objOrNil(_ key: String) -> Args? { (value(key) as? [String: Any]).map { Args($0) } }

  func objects(_ key: String) throws -> [Args] {
    guard let list = value(key) else { return [] }
    guard let objects = list as? [[String: Any]] else { throw InvalidArgument(description: "\(key) must hold objects") }
    return objects.map { Args($0) }
  }

  func raw(_ key: String) throws -> [String: Any] {
    guard let o = value(key) as? [String: Any] else { throw InvalidArgument(description: "\(key) must be an object") }
    return o
  }
}

enum Mappers {
  static func network(_ value: String) throws -> BitcoinNetwork {
    switch value {
    case "MAINNET": return .mainnet
    case "TESTNET": return .testnet
    case "TESTNET4": return .testnet4
    case "SIGNET": return .signet
    case "REGTEST": return .regtest
    case "SIGNET_CUSTOM": return .signetCustom
    default: throw InvalidArgument(description: "Unknown bitcoin network: \(value)")
    }
  }

  static func networkName(_ n: BitcoinNetwork) -> String {
    switch n {
    case .mainnet: return "MAINNET"
    case .testnet: return "TESTNET"
    case .testnet4: return "TESTNET4"
    case .signet: return "SIGNET"
    case .regtest: return "REGTEST"
    case .signetCustom: return "SIGNET_CUSTOM"
    }
  }

  static func schema(_ value: String) throws -> AssetSchema {
    switch value {
    case "NIA": return .nia
    case "UDA": return .uda
    case "CFA": return .cfa
    case "IFA": return .ifa
    default: throw InvalidArgument(description: "Unknown asset schema: \(value)")
    }
  }

  static func schemaName(_ s: AssetSchema) -> String {
    switch s {
    case .nia: return "NIA"
    case .uda: return "UDA"
    case .cfa: return "CFA"
    case .ifa: return "IFA"
    }
  }

  static func witnessVersion(_ value: String?) throws -> WitnessVersion {
    switch value {
    case nil, "TAPROOT": return .taproot
    case "SEG_WIT_V0": return .segWitV0
    default: throw InvalidArgument(description: "Unknown witness version: \(value ?? "")")
    }
  }

  static func witnessVersionName(_ w: WitnessVersion) -> String {
    switch w {
    case .taproot: return "TAPROOT"
    case .segWitV0: return "SEG_WIT_V0"
    }
  }

  static func assignment(_ a: Args) throws -> Assignment {
    let type = try a.string("type")
    switch type {
    case "FUNGIBLE": return .fungible(amount: try a.u64("amount"))
    case "NON_FUNGIBLE": return .nonFungible
    case "INFLATION_RIGHT": return .inflationRight(amount: try a.u64("amount"))
    case "ANY": return .any
    default: throw InvalidArgument(description: "Unknown assignment type: \(type)")
    }
  }

  static func recipient(_ r: Args) throws -> Recipient {
    let witness = try r.objOrNil("witnessData").map { WitnessData(amountSat: try $0.u64("amountSat"), blinding: try $0.u64OrNil("blinding")) }
    return Recipient(
      recipientId: try r.string("recipientId"),
      witnessData: witness,
      assignment: try assignment(try r.obj("assignment")),
      transportEndpoints: try r.strings("transportEndpoints")
    )
  }

  static func refreshFilter(_ f: Args) throws -> RefreshFilter {
    let status: RefreshTransferStatus
    switch try f.string("status") {
    case "WAITING_COUNTERPARTY": status = .waitingCounterparty
    case "WAITING_SAFE_HEIGHT": status = .waitingSafeHeight
    case "WAITING_BROADCAST": status = .waitingBroadcast
    case "WAITING_CONFIRMATIONS": status = .waitingConfirmations
    default: throw InvalidArgument(description: "Unknown refresh status")
    }
    return RefreshFilter(status: status, incoming: f.bool("incoming", false))
  }

  static func syncOptions(_ a: Args) throws -> SyncOptions {
    let keychain: SyncKeychain
    switch try a.string("keychain") {
    case "COLORED": keychain = .colored
    case "VANILLA": keychain = .vanilla(lookback: try a.u32("lookback"))
    default: throw InvalidArgument(description: "Unknown keychain")
    }
    let strategy: SyncStrategy
    switch try a.string("strategy") {
    case "FULL_SCAN": strategy = .fullScan
    case "FULL_SYNC": strategy = .fullSync
    case "FAST_SYNC": strategy = .fastSync
    default: throw InvalidArgument(description: "Unknown sync strategy")
    }
    return SyncOptions(keychain: keychain, strategy: strategy)
  }

  static func js(_ a: Assignment) -> [String: Any?] {
    switch a {
    case .fungible(let amount): return ["type": "FUNGIBLE", "amount": Double(amount)]
    case .nonFungible: return ["type": "NON_FUNGIBLE"]
    case .inflationRight(let amount): return ["type": "INFLATION_RIGHT", "amount": Double(amount)]
    case .any: return ["type": "ANY"]
    }
  }

  static func js(_ k: Keys) -> [String: Any?] {
    return [
      "mnemonic": k.mnemonic, "xpub": k.xpub, "accountXpubVanilla": k.accountXpubVanilla,
      "accountXpubColored": k.accountXpubColored, "masterFingerprint": k.masterFingerprint,
      "witnessVersion": witnessVersionName(k.witnessVersion),
    ]
  }

  static func js(_ b: Balance) -> [String: Any?] {
    return ["settled": Double(b.settled), "future": Double(b.future), "spendable": Double(b.spendable)]
  }

  static func js(_ b: BtcBalance) -> [String: Any?] { ["vanilla": js(b.vanilla), "colored": js(b.colored)] }

  static func js(_ m: Media?) -> [String: Any?]? {
    guard let m = m else { return nil }
    return ["filePath": m.filePath, "digest": m.digest, "mime": m.mime]
  }

  private static func attachments(_ a: [UInt8: Media]) -> [String: Any?] {
    var out: [String: Any?] = [:]
    for (k, v) in a { out[String(k)] = js(v) }
    return out
  }

  static func js(_ t: TokenLight?) -> [String: Any?]? {
    guard let t = t else { return nil }
    return [
      "index": Double(t.index), "ticker": t.ticker, "name": t.name, "details": t.details,
      "embeddedMedia": t.embeddedMedia, "media": js(t.media), "attachments": attachments(t.attachments), "reserves": t.reserves,
    ]
  }

  static func js(_ t: Token?) -> [String: Any?]? {
    guard let t = t else { return nil }
    let embedded: [String: Any?]? = t.embeddedMedia.map { ["mime": $0.mime, "data": $0.data.map { Int($0) }] }
    return [
      "index": Double(t.index), "ticker": t.ticker, "name": t.name, "details": t.details,
      "embeddedMedia": embedded, "media": js(t.media), "attachments": attachments(t.attachments), "reserves": t.reserves != nil,
    ]
  }

  static func js(_ a: AssetNia) -> [String: Any?] {
    return [
      "assetId": a.assetId, "ticker": a.ticker, "name": a.name, "details": a.details, "precision": Int(a.precision),
      "issuedSupply": Double(a.issuedSupply), "timestamp": Double(a.timestamp), "addedAt": Double(a.addedAt),
      "balance": js(a.balance), "media": js(a.media),
    ]
  }

  static func js(_ a: AssetCfa) -> [String: Any?] {
    return [
      "assetId": a.assetId, "name": a.name, "details": a.details, "precision": Int(a.precision),
      "issuedSupply": Double(a.issuedSupply), "timestamp": Double(a.timestamp), "addedAt": Double(a.addedAt),
      "balance": js(a.balance), "media": js(a.media),
    ]
  }

  static func js(_ a: AssetUda) -> [String: Any?] {
    return [
      "assetId": a.assetId, "ticker": a.ticker, "name": a.name, "details": a.details, "precision": Int(a.precision),
      "timestamp": Double(a.timestamp), "addedAt": Double(a.addedAt), "balance": js(a.balance), "media": js(a.media), "token": js(a.token),
    ]
  }

  static func js(_ a: AssetIfa) -> [String: Any?] {
    return [
      "assetId": a.assetId, "ticker": a.ticker, "name": a.name, "details": a.details, "precision": Int(a.precision),
      "initialSupply": Double(a.initialSupply), "maxSupply": Double(a.maxSupply), "knownCirculatingSupply": Double(a.knownCirculatingSupply),
      "timestamp": Double(a.timestamp), "addedAt": Double(a.addedAt), "balance": js(a.balance), "media": js(a.media), "rejectListUrl": a.rejectListUrl,
    ]
  }

  static func js(_ a: Assets) -> [String: Any?] {
    return [
      "nia": a.nia.map { $0.map { js($0) } },
      "uda": a.uda.map { $0.map { js($0) } },
      "cfa": a.cfa.map { $0.map { js($0) } },
      "ifa": a.ifa.map { $0.map { js($0) } },
    ]
  }

  static func js(_ m: Metadata) -> [String: Any?] {
    return [
      "assetSchema": schemaName(m.assetSchema), "initialSupply": Double(m.initialSupply), "maxSupply": Double(m.maxSupply),
      "knownCirculatingSupply": Double(m.knownCirculatingSupply), "timestamp": Double(m.timestamp), "name": m.name,
      "precision": Int(m.precision), "ticker": m.ticker, "details": m.details, "token": js(m.token), "rejectListUrl": m.rejectListUrl,
    ]
  }

  static func js(_ r: ReceiveData) -> [String: Any?] {
    return ["invoice": r.invoice, "recipientId": r.recipientId, "expirationTimestamp": Double(r.expirationTimestamp), "batchTransferIdx": Int(r.batchTransferIdx)]
  }

  static func js(_ r: OperationResult) -> [String: Any?] {
    return ["txid": r.txid, "batchTransferIdx": Int(r.batchTransferIdx), "entropy": String(r.entropy)]
  }

  static func js(_ i: InvoiceData) -> [String: Any?] {
    return [
      "recipientId": i.recipientId, "assetSchema": i.assetSchema.map { schemaName($0) }, "assetId": i.assetId,
      "assignment": js(i.assignment), "assignmentName": i.assignmentName, "network": networkName(i.network),
      "expirationTimestamp": i.expirationTimestamp.map { Double($0) }, "transportEndpoints": i.transportEndpoints,
      "unknownQueryParams": i.unknownQueryParams,
    ]
  }

  private static func js(_ o: Outpoint?) -> [String: Any?]? {
    guard let o = o else { return nil }
    return ["txid": o.txid, "vout": Double(o.vout)]
  }

  static func name(_ t: TransactionType) -> String {
    switch t {
    case .rgbSend: return "RGB_SEND"
    case .drain: return "DRAIN"
    case .createUtxos: return "CREATE_UTXOS"
    case .sendBtc: return "SEND_BTC"
    case .incoming: return "INCOMING"
    }
  }

  static func name(_ k: TransferKind) -> String {
    switch k {
    case .issuance: return "ISSUANCE"
    case .receiveBlind: return "RECEIVE_BLIND"
    case .receiveWitness: return "RECEIVE_WITNESS"
    case .send: return "SEND"
    case .inflation: return "INFLATION"
    case .burn: return "BURN"
    }
  }

  static func name(_ s: TransferStatus) -> String {
    switch s {
    case .initiated: return "INITIATED"
    case .waitingCounterparty: return "WAITING_COUNTERPARTY"
    case .waitingSafeHeight: return "WAITING_SAFE_HEIGHT"
    case .waitingBroadcast: return "WAITING_BROADCAST"
    case .waitingConfirmations: return "WAITING_CONFIRMATIONS"
    case .settled: return "SETTLED"
    case .failed: return "FAILED"
    }
  }

  static func js(_ t: Transaction) -> [String: Any?] {
    let time: [String: Any?]? = t.confirmationTime.map { ["height": Double($0.height), "timestamp": Double($0.timestamp)] }
    return [
      "transactionType": name(t.transactionType), "txid": t.txid, "received": Double(t.received),
      "sent": Double(t.sent), "fee": Double(t.fee), "confirmationTime": time,
    ]
  }

  static func js(_ t: Transfer) -> [String: Any?] {
    return [
      "idx": Int(t.idx), "batchTransferIdx": Int(t.batchTransferIdx), "createdAt": Double(t.createdAt), "updatedAt": Double(t.updatedAt),
      "status": name(t.status), "requestedAssignment": t.requestedAssignment.map { js($0) },
      "assignments": t.assignments.map { js($0) }, "kind": name(t.kind), "txid": t.txid, "recipientId": t.recipientId,
      "receiveUtxo": js(t.receiveUtxo), "changeUtxo": js(t.changeUtxo), "expirationTimestamp": t.expirationTimestamp.map { Double($0) },
      "transportEndpoints": t.transportEndpoints.map { ["endpoint": $0.endpoint, "transportType": "JSON_RPC", "used": $0.used] as [String: Any?] },
      "invoiceString": t.invoiceString, "consignmentPath": t.consignmentPath, "psbtPath": t.psbtPath,
    ]
  }

  static func js(_ u: Unspent) -> [String: Any?] {
    let utxo: [String: Any?] = [
      "outpoint": js(u.utxo.outpoint), "btcAmount": Double(u.utxo.btcAmount), "colorable": u.utxo.colorable,
      "exists": u.utxo.exists, "derivationIndex": u.utxo.derivationIndex.map { Double($0) },
    ]
    return [
      "utxo": utxo,
      "rgbAllocations": u.rgbAllocations.map { ["assetId": $0.assetId, "assignment": js($0.assignment), "settled": $0.settled] as [String: Any?] },
      "pendingBlinded": Double(u.pendingBlinded),
    ]
  }

  static func js(_ r: [Int32: RefreshedTransfer]) -> [String: Any?] {
    var out: [String: Any?] = [:]
    for (idx, t) in r {
      let failure: [String: Any?]? = t.failure.map { ["code": Errors.code($0), "message": Errors.message($0)] }
      out[String(idx)] = ["updatedStatus": t.updatedStatus.map { name($0) }, "failure": failure] as [String: Any?]
    }
    return out
  }
}

enum Errors {
  /// rgb-lib's error name: `RgbLibError.WalletDirAlreadyExists(...)` → `WalletDirAlreadyExists`.
  static func variant(_ e: RgbLibError) -> String {
    let text = String(describing: e)
    return String(text.prefix { $0 != "(" })
  }

  /// `WalletDirAlreadyExists` → `ERR_RGB_WALLET_DIR_ALREADY_EXISTS`.
  static func code(_ e: RgbLibError) -> String {
    let snake = variant(e).replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1_$2", options: .regularExpression)
    return "ERR_RGB_" + snake.uppercased()
  }

  /// The variant name first, so callers can match on it whatever the details say.
  static func message(_ e: RgbLibError) -> String {
    let text = String(describing: e)
    let name = variant(e)
    guard text.count > name.count else { return name }
    return "\(name): \(text.dropFirst(name.count).trimmingCharacters(in: CharacterSet(charactersIn: "()")))"
  }
}
