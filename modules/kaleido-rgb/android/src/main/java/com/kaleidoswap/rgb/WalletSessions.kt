package com.kaleidoswap.rgb

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.rgbtools.Online
import org.rgbtools.Wallet

class WalletNotFound(handle: Int) : IllegalStateException("No open RGB wallet with handle $handle")
class NotOnline : IllegalStateException("The RGB wallet is not online: call goOnline first")

/**
 * One open rgb-lib wallet. rgb-lib blocks and keeps one SQLite database per
 * wallet, so every call on it runs on this wallet's own thread, in call order.
 */
class Session(val wallet: Wallet) {
  @Volatile var online: Online? = null
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "kaleido-rgb-wallet") }
  private val dispatcher = executor.asCoroutineDispatcher()

  suspend fun <T> exec(block: () -> T): T = withContext(dispatcher) { block() }

  fun requireOnline(): Online = online ?: throw NotOnline()

  fun shutdown() {
    executor.shutdown()
  }
}

class WalletSessions {
  private val sessions = ConcurrentHashMap<Int, Session>()
  private val nextHandle = AtomicInteger(1)

  fun add(wallet: Wallet): Int {
    val handle = nextHandle.getAndIncrement()
    sessions[handle] = Session(wallet)
    return handle
  }

  fun get(handle: Int): Session = sessions[handle] ?: throw WalletNotFound(handle)

  fun remove(handle: Int): Session? = sessions.remove(handle)

  fun all(): List<Int> = sessions.keys.toList()
}
