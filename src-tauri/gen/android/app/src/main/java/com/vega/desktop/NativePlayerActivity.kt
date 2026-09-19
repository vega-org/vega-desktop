package com.vega.desktop

import android.net.Uri
import android.os.Bundle
import android.content.ActivityNotFoundException
import android.content.Intent
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
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
        updateKeepScreenOn(true)
        initializePlayer(videoUrl)
    }

    private fun updateKeepScreenOn(keepOn: Boolean) {
        if (::playerView.isInitialized) {
            playerView.keepScreenOn = keepOn
        }
        if (keepOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
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

        player?.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                super.onIsPlayingChanged(isPlaying)
                val shouldKeepOn = isPlaying || (player?.playWhenReady == true && player?.playbackState == Player.STATE_BUFFERING)
                updateKeepScreenOn(shouldKeepOn)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                super.onPlaybackStateChanged(playbackState)
                val shouldKeepOn = (playbackState == Player.STATE_BUFFERING || playbackState == Player.STATE_READY) && (player?.playWhenReady == true)
                updateKeepScreenOn(shouldKeepOn)
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                super.onPlayerError(error)
                updateKeepScreenOn(false)
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
        updateKeepScreenOn(true)
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
        val shouldKeepOn = player?.isPlaying == true || (player?.playWhenReady == true && player?.playbackState == Player.STATE_BUFFERING)
        updateKeepScreenOn(shouldKeepOn)
    }

    override fun onPause() {
        super.onPause()
        if (androidx.media3.common.util.Util.SDK_INT <= 23) {
            releasePlayer()
        }
    }

    override fun onStop() {
        super.onStop()
        updateKeepScreenOn(false)
        if (androidx.media3.common.util.Util.SDK_INT > 23) {
            releasePlayer()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        updateKeepScreenOn(false)
        releasePlayer()
    }

    private fun releasePlayer() {
        updateKeepScreenOn(false)
        player?.let {
            it.release()
            player = null
        }
    }
}
