package com.webview.android

import android.animation.ObjectAnimator
import android.annotation.SuppressLint
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.webview.android.databinding.ActivityMainBinding
import android.animation.Animator
import android.animation.AnimatorListenerAdapter

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var isWebViewErrorState = false
    private val targetUrl = "http://10.0.2.2:5173"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val webView = binding.webView

        // WebView 설정
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                showErrorPage()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isWebViewErrorState = false
            }
        }

        webView.loadUrl(targetUrl)

        binding.retryButton.setOnClickListener {
            reloadWebView()
        }

        registerNetworkCallback()
    }

    /** ✨ 부드러운 fade 애니메이션 */
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

    private fun showErrorPage() {
        if (isWebViewErrorState) return
        isWebViewErrorState = true
        fadeSwitch(binding.webView, binding.errorLayout)
    }

    private fun reloadWebView() {
        fadeSwitch(binding.errorLayout, binding.webView)
        binding.webView.reload()
    }

    private fun registerNetworkCallback() {
        val connectivityManager = getSystemService(ConnectivityManager::class.java)
        connectivityManager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (isWebViewErrorState) {
                    runOnUiThread {
                        reloadWebView()
                    }
                }
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        binding.webView.destroy()
    }
}
