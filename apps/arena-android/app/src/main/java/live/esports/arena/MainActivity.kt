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
    private var updater: ArenaUpdater? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = false

        if (BuildConfig.IN_APP_UPDATE_ENABLED) {
            updater = ArenaUpdater(applicationContext).also { it.checkForUpdate(silent = true) }
        }

        setContent {
            ArenaTheme {
                Box(Modifier.fillMaxSize()) {
                    ArenaApp(onFirstFrame = {
                        Log.i("ARENA", "ARENA_NATIVE_UI_READY version=${BuildConfig.VERSION_NAME} sha=${BuildConfig.BUILD_SHA}")
                    })
                    updater?.let { activeUpdater ->
                        ArenaUpdateOverlay(
                            state = activeUpdater.state,
                            onCheck = { activeUpdater.checkForUpdate(silent = false) },
                            onDownload = activeUpdater::downloadUpdate,
                            onInstall = { activeUpdater.install(this@MainActivity) },
                            onDismiss = activeUpdater::dismiss
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        updater?.resumePendingInstall(this)
    }

    override fun onDestroy() {
        updater?.close()
        updater = null
        super.onDestroy()
    }
}
