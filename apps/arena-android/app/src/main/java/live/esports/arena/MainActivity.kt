package live.esports.arena

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = false

        setContent {
            ArenaTheme {
                ArenaApp(onFirstFrame = {
                    Log.i("ARENA", "ARENA_NATIVE_UI_READY version=${BuildConfig.VERSION_NAME} sha=${BuildConfig.BUILD_SHA}")
                })
            }
        }
    }
}
