package com.ebview.android

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // ✅ WebView 디버깅 허용 (Vite HMR, console.log, 네트워크 확인 가능)
        WebView.setWebContentsDebuggingEnabled(true)

        webView = WebView(this)
        setContentView(webView)

        val settings = webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
        }

        // ✅ WebViewClient 설정 (외부 링크 방지)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }

        // ✅ 콘솔 / alert 등 JS 관련 동작을 위한 ChromeClient
        webView.webChromeClient = WebChromeClient()

        // ✅ Vite Dev Server 주소 설정
        //    - macOS / Windows 공통 (에뮬레이터는 localhost 대신 10.0.2.2 사용)
        val targetUrl = BuildConfig.VITE_DEV_SERVER_URL.ifEmpty {
            "http://10.0.2.2:5173"
        }

        webView.loadUrl(targetUrl)

        // ✅ 뒤로가기 시 WebView History 우선
        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
