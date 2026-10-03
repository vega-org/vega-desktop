package com.vega.desktop

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    // Custom "add provider source" intent. Not a deep link: no data URI, only
    // an action, a "url" extra and an optional "token" extra (GitHub token for
    // a private repo). Same contract as Vega mobile.
    const val ACTION_ADD_SOURCE = "vega.intent.action.ADD_SOURCE"
    const val EXTRA_URL = "url"
    const val EXTRA_TOKEN = "token"
    private const val MAX_URL_LENGTH = 2048
    private const val MAX_TOKEN_LENGTH = 255
  }

  private var webView: WebView? = null

  @Volatile
  private var pendingSource: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null &&
      intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0
    ) {
      pendingSource = consumeSourceIntent(intent)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    pendingSource = consumeSourceIntent(intent) ?: return
    // Tell the page to call VegaSourceIntent.take().
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new Event('vega-add-source'))",
        null,
      )
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(SourceIntentBridge(), "VegaSourceIntent")
  }

  private inner class SourceIntentBridge {
    /** Returns the pending {url, token?} JSON once, then clears it. */
    @JavascriptInterface
    fun take(): String? {
      val payload = pendingSource
      pendingSource = null
      return payload
    }
  }

  private fun consumeSourceIntent(intent: Intent): String? {
    if (intent.action != ACTION_ADD_SOURCE) return null
    val url = intent.getStringExtra(EXTRA_URL)?.trim()
    val token = intent.getStringExtra(EXTRA_TOKEN)?.trim()
    // Clear so activity recreation does not add it again.
    intent.removeExtra(EXTRA_URL)
    intent.removeExtra(EXTRA_TOKEN)
    if (url.isNullOrEmpty() || url.length > MAX_URL_LENGTH) return null
    return JSONObject().apply {
      put("url", url)
      if (!token.isNullOrEmpty() && token.length <= MAX_TOKEN_LENGTH) {
        put("token", token)
      }
    }.toString()
  }
}
