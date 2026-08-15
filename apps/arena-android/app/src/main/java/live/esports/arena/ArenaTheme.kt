package live.esports.arena

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val ArenaBackground = Color(0xFF060A12)
val ArenaSurface = Color(0xFF0D1523)
val ArenaSurfaceRaised = Color(0xFF121D2D)
val ArenaLine = Color(0xFF223149)
val ArenaCyan = Color(0xFF18D8F4)
val ArenaRed = Color(0xFFFF495C)
val ArenaGreen = Color(0xFF35D07F)
val ArenaGold = Color(0xFFF6C85F)
val ArenaText = Color(0xFFF5F7FC)
val ArenaMuted = Color(0xFF8D9AB0)

private val ArenaColors = darkColorScheme(
    primary = ArenaCyan,
    onPrimary = ArenaBackground,
    secondary = ArenaRed,
    onSecondary = ArenaText,
    background = ArenaBackground,
    onBackground = ArenaText,
    surface = ArenaSurface,
    onSurface = ArenaText,
    surfaceVariant = ArenaSurfaceRaised,
    onSurfaceVariant = ArenaMuted,
    outline = ArenaLine,
    error = ArenaRed
)

@Composable
fun ArenaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ArenaColors,
        typography = Typography(),
        content = content
    )
}
