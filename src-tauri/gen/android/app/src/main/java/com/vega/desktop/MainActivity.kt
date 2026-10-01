package com.vega.desktop

import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Android's WebView does not implement the Screen Wake Lock API, so the in-app player has no
  // way to stop Google TV / Bravia from starting the screensaver during playback.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(ScreenBridge(), "VegaScreen")
  }

  inner class ScreenBridge {
    @JavascriptInterface
    fun setKeepScreenOn(keepOn: Boolean) {
      runOnUiThread {
        if (keepOn) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }
  }
}
