package com.rate.rgbwallet

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RGBNodeModule : Module() {
    private var isServiceRunning = false
    private val binaryName = "rgb-lightning-node"

    override fun definition() = ModuleDefinition {
        Name("RGBNode")

        Function("startNode") { options: Map<String, Any> ->
            try {
                // Extract binary if needed
                extractBinaryIfNeeded()

                // Start the service
                val intent = Intent(context, RGBNodeService::class.java).apply {
                    options.forEach { (key, value) ->
                        when (value) {
                            is String -> putExtra(key, value)
                            is Int -> putExtra(key, value)
                            is Boolean -> putExtra(key, value)
                        }
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }

                isServiceRunning = true

                mapOf(
                    "success" to true,
                    "port" to (options["daemonPort"] ?: 3000),
                    "lightningPort" to (options["lightningPort"] ?: 9735)
                )
            } catch (e: Exception) {
                throw Exception("Failed to start RGB node: ${e.message}")
            }
        }

        Function("stopNode") {
            try {
                context.stopService(Intent(context, RGBNodeService::class.java))
                isServiceRunning = false
                mapOf("success" to true)
            } catch (e: Exception) {
                throw Exception("Failed to stop RGB node: ${e.message}")
            }
        }

        Function("isNodeRunning") {
            mapOf("isRunning" to isServiceRunning)
        }
    }

    private fun extractBinaryIfNeeded() {
        val binaryFile = File(context.filesDir, binaryName)

        if (binaryFile.exists()) {
            return
        }

        GlobalScope.launch(Dispatchers.IO) {
            withContext(Dispatchers.IO) {
                context.assets.open(binaryName).use { input ->
                    FileOutputStream(binaryFile).use { output ->
                        input.copyTo(output)
                    }
                }

                // Set executable permissions
                binaryFile.setExecutable(true)
            }
        }
    }
} 