package com.webview.android

import android.animation.ObjectAnimator
import android.annotation.SuppressLint
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatImageButton
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.webview.android.databinding.ActivityMainBinding
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var isWebViewErrorState = false
    private val targetUrl = "http://10.0.2.2:3100"

    // ⬇️ 오버레이 새로고침 버튼 참조 (ImageButton 타입으로 교체)
    private lateinit var refreshBtn: AppCompatImageButton

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ✅ WebView 디버깅 허용 (Vite HMR 콘솔/네트워크 탭 사용)
        WebView.setWebContentsDebuggingEnabled(true)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val webView = binding.webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true

        // ✅ JS ↔ Kotlin 인터페이스 (error.html 에서 window.AndroidRetry.retry() 호출용)
        webView.addJavascriptInterface(RetryBridge(webView, targetUrl), "AndroidRetry")

        // ✅ WebViewClient: 메인프레임 에러 시 에러 레이아웃으로 전환
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

        // ✅ 오버레이 새로고침 버튼 생성/부착
        addTopRefreshButton()

        // ✅ 앱 시작 시 dev 서버 사전 체크 → 로드 or 에러 페이지
        checkDevServerAvailable(targetUrl) { available ->
            if (available) {
                webView.loadUrl(targetUrl)
                refreshBtn.visibility = View.VISIBLE
            } else {
                showErrorPage()
            }
        }

        // ✅ 에러 레이아웃의 “다시 시도” 버튼
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

                // 전환 후에도 오버레이 버튼이 항상 가장 위로
                if (::refreshBtn.isInitialized) {
                    refreshBtn.bringToFront()
                    refreshBtn.requestLayout()
                }
            }
        })
        fadeOut.start()
    }

    /** 🚨 dev 서버 연결 실패 시 fallback 페이지 표시 */
    private fun showErrorPage() {
        if (isWebViewErrorState) return
        isWebViewErrorState = true
        fadeSwitch(binding.webView, binding.errorLayout)
        if (::refreshBtn.isInitialized) refreshBtn.visibility = View.GONE
    }

    /** 🔁 WebView 다시 로드 */
    private fun reloadWebView() {
        fadeSwitch(binding.errorLayout, binding.webView)
        binding.webView.loadUrl(targetUrl)
        isWebViewErrorState = false
        if (::refreshBtn.isInitialized) {
            refreshBtn.visibility = View.VISIBLE
            refreshBtn.bringToFront()
        }
    }

    /** 🌐 dev 서버가 켜져 있는지 사전 체크 (1초 타임아웃) */
    private fun checkDevServerAvailable(url: String, callback: (Boolean) -> Unit) {
        Thread {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 1000
                conn.readTimeout = 1000
                conn.requestMethod = "HEAD"
                conn.connect()
                val success = conn.responseCode in 200..399
                conn.disconnect()
                runOnUiThread { callback(success) }
            } catch (_: Exception) {
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

    /** ⬆️ WebView 위 우상단 오버레이 새로고침 버튼 (기본 위젯만 사용) */
    private fun addTopRefreshButton() {
        val root = binding.root as ViewGroup

        fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

        // 원형 배경 (반투명 밝은 톤 + 얇은 스트로크)
        val circle = android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(android.graphics.Color.parseColor("#668A8D8F"))
            setStroke(dp(1), android.graphics.Color.parseColor("#CC8A8D8F"))
        }

        // 라플(눌림) 효과 포함 배경 (Lollipop+)
        val bg = if (android.os.Build.VERSION.SDK_INT >= 21) {
            val ripple = android.content.res.ColorStateList.valueOf(
                android.graphics.Color.parseColor("#99F47725") // 살짝 파란 리플
            )
            android.graphics.drawable.RippleDrawable(ripple, circle, null)
        } else {
            circle
        }

        // 아이콘 중심 원형 버튼
        val btn = AppCompatImageButton(this).apply {
            val size = dp(48) // 원 지름
            minimumWidth = size
            minimumHeight = size
            setPadding(dp(12), dp(12), dp(12), dp(12))

            background = bg
            scaleType = android.widget.ImageView.ScaleType.CENTER
            ViewCompat.setElevation(this, dp(6).toFloat())

            setImageResource(R.drawable.ic_refresh_24)
            imageTintList = android.content.res.ColorStateList.valueOf(
                android.graphics.Color.WHITE
            )

            contentDescription = "새로고침"

            setOnClickListener {
                if (isWebViewErrorState) {
                    checkDevServerAvailable(targetUrl) { ok ->
                        if (ok) reloadWebView() else showErrorPage()
                    }
                } else {
                    binding.webView.reload()
                }
            }
            setOnLongClickListener {
                android.widget.Toast.makeText(context, "새로고침", android.widget.Toast.LENGTH_SHORT).show()
                true
            }

            visibility = if (isWebViewErrorState) View.GONE else View.VISIBLE
        }

        // 우상단 배치
        val params = if (root is android.widget.FrameLayout ||
            root is androidx.coordinatorlayout.widget.CoordinatorLayout
        ) {
            android.widget.FrameLayout.LayoutParams(dp(48), dp(48)).apply {
                gravity = Gravity.TOP or Gravity.END
                setMargins(dp(12), dp(12), dp(12), dp(12))
            }
        } else {
            ViewGroup.MarginLayoutParams(dp(48), dp(48)).apply {
                setMargins(dp(12), dp(12), dp(12), dp(12))
            }
        }

        root.addView(btn, params)
        btn.bringToFront()

        // 상태바 인셋 보정
        ViewCompat.setOnApplyWindowInsetsListener(btn) { v, insets ->
            val topInset = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            v.translationY = topInset.toFloat()
            insets
        }

        refreshBtn = btn
    }
}
