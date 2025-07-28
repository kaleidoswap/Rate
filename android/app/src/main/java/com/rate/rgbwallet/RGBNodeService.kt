package com.rate.rgbwallet

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.InputStreamReader

class RGBNodeService : Service() {
    private val NOTIFICATION_ID = 1
    private val CHANNEL_ID = "rgb_node_service"
    private var nodeProcess: Process? = null
    private var nodeJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Start node process
        nodeJob = GlobalScope.launch(Dispatchers.IO) {
            try {
                val binaryFile = File(applicationContext.filesDir, "rgb-lightning-node")
                val dataDir = File(applicationContext.filesDir, "rgb-data").apply { mkdirs() }

                val processBuilder = ProcessBuilder(
                    binaryFile.absolutePath,
                    dataDir.absolutePath,
                    "--daemon-listening-port",
                    intent?.getIntExtra("daemon_listening_port", 3000)?.toString() ?: "3000",
                    "--ldk-peer-listening-port",
                    intent?.getIntExtra("ldk_peer_listening_port", 9735)?.toString() ?: "9735",
                    "--network",
                    intent?.getStringExtra("network") ?: "regtest"
                )

                processBuilder.redirectErrorStream(true)
                nodeProcess = processBuilder.start()

                // Read process output
                val reader = BufferedReader(InputStreamReader(nodeProcess?.inputStream))
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    println("RGB Lightning Node: $line")
                }

                // Wait for process to complete
                val exitCode = nodeProcess?.waitFor() ?: -1
                if (exitCode != 0) {
                    println("RGB Lightning Node process exited with code $exitCode")
                }
            } catch (e: Exception) {
                println("Error running RGB Lightning Node: ${e.message}")
                stopSelf()
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        nodeJob?.cancel()
        nodeProcess?.destroy()
        nodeProcess = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "RGB Lightning Node Service"
            val descriptionText = "Running RGB Lightning Node"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
            }
            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val pendingIntent: PendingIntent =
            Intent(this, MainActivity::class.java).let { notificationIntent ->
                PendingIntent.getActivity(
                    this, 0, notificationIntent,
                    PendingIntent.FLAG_IMMUTABLE
                )
            }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RGB Lightning Node")
            .setContentText("RGB Lightning Node is running")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .build()
    }
} 