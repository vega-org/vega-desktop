package com.vega.desktop

import android.net.Uri
import android.os.Bundle
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

@UnstableApi
class NativePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView

    private fun isExternalRequest(): Boolean =
        intent.data?.getQueryParameter("external") == "1"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val videoUrl = intent.data?.getQueryParameter("url") ?: intent.getStringExtra("videoUrl")

        if (videoUrl == null) {
            finish()
            return
        }

        if (isExternalRequest()) {
            openExternalPlayer(videoUrl)
            finish()
            return
        }

        setContentView(R.layout.activity_native_player)
        playerView = findViewById(R.id.player_view)
        initializePlayer(videoUrl)
    }

    private fun openExternalPlayer(url: String) {
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(url), "video/*")
            addCategory(Intent.CATEGORY_DEFAULT)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        try {
            startActivity(Intent.createChooser(viewIntent, "Open stream with"))
        } catch (_: ActivityNotFoundException) {
            android.widget.Toast.makeText(
                this,
                "No external video player is installed",
                android.widget.Toast.LENGTH_LONG,
            ).show()
        }
    }

    private fun initializePlayer(url: String) {
        val headersStr = intent.data?.getQueryParameter("headers") ?: intent.getStringExtra("headers")
        val httpDataSourceFactory = androidx.media3.datasource.DefaultHttpDataSource.Factory()
        
        if (!headersStr.isNullOrEmpty()) {
            try {
                val json = org.json.JSONObject(headersStr)
                val keys = json.keys()
                val headersMap = mutableMapOf<String, String>()
                while (keys.hasNext()) {
                    val key = keys.next()
                    headersMap[key] = json.getString(key)
                }
                httpDataSourceFactory.setDefaultRequestProperties(headersMap)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        val dataSourceFactory = androidx.media3.datasource.DefaultDataSource.Factory(this, httpDataSourceFactory)
        val mediaSourceFactory = androidx.media3.exoplayer.source.DefaultMediaSourceFactory(dataSourceFactory)

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()

        player?.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                super.onPlayerError(error)
                val msg = "ExoPlayer Error: ${error.errorCodeName} - ${error.message}"
                android.widget.Toast.makeText(this@NativePlayerActivity, msg, android.widget.Toast.LENGTH_LONG).show()
                android.util.Log.e("VegaNativePlayer", msg, error)
            }
        })

        playerView.player = player
        playerView.requestFocus() // Ensure it gets focus for TV D-pad

        // If the URL is a local file path (starts with /), ensure it has a file:// scheme
        val safeUrl = if (url.startsWith("/")) "file://$url" else url

        val mediaItem = MediaItem.fromUri(Uri.parse(safeUrl))
        player?.setMediaItem(mediaItem)
        player?.prepare()
        player?.playWhenReady = true
    }

    override fun onStart() {
        super.onStart()
        if (isExternalRequest()) return
        if (androidx.media3.common.util.Util.SDK_INT > 23) {
            val videoUrl = intent.data?.getQueryParameter("url") ?: intent.getStringExtra("videoUrl")
            if (player == null && videoUrl != null) {
                initializePlayer(videoUrl)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (isExternalRequest()) return
        if (androidx.media3.common.util.Util.SDK_INT <= 23 || player == null) {
            val videoUrl = intent.data?.getQueryParameter("url") ?: intent.getStringExtra("videoUrl")
            if (player == null && videoUrl != null) {
                initializePlayer(videoUrl)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (androidx.media3.common.util.Util.SDK_INT <= 23) {
            releasePlayer()
        }
    }

    override fun onStop() {
        super.onStop()
        if (androidx.media3.common.util.Util.SDK_INT > 23) {
            releasePlayer()
        }
    }

    private fun releasePlayer() {
        player?.let {
            it.release()
            player = null
        }
    }
}
