package live.esports.arena

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    private lateinit var updater: ArenaUpdater

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = false

        updater = ArenaUpdater(applicationContext)
        if (BuildConfig.IN_APP_UPDATE_ENABLED) updater.checkForUpdate(silent = true)

        setContent {
            ArenaTheme {
                Box(Modifier.fillMaxSize()) {
                    ArenaApp(onFirstFrame = {
                        Log.i("ARENA", "ARENA_NATIVE_UI_READY version=${BuildConfig.VERSION_NAME} sha=${BuildConfig.BUILD_SHA}")
                    })
                    if (BuildConfig.IN_APP_UPDATE_ENABLED) {
                        ArenaUpdateOverlay(
                            state = updater.state,
                            onCheck = { updater.checkForUpdate(silent = false) },
                            onDownload = updater::downloadUpdate,
                            onInstall = { updater.install(this@MainActivity) },
                            onDismiss = updater::dismiss
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::updater.isInitialized && BuildConfig.IN_APP_UPDATE_ENABLED) {
            updater.resumePendingInstall(this)
        }
    }

    override fun onDestroy() {
        if (::updater.isInitialized) updater.close()
        super.onDestroy()
    }
}
