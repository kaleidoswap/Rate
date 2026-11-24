package com.kaleidoswap.rgb

import com.utexo.AssetBfa
import com.utexo.AssetCfa
import com.utexo.AssetIfa
import com.utexo.AssetNia
import com.utexo.AssetSchema
import com.utexo.AssetUda
import com.utexo.Assets
import com.utexo.Assignment
import com.utexo.Balance
import com.utexo.BitcoinNetwork
import com.utexo.BlockTime
import com.utexo.BtcBalance
import com.utexo.Encryption
import com.utexo.EvmChain
import com.utexo.IndexerConfig
import com.utexo.InvoiceData
import com.utexo.Keys
import com.utexo.Media
import com.utexo.Metadata
import com.utexo.OnlineOptions
import com.utexo.OperationResult
import com.utexo.Outpoint
import com.utexo.ReceiveData
import com.utexo.Recipient
import com.utexo.RefreshFilter
import com.utexo.RefreshTransferStatus
import com.utexo.RefreshedTransfer
import com.utexo.RgbLibException
import com.utexo.SyncKeychain
import com.utexo.SyncOptions
import com.utexo.SyncStrategy
import com.utexo.Token
import com.utexo.TokenLight
import com.utexo.Transaction
import com.utexo.Transfer
import com.utexo.Unspent
import com.utexo.WitnessData
import com.utexo.WitnessVersion

class InvalidArgument(message: String) : IllegalArgumentException(message)

/** Typed reads from the plain JS object every call receives. */
class Args(private val map: Map<String, Any?>) {
  fun has(key: String) = map[key] != null
  fun string(key: String): String = map[key] as? String ?: throw InvalidArgument("$key must be a string")
  fun stringOrNull(key: String): String? = map[key] as? String
  fun bool(key: String, default: Boolean): Boolean = map[key] as? Boolean ?: default
  fun number(key: String): Double = (map[key] as? Number)?.toDouble() ?: throw InvalidArgument("$key must be a number")
  fun numberOrNull(key: String): Double? = (map[key] as? Number)?.toDouble()
  fun uLong(key: String): ULong = nonNegative(key, number(key)).toULong()
  fun uLongOrNull(key: String): ULong? = numberOrNull(key)?.let { nonNegative(key, it).toULong() }
  fun uInt(key: String): UInt = nonNegative(key, number(key)).toUInt()
  fun uByte(key: String): UByte = nonNegative(key, number(key)).let {
    if (it > 255) throw InvalidArgument("$key must be at most 255")
    it.toInt().toUByte()
  }
  fun intOrNull(key: String): Int? = numberOrNull(key)?.toInt()
  fun strings(key: String): List<String> = (map[key] as? List<*>)?.map { it as? String ?: throw InvalidArgument("$key must hold strings") } ?: emptyList()
  fun stringMap(key: String): Map<String, String> {
    if (!has(key)) return emptyMap()
    return raw(key).mapValues { (_, value) -> value as? String ?: throw InvalidArgument("$key must hold strings") }
  }
  fun uLongs(key: String): List<ULong> = (map[key] as? List<*>)?.map {
    val n = (it as? Number)?.toDouble() ?: throw InvalidArgument("$key must hold numbers")
    nonNegative(key, n).toULong()
  } ?: emptyList()
  @Suppress("UNCHECKED_CAST")
  fun obj(key: String): Args = Args(map[key] as? Map<String, Any?> ?: throw InvalidArgument("$key must be an object"))
  @Suppress("UNCHECKED_CAST")
  fun objOrNull(key: String): Args? = (map[key] as? Map<String, Any?>)?.let { Args(it) }
  @Suppress("UNCHECKED_CAST")
  fun objects(key: String): List<Args> = (map[key] as? List<*>)?.map { Args(it as? Map<String, Any?> ?: throw InvalidArgument("$key must hold objects")) } ?: emptyList()
  @Suppress("UNCHECKED_CAST")
  fun raw(key: String): Map<String, Any?> = map[key] as? Map<String, Any?> ?: throw InvalidArgument("$key must be an object")

