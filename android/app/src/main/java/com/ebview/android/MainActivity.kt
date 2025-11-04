package com.webview.android

import android.animation.ObjectAnimator
import android.annotation.SuppressLint
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.webview.android.databinding.ActivityMainBinding
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var isWebViewErrorState = false
    private val targetUrl = "http://10.0.2.2:5173"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ✅ WebView 디버깅 허용 (Vite HMR 콘솔 디버깅 가능)
        WebView.setWebContentsDebuggingEnabled(true)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val webView = binding.webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true

        // ✅ JS ↔ Kotlin 인터페이스 추가 (error.html 에서 window.AndroidRetry.retry() 호출 가능)
        webView.addJavascriptInterface(RetryBridge(webView, targetUrl), "AndroidRetry")

        // ✅ WebViewClient 설정 (에러 발생 시 fallback)
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    showErrorPage()
                }
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                if (request.isForMainFrame) {
                    showErrorPage()
                }
            }
        }

        // ✅ 앱 시작 시 dev 서버 연결 확인 후 즉시 로드 또는 fallback
        checkDevServerAvailable(targetUrl) { available ->
            if (available) {
                webView.loadUrl(targetUrl)
            } else {
                showErrorPage()
            }
        }

        // ✅ “다시 시도하기” 버튼 클릭
        binding.retryButton.setOnClickListener {
            checkDevServerAvailable(targetUrl) { available ->
                if (available) {
                    reloadWebView()
                } else {
                    showErrorPage()
                }
            }
        }

        // ✅ 네트워크 복구 시 자동 재시도
        registerNetworkCallback()
    }

    /** ✨ 부드러운 fade 전환 애니메이션 */
    private fun fadeSwitch(from: View, to: View) {
        val fadeOut = ObjectAnimator.ofFloat(from, "alpha", 1f, 0f)
        fadeOut.duration = 250
        fadeOut.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                from.visibility = View.GONE
                to.visibility = View.VISIBLE
                val fadeIn = ObjectAnimator.ofFloat(to, "alpha", 0f, 1f)
                fadeIn.duration = 250
                fadeIn.start()
            }
        })
        fadeOut.start()
    }

    /** 🚨 dev 서버 연결 실패 시 fallback 페이지 표시 */
    private fun showErrorPage() {
        if (isWebViewErrorState) return
        isWebViewErrorState = true
        fadeSwitch(binding.webView, binding.errorLayout)
    }

    /** 🔁 WebView 다시 로드 */
    private fun reloadWebView() {
        fadeSwitch(binding.errorLayout, binding.webView)
        binding.webView.loadUrl(targetUrl)
        isWebViewErrorState = false
    }

    /** 🌐 dev 서버가 켜져 있는지 사전 체크 (1초 타임아웃) */
    private fun checkDevServerAvailable(url: String, callback: (Boolean) -> Unit) {
        Thread {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 1000  // 1초 내 응답 없으면 실패
                conn.readTimeout = 1000
                conn.requestMethod = "HEAD"
                conn.connect()
                val success = conn.responseCode in 200..399
                conn.disconnect()
                runOnUiThread { callback(success) }
            } catch (e: Exception) {
                runOnUiThread { callback(false) }
            }
        }.start()
    }

    /** 📶 네트워크 복구 감지 시 자동 재시도 */
    private fun registerNetworkCallback() {
        val connectivityManager = getSystemService(ConnectivityManager::class.java)
        connectivityManager.registerDefaultNetworkCallback(object :
            ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (isWebViewErrorState) {
                    runOnUiThread { reloadWebView() }
                }
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        binding.webView.destroy()
    }

    /** 🧩 JS ↔ Kotlin 브리지 */
    class RetryBridge(
        private val webView: WebView,
        private val devServerUrl: String
    ) {
        @JavascriptInterface
        fun retry() {
            webView.post {
                webView.loadUrl(devServerUrl)
            }
        }
    }
}
