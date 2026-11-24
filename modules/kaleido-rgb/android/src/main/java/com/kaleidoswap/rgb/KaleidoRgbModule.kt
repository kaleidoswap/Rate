package com.kaleidoswap.rgb

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import com.utexo.AssetFilter
import com.utexo.DatabaseType
import com.utexo.Invoice
import com.utexo.RgbLibException
import com.utexo.SinglesigKeys
import com.utexo.TransferScope
import com.utexo.Wallet
import com.utexo.WalletData

const val RGB_LIB_VERSION = "0.3.0-beta.7-upstream-dev-bfa.8-bfa"

/**
 * rgb-lib BFA (UTEXO's Kotlin bindings) for the app. Every call takes a
 * plain object of arguments; wallet calls take the handle `openWallet` returned
 * first and run on that wallet's own thread (see Session).
 */
class KaleidoRgbModule : Module() {
  private val sessions = WalletSessions()
  // Opening, restoring and moving wallet folders: one at a time, off the JS thread.
  private val files = Executors.newSingleThreadExecutor { Thread(it, "kaleido-rgb-files") }.asCoroutineDispatcher()

  private fun base(): File = appContext.reactContext?.filesDir ?: throw IllegalStateException("No Android context")

  override fun definition() = ModuleDefinition {
    Name("KaleidoRgb")

    Function("rgbLibVersion") { RGB_LIB_VERSION }

    AsyncFunction("generateKeys") Coroutine { args: Map<String, Any?> ->
      guarded {
        val a = Args(args)
        Mappers.toJs(com.utexo.generateKeys(Mappers.network(a.string("network")), Mappers.witnessVersion(a.stringOrNull("witnessVersion"))))
      }
    }

    AsyncFunction("restoreKeys") Coroutine { args: Map<String, Any?> ->
      guarded {
        val a = Args(args)
        Mappers.toJs(com.utexo.restoreKeys(Mappers.network(a.string("network")), a.string("mnemonic"), Mappers.witnessVersion(a.stringOrNull("witnessVersion"))))
      }
    }

    AsyncFunction("decodeInvoice") Coroutine { args: Map<String, Any?> ->
      guarded { Invoice(Args(args).string("invoice")).use { Mappers.toJs(it.invoiceData()) } }
    }

    AsyncFunction("dataDir") Coroutine { args: Map<String, Any?> ->
      withContext(files) { guarded { DataDirs.dataDir(base(), Args(args).stringOrNull("subdir")).absolutePath } }
    }

    AsyncFunction("walletDirState") Coroutine { args: Map<String, Any?> ->
      withContext(files) {
        guarded {
          val a = Args(args)
          DataDirs.state(DataDirs.walletDir(base(), a.stringOrNull("subdir"), a.string("masterFingerprint")))
        }
      }
    }

    AsyncFunction("moveAsideLegacyBdkCache") Coroutine { args: Map<String, Any?> ->
      withContext(files) {
        guarded {
          val a = Args(args)
          DataDirs.moveAsideLegacyBdkCache(DataDirs.walletDir(base(), a.stringOrNull("subdir"), a.string("masterFingerprint"))) ?: ""
        }
      }
    }

    AsyncFunction("restoreBackup") Coroutine { args: Map<String, Any?> ->
      withContext(files) {
        guarded {
          val a = Args(args)
          com.utexo.restoreBackup(a.string("backupPath"), a.string("password"), DataDirs.dataDir(base(), a.stringOrNull("subdir")).absolutePath)
        }
      }
    }

    AsyncFunction("openWallet") Coroutine { args: Map<String, Any?> ->
      withContext(files) {
        guarded {
          val a = Args(args)
          val k = a.obj("keys")
          val keys = SinglesigKeys(
            accountXpubVanilla = k.string("accountXpubVanilla"),
            accountXpubColored = k.string("accountXpubColored"),
            vanillaKeychain = if (k.has("vanillaKeychain")) k.uByte("vanillaKeychain") else null,
            masterFingerprint = k.string("masterFingerprint"),
            mnemonic = k.stringOrNull("mnemonic"),
            witnessVersion = Mappers.witnessVersion(k.stringOrNull("witnessVersion")),
          )
          val subdir = a.stringOrNull("subdir")
          val walletKey = "${subdir ?: ""}/${keys.masterFingerprint}"
          // Not open in this process: a runtime lock there was left by a process that died.
          if (!sessions.isOpen(walletKey)) DataDirs.clearStaleRuntimeLock(DataDirs.walletDir(base(), subdir, keys.masterFingerprint))
          val data = WalletData(
            dataDir = DataDirs.dataDir(base(), subdir).absolutePath,
            bitcoinNetwork = Mappers.network(a.string("network")),
            databaseType = DatabaseType.SQLITE,
            maxAllocationsPerUtxo = a.uInt("maxAllocationsPerUtxo"),
            supportedSchemas = a.strings("supportedSchemas").map { Mappers.schema(it) },
            allowRecklessSchemas = false,
          )
          sessions.add(Wallet(data, keys), walletKey)
        }
      }
    }

    AsyncFunction("closeWallet") Coroutine { handle: Int ->
      val session = sessions.getOrNull(handle)
      if (session != null) {
        try {
          session.exec { guarded { session.online = null; session.wallet.close() } }
        } finally {
          // Only now, after the calls queued before it: until then the folder counts as open.
          sessions.remove(handle)
          session.shutdown()
        }
      }
    }

    walletOp("goOnline") { s, a ->
      s.online = s.wallet.goOnline(Mappers.onlineOptions(a))
      null
    }
    walletOp("getBtcBalance") { s, a -> Mappers.toJs(s.wallet.getBtcBalance(s.online, a.bool("skipSync", false))) }
    walletOp("getAddress") { s, _ -> s.wallet.getAddress() }
    walletOp("refresh") { s, a ->
      Mappers.toJs(s.wallet.refresh(s.requireOnline(), a.stringOrNull("assetId"), a.objects("filter").map { Mappers.refreshFilter(it) }, a.bool("skipSync", false)))
    }
    walletOp("sync") { s, a -> s.wallet.sync(s.requireOnline(), Mappers.syncOptions(a)); null }
    walletOp("listAssets") { s, a -> Mappers.toJs(s.wallet.listAssets(a.strings("schemas").map { Mappers.schema(it) })) }
    walletOp("getAssetBalance") { s, a -> Mappers.toJs(s.wallet.getAssetBalance(a.string("assetId"))) }
    walletOp("getAssetMetadata") { s, a -> Mappers.toJs(s.wallet.getAssetMetadata(a.string("assetId"))) }
    walletOp("getMediaDir") { s, _ -> s.wallet.getMediaDir() }
    walletOp("getWalletDir") { s, _ -> s.wallet.getWalletDir() }
    walletOp("blindReceive") { s, a ->
      Mappers.toJs(s.wallet.blindReceive(
        s.online, a.stringOrNull("assetId"), Mappers.assignment(a.obj("assignment")),
        a.uLong("expirationTimestamp"), a.strings("transportEndpoints"), a.uByte("minConfirmations"),
        Mappers.encryption(a.stringOrNull("encryption")),
      ))
    }
    walletOp("witnessReceive") { s, a ->
      Mappers.toJs(s.wallet.witnessReceive(
        s.online, a.stringOrNull("assetId"), Mappers.assignment(a.obj("assignment")),
        a.uLong("expirationTimestamp"), a.strings("transportEndpoints"), a.uByte("minConfirmations"),
        Mappers.encryption(a.stringOrNull("encryption")),
      ))
    }
    walletOp("send") { s, a ->
      val map = a.raw("recipientMap")
      val recipients = map.keys.associateWith { assetId -> Args(map).objects(assetId).map { Mappers.recipient(it) } }
      Mappers.toJs(s.wallet.send(
        s.requireOnline(), recipients, a.bool("donation", false), a.uLong("feeRate"),
        a.uByte("minConfirmations"), a.uLong("expirationTimestamp"), a.stringOrNull("senderTransportEndpoint"),
      ))
    }
    walletOp("sendBtc") { s, a -> s.wallet.sendBtc(s.requireOnline(), a.string("address"), a.uLong("amount"), a.uLong("feeRate"), a.bool("skipSync", false)) }
    walletOp("drainTo") { s, a -> s.wallet.drainTo(s.requireOnline(), a.string("address"), a.uLong("feeRate")) }
    walletOp("listTransactions") { s, a -> s.wallet.listTransactions(s.online, a.bool("skipSync", false)).map { Mappers.toJs(it) } }
    walletOp("listTransfers") { s, a ->
      val filter = a.stringOrNull("assetId")?.let { AssetFilter.Id(it) } ?: AssetFilter.AnyOrNone
      s.wallet.listTransfers(filter, TransferScope.All).map { Mappers.toJs(it) }
    }
    walletOp("listUnspents") { s, a -> s.wallet.listUnspents(s.online, a.bool("settledOnly", false), a.bool("skipSync", false)).map { Mappers.toJs(it) } }
    walletOp("createUtxos") { s, a ->
      val num = if (a.has("num")) a.uByte("num") else null
      val size = if (a.has("size")) a.uInt("size") else null
      s.wallet.createUtxos(s.requireOnline(), a.bool("upTo", true), num, size, a.uLong("feeRate"), a.bool("skipSync", false)).toInt()
    }
    walletOp("failTransfers") { s, a ->
      s.wallet.failTransfers(s.requireOnline(), a.intOrNull("batchTransferIdx"), a.bool("noAssetOnly", false), a.bool("skipSync", false))
    }
    walletOp("deleteTransfers") { s, a -> s.wallet.deleteTransfers(a.intOrNull("batchTransferIdx"), a.bool("noAssetOnly", false)) }
    walletOp("signPsbt") { s, a -> s.wallet.signPsbt(a.string("psbt")) }
    walletOp("issueAssetNia") { s, a ->
      Mappers.toJs(s.wallet.issueAssetNia(a.string("ticker"), a.string("name"), a.uByte("precision"), a.uLongs("amounts")))
    }
    walletOp("issueAssetCfa") { s, a ->
      Mappers.toJs(s.wallet.issueAssetCfa(a.string("name"), a.stringOrNull("details"), a.uByte("precision"), a.uLongs("amounts"), a.stringOrNull("filePath")))
    }
    walletOp("issueAssetUda") { s, a ->
      Mappers.toJs(s.wallet.issueAssetUda(a.string("ticker"), a.string("name"), a.stringOrNull("details"), a.uByte("precision"), a.stringOrNull("mediaFilePath"), a.strings("attachmentsFilePaths")))
    }
    walletOp("issueAssetIfa") { s, a ->
      Mappers.toJs(s.wallet.issueAssetIfa(
        a.string("ticker"), a.string("name"), a.uByte("precision"), a.uLongs("amounts"),
        a.uLongs("inflationAmounts"), a.stringOrNull("rejectListUrl"),
        linkRight = false, linkedFromContract = null, skipContractChecks = false,
      ))
    }
    walletOp("issueAssetBfa") { s, a ->
      Mappers.toJs(s.wallet.issueAssetBfa(
        a.string("ticker"), a.string("name"), a.uByte("precision"), a.uByte("mintRights"),
        a.uLong("chainId"), a.string("contractAddress"), a.stringOrNull("rejectListAddress"),
        a.bool("linkRight", false), a.stringOrNull("linkedFromContract"), skipContractChecks = false,
      ))
    }
    walletOp("inflate") { s, a ->
      Mappers.toJs(s.wallet.inflate(s.requireOnline(), a.string("assetId"), a.uLongs("inflationAmounts"), a.uLong("feeRate"), a.uByte("minConfirmations")))
    }
    walletOp("burn") { s, a ->
      Mappers.toJs(s.wallet.burn(
        s.requireOnline(), a.string("assetId"), a.uLong("amount"), a.stringOrNull("burnReason"),
        a.uLong("feeRate"), a.uByte("minConfirmations"),
      ))
    }
    walletOp("backup") { s, a -> s.wallet.backup(a.string("backupPath"), a.string("password")); null }
    walletOp("backupInfo") { s, _ -> s.wallet.backupInfo() }
    walletOp("getFeeEstimation") { s, a -> s.wallet.getFeeEstimation(s.requireOnline(), a.number("blocks").toInt().toUShort()) }

    OnDestroy {
      for (handle in sessions.all()) {
        sessions.remove(handle)?.let { s ->
          runCatching { s.wallet.close() }
          s.shutdown()
        }
      }
    }
  }

  private fun ModuleDefinitionBuilder.walletOp(name: String, body: (Session, Args) -> Any?) {
    AsyncFunction(name) Coroutine { handle: Int, args: Map<String, Any?> ->
      val session = guarded { sessions.get(handle) }
      session.exec { guarded { body(session, Args(args)) } }
    }
  }
}

/** Errors reach JS with a stable code: `ERR_RGB_<RGB_LIB_ERROR>` for rgb-lib's own. */
internal inline fun <T> guarded(block: () -> T): T = try {
  block()
} catch (e: CodedException) {
  throw e
} catch (e: RgbLibException) {
  throw CodedException(Errors.code(e), Errors.message(e), e)
} catch (e: InvalidArgument) {
  throw CodedException("ERR_RGB_INVALID_ARGUMENT", e.message, e)
} catch (e: WalletNotFound) {
  throw CodedException("ERR_RGB_WALLET_NOT_FOUND", e.message, e)
} catch (e: NotOnline) {
  throw CodedException("ERR_RGB_NOT_ONLINE", e.message, e)
} catch (e: Exception) {
  throw CodedException("ERR_RGB_NATIVE", e.message ?: e.javaClass.simpleName, e)
}