  private fun nonNegative(key: String, n: Double): Double {
    if (n < 0 || !n.isFinite() || n != Math.floor(n)) throw InvalidArgument("$key must be a whole number >= 0")
    return n
  }
}

object Mappers {
  // The native library's tests keep failed witness-receive scripts syncing for one week.
  private const val FAILED_WITNESS_RECEIVE_GRACE_SECS = 604800u

  fun network(value: String): BitcoinNetwork =
    BitcoinNetwork.entries.firstOrNull { it.name == value } ?: throw InvalidArgument("Unknown bitcoin network: $value")

  fun schema(value: String): AssetSchema =
    AssetSchema.entries.firstOrNull { it.name == value } ?: throw InvalidArgument("Unknown asset schema: $value")

  fun witnessVersion(value: String?): WitnessVersion = when (value) {
    null, "TAPROOT" -> WitnessVersion.TAPROOT
    "SEG_WIT_V0" -> WitnessVersion.SEG_WIT_V0
    else -> throw InvalidArgument("Unknown witness version: $value")
  }

  fun encryption(value: String?): Encryption? = value?.let { name ->
    Encryption.entries.firstOrNull { it.name == name } ?: throw InvalidArgument("Unknown encryption mode: $name")
  }

  fun onlineOptions(a: Args): OnlineOptions {
    val url = a.string("indexerUrl")
    val indexer = if (url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)) {
      IndexerConfig.Esplora(url)
    } else {
      IndexerConfig.Electrum(url)
    }
    val evmChains = if (a.has("evmChains")) {
      val chains = a.obj("evmChains")
      a.raw("evmChains").keys.associate { key ->
        val chainId = key.toULongOrNull() ?: throw InvalidArgument("Invalid EVM chain ID: $key")
        val chain = chains.obj(key)
        chainId to EvmChain(chain.string("rpcUrl"), chain.uLong("minMintLockBlocks"), chain.uLong("maxMintLockBlocks"))
      }
    } else {
      emptyMap()
    }
    return OnlineOptions(
      indexerConfig = indexer,
      skipConsistencyCheck = a.bool("skipConsistencyCheck", false),
      vanillaSyncLookback = a.uInt("vanillaSyncLookback"),
      failedWitnessReceiveGraceSecs = if (a.has("failedWitnessReceiveGraceSecs")) a.uInt("failedWitnessReceiveGraceSecs") else FAILED_WITNESS_RECEIVE_GRACE_SECS,
      proxyAuthKeys = a.stringMap("proxyAuthKeys"),
      evmChains = evmChains,
    )
  }

  fun assignment(a: Args): Assignment = when (val type = a.string("type")) {
    "FUNGIBLE" -> Assignment.Fungible(a.uLong("amount"))
    "NON_FUNGIBLE" -> Assignment.NonFungible
    "INFLATION_RIGHT" -> Assignment.InflationRight(a.uLong("amount"))
    "LINK_RIGHT" -> Assignment.LinkRight
    "MINT_RIGHT" -> Assignment.MintRight
    "ANY" -> Assignment.Any
    else -> throw InvalidArgument("Unknown assignment type: $type")
  }

  fun recipient(r: Args): Recipient = Recipient(
    recipientId = r.string("recipientId"),
    witnessData = r.objOrNull("witnessData")?.let { WitnessData(it.uLong("amountSat"), it.uLongOrNull("blinding")) },
    assignment = assignment(r.obj("assignment")),
    transportEndpoints = r.strings("transportEndpoints"),
    publicKey = r.stringOrNull("publicKey"),
    encryption = encryption(r.stringOrNull("encryption")) ?: Encryption.UNSUPPORTED,
    expirationTimestamp = r.uLongOrNull("expirationTimestamp"),
  )

  fun refreshFilter(f: Args): RefreshFilter {
    val status = f.string("status")
    val parsed = RefreshTransferStatus.entries.firstOrNull { it.name == status } ?: throw InvalidArgument("Unknown refresh status: $status")
    return RefreshFilter(parsed, f.bool("incoming", false))
  }

  fun syncOptions(a: Args): SyncOptions {
    val keychain = when (val k = a.string("keychain")) {
      "COLORED" -> SyncKeychain.Colored
      "VANILLA" -> SyncKeychain.Vanilla(a.uInt("lookback"))
      else -> throw InvalidArgument("Unknown keychain: $k")
    }
    val strategy = SyncStrategy.entries.firstOrNull { it.name == a.string("strategy") } ?: throw InvalidArgument("Unknown sync strategy")
    return SyncOptions(keychain, strategy)
  }

  fun toJs(a: Assignment): Map<String, Any?> = when (a) {
    is Assignment.Fungible -> mapOf("type" to "FUNGIBLE", "amount" to a.amount.toDouble())
    is Assignment.NonFungible -> mapOf("type" to "NON_FUNGIBLE")
    is Assignment.InflationRight -> mapOf("type" to "INFLATION_RIGHT", "amount" to a.amount.toDouble())
    is Assignment.LinkRight -> mapOf("type" to "LINK_RIGHT")
    is Assignment.MintRight -> mapOf("type" to "MINT_RIGHT")
    is Assignment.Any -> mapOf("type" to "ANY")
  }

  fun toJs(k: Keys): Map<String, Any?> = mapOf(
    "mnemonic" to k.mnemonic,
    "xpub" to k.xpub,
    "accountXpubVanilla" to k.accountXpubVanilla,
    "accountXpubColored" to k.accountXpubColored,
    "masterFingerprint" to k.masterFingerprint,
    "witnessVersion" to k.witnessVersion.name,
  )

  fun toJs(b: Balance): Map<String, Any?> = mapOf(
    "settled" to b.settled.toDouble(),
    "future" to b.future.toDouble(),
    "spendable" to b.spendable.toDouble(),
  )

  fun toJs(b: BtcBalance): Map<String, Any?> = mapOf("vanilla" to toJs(b.vanilla), "colored" to toJs(b.colored))

  fun toJs(m: Media?): Map<String, Any?>? = m?.let { mapOf("filePath" to it.filePath, "digest" to it.digest, "mime" to it.mime) }

  private fun attachments(a: Map<UByte, Media>): Map<String, Any?> = a.entries.associate { it.key.toString() to toJs(it.value) }

  fun toJs(t: TokenLight?): Map<String, Any?>? = t?.let {
    mapOf(
      "index" to it.index.toDouble(), "ticker" to it.ticker, "name" to it.name, "details" to it.details,
      "embeddedMedia" to it.embeddedMedia, "media" to toJs(it.media), "attachments" to attachments(it.attachments), "reserves" to it.reserves,
    )
  }

  fun toJs(t: Token?): Map<String, Any?>? = t?.let {
    mapOf(
      "index" to it.index.toDouble(), "ticker" to it.ticker, "name" to it.name, "details" to it.details,
      "embeddedMedia" to it.embeddedMedia?.let { e -> mapOf("mime" to e.mime, "data" to e.data.map { b -> b.toInt() }) },
      "media" to toJs(it.media), "attachments" to attachments(it.attachments), "reserves" to (it.reserves != null),
    )
  }

  fun toJs(a: AssetNia): Map<String, Any?> = mapOf(
    "assetId" to a.assetId, "ticker" to a.ticker, "name" to a.name, "details" to a.details,
    "precision" to a.precision.toInt(), "issuedSupply" to a.issuedSupply.toDouble(), "timestamp" to a.timestamp.toDouble(),
    "addedAt" to a.addedAt.toDouble(), "balance" to toJs(a.balance), "media" to toJs(a.media),
  )

  fun toJs(a: AssetCfa): Map<String, Any?> = mapOf(
    "assetId" to a.assetId, "name" to a.name, "details" to a.details,
    "precision" to a.precision.toInt(), "issuedSupply" to a.issuedSupply.toDouble(), "timestamp" to a.timestamp.toDouble(),
    "addedAt" to a.addedAt.toDouble(), "balance" to toJs(a.balance), "media" to toJs(a.media),
  )

  fun toJs(a: AssetUda): Map<String, Any?> = mapOf(
    "assetId" to a.assetId, "ticker" to a.ticker, "name" to a.name, "details" to a.details,
    "precision" to a.precision.toInt(), "timestamp" to a.timestamp.toDouble(), "addedAt" to a.addedAt.toDouble(),
    "balance" to toJs(a.balance), "media" to toJs(a.media), "token" to toJs(a.token),
  )

  fun toJs(a: AssetIfa): Map<String, Any?> = mapOf(
    "assetId" to a.assetId, "ticker" to a.ticker, "name" to a.name, "details" to a.details,
    "precision" to a.precision.toInt(), "initialSupply" to a.initialSupply.toDouble(), "maxSupply" to a.maxSupply.toDouble(),
    "knownCirculatingSupply" to a.knownCirculatingSupply.toDouble(), "timestamp" to a.timestamp.toDouble(),
    "addedAt" to a.addedAt.toDouble(), "balance" to toJs(a.balance), "media" to toJs(a.media), "rejectListUrl" to a.rejectListUrl,
  )

  fun toJs(a: AssetBfa): Map<String, Any?> = mapOf(
    "assetId" to a.assetId, "ticker" to a.ticker, "name" to a.name, "details" to a.details,
    "precision" to a.precision.toInt(), "knownCirculatingSupply" to a.knownCirculatingSupply.toDouble(),
    "timestamp" to a.timestamp.toDouble(), "addedAt" to a.addedAt.toDouble(), "balance" to toJs(a.balance),
    "media" to toJs(a.media), "rejectListUrl" to a.rejectListUrl,
  )

  fun toJs(a: Assets): Map<String, Any?> = mapOf(
    "nia" to a.nia?.map { toJs(it) },
    "uda" to a.uda?.map { toJs(it) },
    "cfa" to a.cfa?.map { toJs(it) },
    "ifa" to a.ifa?.map { toJs(it) },
    "bfa" to a.bfa?.map { toJs(it) },
  )

  fun toJs(m: Metadata): Map<String, Any?> = mapOf(
    "assetSchema" to m.assetSchema.name, "initialSupply" to m.initialSupply.toDouble(), "maxSupply" to m.maxSupply.toDouble(),
    "knownCirculatingSupply" to m.knownCirculatingSupply.toDouble(), "timestamp" to m.timestamp.toDouble(), "name" to m.name,
    "precision" to m.precision.toInt(), "ticker" to m.ticker, "details" to m.details, "token" to toJs(m.token), "rejectListUrl" to m.rejectListUrl,
    "linkedFromContract" to m.linkedFromContract, "linkedToContract" to m.linkedToContract,
  )

  fun toJs(r: ReceiveData): Map<String, Any?> = mapOf(
    "invoice" to r.invoice, "recipientId" to r.recipientId,
    "expirationTimestamp" to r.expirationTimestamp.toDouble(), "batchTransferIdx" to r.batchTransferIdx,
    "publicKey" to r.publicKey,
  )

  fun toJs(r: OperationResult): Map<String, Any?> = mapOf(
    "txid" to r.txid, "batchTransferIdx" to r.batchTransferIdx, "entropy" to r.entropy.toString(),
  )

  fun toJs(i: InvoiceData): Map<String, Any?> = mapOf(
    "recipientId" to i.recipientId, "assetSchema" to i.assetSchema?.name, "assetId" to i.assetId,
    "assignment" to toJs(i.assignment), "assignmentName" to i.assignmentName, "network" to i.network.name,
    "expirationTimestamp" to i.expirationTimestamp?.toDouble(), "transportEndpoints" to i.transportEndpoints,
    "publicKey" to i.publicKey, "encryption" to i.encryption.name,
    "unknownQueryParams" to i.unknownQueryParams,
  )

  private fun toJs(b: BlockTime?): Map<String, Any?>? = b?.let { mapOf("height" to it.height.toDouble(), "timestamp" to it.timestamp.toDouble()) }
  private fun toJs(o: Outpoint?): Map<String, Any?>? = o?.let { mapOf("txid" to it.txid, "vout" to it.vout.toDouble()) }

  fun toJs(t: Transaction): Map<String, Any?> = mapOf(
    "transactionType" to t.transactionType.name, "txid" to t.txid, "received" to t.received.toDouble(),
    "sent" to t.sent.toDouble(), "fee" to t.fee.toDouble(), "confirmationTime" to toJs(t.confirmationTime),
  )

  fun toJs(t: Transfer): Map<String, Any?> = mapOf(
    "idx" to t.idx, "batchTransferIdx" to t.batchTransferIdx, "createdAt" to t.createdAt.toDouble(), "updatedAt" to t.updatedAt.toDouble(),
    "status" to t.status.name, "requestedAssignment" to t.requestedAssignment?.let { toJs(it) },
    "assignments" to t.assignments.map { toJs(it) }, "kind" to t.kind.name, "txid" to t.txid, "recipientId" to t.recipientId,
    "receiveUtxo" to toJs(t.receiveUtxo), "changeUtxo" to toJs(t.changeUtxos.firstOrNull()),
    "changeUtxos" to t.changeUtxos.map { toJs(it) }, "expirationTimestamp" to t.expirationTimestamp?.toDouble(),
    "transportEndpoints" to t.transportEndpoints.map { mapOf("endpoint" to it.endpoint, "transportType" to it.transportType.name, "used" to it.used) },
    "senderTransportEndpoint" to t.senderTransportEndpoint,
    "invoiceString" to t.invoiceString, "consignmentPath" to t.consignmentPath, "psbtPath" to t.psbtPath,
  )

  fun toJs(u: Unspent): Map<String, Any?> = mapOf(
    "utxo" to mapOf(
      "outpoint" to toJs(u.utxo.outpoint), "btcAmount" to u.utxo.btcAmount.toDouble(), "colorable" to u.utxo.colorable,
      "exists" to u.utxo.exists, "derivationIndex" to u.utxo.derivationIndex?.toDouble(),
    ),
    "rgbAllocations" to u.rgbAllocations.map { mapOf("assetId" to it.assetId, "assignment" to toJs(it.assignment), "settled" to it.settled) },
    "pendingBlinded" to u.pendingBlinded.toDouble(),
  )

  fun toJs(r: Map<Int, RefreshedTransfer>): Map<String, Any?> = r.entries.associate { (idx, t) ->
    idx.toString() to mapOf(
      "updatedStatus" to t.updatedStatus?.name,
      "failure" to t.failure?.let { mapOf("code" to Errors.code(it), "message" to Errors.message(it)) },
    )
  }
}

object Errors {
  /** rgb-lib's error name: `RgbLibException.WalletDirAlreadyExists` → `WalletDirAlreadyExists`. */
  fun variant(e: RgbLibException): String = e::class.simpleName ?: "Unknown"

  /** `WalletDirAlreadyExists` → `ERR_RGB_WALLET_DIR_ALREADY_EXISTS`. */
  fun code(e: RgbLibException): String = "ERR_RGB_" + variant(e).replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").uppercase()

  /** The variant name first, so callers can match on it whatever the details say. */
  fun message(e: RgbLibException): String {
    val details = e.message?.takeIf { it.isNotBlank() }
    return if (details != null) "${variant(e)}: $details" else variant(e)
  }
}
