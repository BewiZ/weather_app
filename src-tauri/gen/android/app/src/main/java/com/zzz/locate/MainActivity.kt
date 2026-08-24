package com.zzz.locate

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import com.google.android.gms.location.LocationServices

class MainActivity : TauriActivity() {

    private val TAG = "LocateGPS"
    private var mWebView: WebView? = null
    private var fusedClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    private var gpsActive = false
    private var locationMode = "gps"

    private val UPDATE_INTERVAL_MS = 2000L
    private val FASTEST_INTERVAL_MS = 1000L

    private val locationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            if (results[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
                startTracking()
            } else {
                Log.w(TAG, "GPS permission denied")
                injectError("Please enable GPS permission")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        mWebView = webView

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun start() {
                Handler(Looper.getMainLooper()).post { requestAndStartGps() }
            }
            @JavascriptInterface
            fun stop() {
                Handler(Looper.getMainLooper()).post { stopTracking() }
            }
            @JavascriptInterface
            fun setMode(mode: String) {
                Handler(Looper.getMainLooper()).post {
                    Log.d(TAG, "switching location mode to: $mode")
                    val wasActive = gpsActive
                    if (wasActive) stopTracking()
                    locationMode = mode
                    val jsMode = if (mode == "auto") "auto" else "gps"
                    mWebView?.post {
                        mWebView?.evaluateJavascript(
                            "window.__nativeGpsMode('$jsMode')", null
                        )
                    }
                    if (wasActive) startTracking()
                }
            }
        }, "NativeGps")

        injectBridge()
    }

    override fun onResume() {
        super.onResume()
        if (hasLocationPermission()) startTracking()
        injectBridge()
    }

    override fun onPause() {
        super.onPause()
        stopTracking()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopTracking()
        mWebView = null
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    private fun requestAndStartGps() {
        if (hasLocationPermission()) {
            startTracking()
        } else {
            locationLauncher.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ))
        }
    }

    private fun startTracking() {
        if (gpsActive) return
        gpsActive = true

        fusedClient?.let { client ->
            val priority = if (locationMode == "gps") {
                Priority.PRIORITY_HIGH_ACCURACY
            } else {
                Priority.PRIORITY_BALANCED_POWER_ACCURACY
            }

            val request = LocationRequest.Builder(
                priority, UPDATE_INTERVAL_MS
            ).apply {
                setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
                setMinUpdateDistanceMeters(0f)
            }.build()

            locationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let { loc ->
                        pushToJs(loc.latitude, loc.longitude, loc.accuracy)
                    }
                }
            }

            try {
                client.requestLocationUpdates(
                    request, locationCallback!!, Looper.getMainLooper()
                )
                Log.d(TAG, "GPS tracking started with ${if (locationMode == "gps") "HIGH_ACCURACY" else "BALANCED"}")
            } catch (e: SecurityException) {
                Log.e(TAG, "GPS permission denied at runtime", e)
                injectError("GPS permission denied")
            } catch (e: Exception) {
                Log.e(TAG, "GPS start failed", e)
                injectError("GPS error: ${e.message}")
            }
        }
    }

    private fun stopTracking() {
        if (!gpsActive) return
        gpsActive = false
        locationCallback?.let { cb -> fusedClient?.removeLocationUpdates(cb) }
        locationCallback = null
    }

    private fun pushToJs(lat: Double, lng: Double, acc: Float) {
        mWebView?.post {
            mWebView?.evaluateJavascript(
                "window.__nativeGpsUpdate($lat, $lng, $acc)", null
            )
        }
    }

    private fun injectError(msg: String) {
        val escaped = msg.replace("'", "\'")
        mWebView?.post {
            mWebView?.evaluateJavascript(
                "window.__nativeGpsError('$escaped')", null
            )
        }
    }

    private fun injectBridge() {
        mWebView?.post { mWebView?.evaluateJavascript(BRIDGE_SCRIPT, null) }
    }

    companion object {
        private val BRIDGE_SCRIPT = """
            (function() {
                if (window.__nativeGpsInjected) {
                    window.__nativeGpsReady && window.__nativeGpsReady(true);
                    window.__nativeGpsMode('gps');
                    return;
                }
                window.__nativeGpsInjected = true;

                window.__nativeGpsData = null;
                window.__nativeGpsModeState = 'gps';
                window.__nativeGpsReady = function() {};
                window.__nativeGpsListeners = [];

                navigator.geolocation.watchPosition = function(success, err, opts) {
                    if (window.__nativeGpsData && !window.__nativeGpsData.error) {
                        var d = window.__nativeGpsData;
                        success({
                            coords: { latitude: d.lat, longitude: d.lng, accuracy: d.acc },
                            timestamp: Date.now()
                        });
                    }
                    var id = window.__nativeGpsListeners.length;
                    window.__nativeGpsListeners.push(function(d) {
                        success({
                            coords: { latitude: d.lat, longitude: d.lng, accuracy: d.acc },
                            timestamp: Date.now()
                        });
                    });
                    return id;
                };

                navigator.geolocation.getCurrentPosition = function(success, err, opts) {
                    if (window.__nativeGpsData && !window.__nativeGpsData.error) {
                        var d = window.__nativeGpsData;
                        success({
                            coords: { latitude: d.lat, longitude: d.lng, accuracy: d.acc },
                            timestamp: Date.now()
                        });
                    } else {
                        err && err({ code: 2, message: 'GPS not available yet' });
                    }
                };

                navigator.geolocation.clearWatch = function(id) {
                    if (id !== null && id !== undefined && id < window.__nativeGpsListeners.length) {
                        window.__nativeGpsListeners[id] = null;
                    }
                };

                window.__nativeGpsUpdate = function(lat, lng, acc) {
                    window.__nativeGpsData = { lat: lat, lng: lng, acc: acc, error: null };
                    window.__nativeGpsReady && window.__nativeGpsReady(true);
                    window.__nativeGpsListeners.forEach(function(fn) {
                        if (fn) {
                            try { fn({ lat: lat, lng: lng, acc: acc }); } catch(e) {}
                        }
                    });
                };

                window.__nativeGpsMode = function(mode) {
                    window.__nativeGpsModeState = mode;
                };

                window.__nativeGpsError = function(msg) {
                    window.__nativeGpsData = { error: msg };
                    window.__nativeGpsReady && window.__nativeGpsReady(false);
                };

                window.__nativeGpsReady && window.__nativeGpsReady(true);
                window.__nativeGpsMode('gps');
            })();
        """.trimIndent()
    }
}