package live.esports.arena

import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import java.util.Locale
import kotlin.math.abs

private val V3Board = Color(0xFF08111B)
private val V3BoardDeep = Color(0xFF050A10)
private val V3Yellow = Color(0xFFFFC94A)
private val V3Lime = Color(0xFFB7FF00)
private val V3Purple = Color(0xFFA36BFF)

@Composable
fun V3GameSelector(games: List<SeriesGame>, selectedId: String?, onGame: (SeriesGame) -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = ArenaSurface,
        border = androidx.compose.foundation.BorderStroke(1.dp, ArenaLine)
    ) {
        Row(Modifier.fillMaxWidth().padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            games.sortedBy { it.number }.forEach { game ->
                val selected = game.id == selectedId
                val shape = RoundedCornerShape(10.dp)
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(shape)
                        .background(if (selected) ArenaCyan.copy(alpha = 0.12f) else Color.Transparent)
                        .border(1.dp, if (selected) ArenaCyan.copy(alpha = 0.55f) else Color.Transparent, shape)
                        .clickable { onGame(game) }
                        .padding(vertical = 6.dp, horizontal = 3.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Game ${game.number}", color = ArenaText, fontSize = 11.sp, fontWeight = FontWeight.Black)
                    Text(v3GameState(game.state), color = v3GameStateColor(game.state), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun V3Scoreboard(series: Series, snapshot: LiveSnapshot, stats: LolStats) {
    val blueTeam = resolveSeriesTeam(series, stats.blue, 0)
    val redTeam = resolveSeriesTeam(series, stats.red, 1)
    val pairs = pairPlayers(stats.blue.players, stats.red.players)
    LaunchedEffect(snapshot.game.id, stats.gameClockSeconds, pairs.size) {
        Log.i(
            "ARENA",
            "ARENA_V3_SCOREBOARD_READY game=${snapshot.game.id} state=${snapshot.game.state} players=${pairs.size}"
        )
    }
    val shape = RoundedCornerShape(22.dp)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.horizontalGradient(listOf(V3Board, V3BoardDeep, V3Board)))
            .border(1.dp, ArenaLine, shape)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(3.dp)
                .background(Brush.horizontalGradient(listOf(ArenaCyan, ArenaCyan.copy(alpha = 0.15f), ArenaRed.copy(alpha = 0.15f), ArenaRed)))
        )
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(formatV3Clock(stats.gameClockSeconds), color = ArenaText, fontSize = 22.sp, fontWeight = FontWeight.Black)
            Text(
                "Game ${snapshot.game.number} · ${v3GameState(snapshot.game.state)}",
                color = ArenaText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black
            )
        }
        V3Freshness(snapshot.quality)
        V3TeamBanner(blueTeam, redTeam, stats)
        V3Objectives(stats)
        if (pairs.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(15.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("PLAYER STATISTICS PENDING", color = ArenaText, fontSize = 11.sp, fontWeight = FontWeight.Black)
                Text("Champion, KDA, CS and lane gold will appear here.", color = ArenaMuted, fontSize = 10.sp)
            }
        } else {
            pairs.forEachIndexed { index, pair ->
                if (index > 0) HorizontalDivider(color = ArenaLine.copy(alpha = 0.55f))
                V3PlayerPair(pair, stats.patch)
            }
        }
    }
}

@Composable
private fun V3Freshness(quality: SnapshotQuality) {
    val fresh = quality.freshness == "fresh"
    val color = if (fresh) ArenaCyan else V3Yellow
    val label = if (fresh) "LIVE DATA" else "${quality.freshness.uppercase(Locale.ROOT)} DATA"
    val age = quality.ageSeconds?.let(::v3Age)
    val partial = if (quality.complete) "" else " · Partial stats"
    Row(
        Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = if (fresh) 0.09f else 0.16f))
            .padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(7.dp).background(color, RoundedCornerShape(4.dp)))
        Spacer(Modifier.width(6.dp))
        Text(
            "$label${age?.let { " · Updated $it ago" } ?: ""}$partial",
            color = color,
            fontSize = 9.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 0.3.sp
        )
    }
}

@Composable
private fun V3TeamBanner(blueTeam: Team, redTeam: Team, stats: LolStats) {
    val difference = if (stats.blue.gold != null && stats.red.gold != null) stats.blue.gold - stats.red.gold else null
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.horizontalGradient(listOf(ArenaCyan.copy(alpha = 0.15f), V3Board, ArenaRed.copy(alpha = 0.15f))))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        V3TeamSide(blueTeam, stats.blue, ArenaCyan, Modifier.weight(1f), Alignment.Start)
        Column(
            modifier = Modifier
                .width(80.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(V3BoardDeep.copy(alpha = 0.86f))
                .border(1.dp, ArenaCyan.copy(alpha = 0.28f), RoundedCornerShape(13.dp))
                .padding(vertical = 6.dp, horizontal = 3.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("GOLD LEAD", color = ArenaMuted, fontSize = 8.sp, fontWeight = FontWeight.Black)
            Text(
                when {
                    difference == null -> "—"
                    difference == 0 -> "EVEN"
                    else -> "+${v3Compact(abs(difference))}"
                },
                color = when {
                    difference == null || difference == 0 -> ArenaText
                    difference > 0 -> ArenaCyan
                    else -> ArenaRed
                },
                fontSize = 17.sp,
                fontWeight = FontWeight.Black
            )
        }
        V3TeamSide(redTeam, stats.red, ArenaRed, Modifier.weight(1f), Alignment.End)
    }
}

@Composable
private fun V3TeamSide(team: Team, state: TeamState, accent: Color, modifier: Modifier, alignment: Alignment.Horizontal) {
    Column(modifier.padding(horizontal = 2.dp), horizontalAlignment = alignment) {
        V3TeamLogo(team, accent, 24.dp)
        Spacer(Modifier.height(2.dp))
        Text(team.name, color = ArenaText, fontSize = 11.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = if (alignment == Alignment.End) TextAlign.End else TextAlign.Start)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("KILLS ", color = ArenaMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
            Text(state.kills?.toString() ?: "—", color = accent, fontSize = 19.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
private fun V3Objectives(stats: LolStats) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        V3Objective("♜", "TOWERS", stats.blue.objectives.towers, stats.red.objectives.towers, ArenaCyan, Modifier.weight(1f))
        V3Objective("✦", "DRAGONS", stats.blue.objectives.dragons?.size, stats.red.objectives.dragons?.size, V3Lime, Modifier.weight(1f))
        V3Objective("◆", "BARONS", stats.blue.objectives.barons, stats.red.objectives.barons, V3Purple, Modifier.weight(1f))
        V3Objective("⬟", "INHIBITORS", stats.blue.objectives.inhibitors, stats.red.objectives.inhibitors, ArenaRed, Modifier.weight(1f))
    }
}

@Composable
private fun V3Objective(icon: String, label: String, blue: Int?, red: Int?, iconColor: Color, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(9.dp))
            .background(ArenaSurface.copy(alpha = 0.82f))
            .border(1.dp, ArenaLine.copy(alpha = 0.8f), RoundedCornerShape(9.dp))
            .padding(vertical = 4.dp, horizontal = 1.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp)
    ) {
        Text(icon, color = iconColor, fontSize = 13.sp, fontWeight = FontWeight.Black)
        Text(label, color = ArenaMuted, fontSize = 7.sp, fontWeight = FontWeight.Black, maxLines = 1)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(blue?.toString() ?: "—", color = ArenaCyan, fontSize = 12.sp, fontWeight = FontWeight.Black)
            Text(" – ", color = ArenaMuted, fontSize = 9.sp)
            Text(red?.toString() ?: "—", color = ArenaRed, fontSize = 12.sp, fontWeight = FontWeight.Black)
        }
    }
}

private data class V3PlayerPair(val blue: PlayerState?, val red: PlayerState?)

@Composable
private fun V3PlayerPair(pair: V3PlayerPair, patch: String?) {
    val blueGold = pair.blue?.totalGold
    val redGold = pair.red?.totalGold
    val difference = if (blueGold != null && redGold != null) blueGold - redGold else null
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        V3PlayerSide(pair.blue, ArenaCyan, false, patch, Modifier.weight(1f))
        Column(Modifier.width(46.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                when {
                    difference == null -> "—"
                    difference == 0 -> "EVEN"
                    else -> "+${v3Compact(abs(difference))} →"
                },
                color = when {
                    difference == null || difference == 0 -> ArenaMuted
                    difference > 0 -> ArenaCyan
                    else -> ArenaRed
                },
                fontSize = 12.sp,
                lineHeight = 13.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center
            )
        }
        V3PlayerSide(pair.red, ArenaRed, true, patch, Modifier.weight(1f))
    }
}

@Composable
private fun V3PlayerSide(player: PlayerState?, accent: Color, reversed: Boolean, patch: String?, modifier: Modifier) {
    Column(modifier, horizontalAlignment = if (reversed) Alignment.End else Alignment.Start) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!reversed) {
                V3ChampionPortrait(player, accent, patch)
                Spacer(Modifier.width(6.dp))
            }
            Column(
                Modifier.weight(1f),
                horizontalAlignment = if (reversed) Alignment.End else Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    player?.handle ?: "Player",
                    color = ArenaText,
                    fontSize = 12.sp,
                    lineHeight = 13.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    "${player?.kills ?: "—"}/${player?.deaths ?: "—"}/${player?.assists ?: "—"} · ${player?.creepScore ?: "—"} CS",
                    color = ArenaText,
                    fontSize = 10.sp,
                    lineHeight = 11.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )
                Text(
                    listOfNotNull(player?.championId, player?.level?.let { "Lv $it" }).joinToString(" · ").ifBlank { "—" },
                    color = ArenaMuted,
                    fontSize = 9.sp,
                    lineHeight = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (reversed) {
                Spacer(Modifier.width(6.dp))
                V3ChampionPortrait(player, accent, patch)
            }
        }
    }
}

@Composable
private fun V3ChampionPortrait(player: PlayerState?, accent: Color, patch: String?) {
    val context = LocalContext.current
    val squareUrl = championSquareImageUrl(player?.championId, patch)
    val loadingUrl = championLoadingImageUrl(player?.championId)
    var url by remember(player?.championId, patch) { mutableStateOf(squareUrl ?: loadingUrl) }
    val source = if (url != null && url == loadingUrl && loadingUrl != squareUrl) "loading" else "square"
    Box(
        Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(accent.copy(alpha = 0.12f))
            .border(1.dp, accent.copy(alpha = 0.45f), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Text(player?.championId?.take(2)?.uppercase(Locale.ROOT) ?: "?", color = accent, fontSize = 9.sp, fontWeight = FontWeight.Black)
        if (url != null) AsyncImage(
            model = ImageRequest.Builder(context)
                .data(url)
                .diskCacheKey("arena-champion:$url")
                .memoryCacheKey("arena-champion:$url")
                .build(),
            imageLoader = ArenaImageLoader.get(context),
            contentDescription = player?.championId,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
            onSuccess = {
                Log.i(
                    "ARENA",
                    "ARENA_CHAMPION_PORTRAIT_READY champion=${player?.championId ?: "unknown"} source=$source"
                )
            },
            onError = {
                if (url == squareUrl && loadingUrl != null && loadingUrl != squareUrl) {
                    Log.w(
                        "ARENA",
                        "ARENA_CHAMPION_PORTRAIT_FALLBACK champion=${player?.championId ?: "unknown"}"
                    )
                    url = loadingUrl
                } else {
                    Log.w(
                        "ARENA",
                        "ARENA_CHAMPION_PORTRAIT_FAILED champion=${player?.championId ?: "unknown"}"
                    )
                }
            }
        )
    }
}

@Composable
private fun V3TeamLogo(team: Team, accent: Color, size: androidx.compose.ui.unit.Dp) {
    val context = LocalContext.current
    val imageUrl = team.imageUrl?.takeIf { it.isNotBlank() }
    var failed by remember(imageUrl) { mutableStateOf(false) }
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        if (imageUrl == null || failed) {
            Text(team.code ?: team.name.take(2), color = accent, fontSize = 8.sp, fontWeight = FontWeight.Black)
        } else {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(imageUrl)
                    .diskCacheKey("arena-team:$imageUrl")
                    .memoryCacheKey("arena-team:$imageUrl")
                    .build(),
                imageLoader = ArenaImageLoader.get(context),
                contentDescription = "${team.name} logo",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
                onSuccess = {
                    Log.i("ARENA", "ARENA_TEAM_LOGO_READY team=${team.name}")
                },
                onError = {
                    Log.w("ARENA", "ARENA_TEAM_LOGO_FAILED team=${team.name}")
                    failed = true
                }
            )
        }
    }
}

private fun resolveSeriesTeam(series: Series, state: TeamState, fallback: Int): Team =
    series.teams.firstOrNull { it.id == state.id }
        ?: series.teams.firstOrNull { it.name.equals(state.name, ignoreCase = true) }
        ?: series.teams.getOrNull(fallback)
        ?: Team(state.id, state.name)

private fun pairPlayers(blue: List<PlayerState>, red: List<PlayerState>): List<V3PlayerPair> {
    val roles = listOf("top", "jungle", "mid", "bottom", "support")
    val blueRemaining = blue.toMutableList()
    val redRemaining = red.toMutableList()
    val pairs = mutableListOf<V3PlayerPair>()
    roles.forEach { role ->
        val blueIndex = blueRemaining.indexOfFirst { normalizedRole(it.role) == role }
        val redIndex = redRemaining.indexOfFirst { normalizedRole(it.role) == role }
        if (blueIndex >= 0 || redIndex >= 0) {
            pairs += V3PlayerPair(
                if (blueIndex >= 0) blueRemaining.removeAt(blueIndex) else null,
                if (redIndex >= 0) redRemaining.removeAt(redIndex) else null
            )
        }
    }
    repeat(maxOf(blueRemaining.size, redRemaining.size)) { index ->
        pairs += V3PlayerPair(blueRemaining.getOrNull(index), redRemaining.getOrNull(index))
    }
    return pairs
}

private fun normalizedRole(role: String?): String {
    val value = role.orEmpty().lowercase()
    return when {
        value.contains("top") -> "top"
        value.contains("jung") -> "jungle"
        value.contains("mid") -> "mid"
        value.contains("bot") || value.contains("adc") || value.contains("carry") -> "bottom"
        value.contains("sup") || value.contains("utility") -> "support"
        else -> "player"
    }
}

private fun championKey(championId: String?): String? {
    val raw = championId?.trim()?.takeIf { it.isNotBlank() } ?: return null
    if (raw.all(Char::isDigit)) return null
    return raw.replace(Regex("[^A-Za-z0-9]"), "").let { value ->
        when (value) {
            "Wukong" -> "MonkeyKing"
            "NunuWillump" -> "Nunu"
            "RenataGlasc" -> "Renata"
            else -> value
        }
    }.takeIf { it.isNotBlank() }
}

private fun championSquareImageUrl(championId: String?, patch: String?): String? {
    val raw = championId?.trim()?.takeIf { it.isNotBlank() } ?: return null
    if (raw.all(Char::isDigit)) {
        return "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/$raw.png"
    }
    val key = championKey(raw) ?: return null
    return "https://ddragon.leagueoflegends.com/cdn/${dataDragonVersion(patch)}/img/champion/$key.png"
}

private fun championLoadingImageUrl(championId: String?): String? {
    val key = championKey(championId) ?: return null
    return "https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${key}_0.jpg"
}

private fun dataDragonVersion(patch: String?): String {
    val parts = patch.orEmpty().trim().split('.')
    val reportedMajor = parts.getOrNull(0)?.toIntOrNull() ?: return "16.15.1"
    val minor = parts.getOrNull(1)?.toIntOrNull() ?: return "16.15.1"
    val major = if (reportedMajor >= 25) reportedMajor - 10 else reportedMajor
    return "$major.$minor.1"
}

private fun v3GameState(state: String): String = when (state) {
    "completed" -> "Final"
    "live", "draft", "paused" -> "Live"
    "unstarted", "scheduled" -> "Scheduled"
    else -> "Pending"
}

private fun v3GameStateColor(state: String): Color = when (state) {
    "completed" -> ArenaMuted
    "live", "draft", "paused" -> ArenaGreen
    else -> V3Yellow
}

private fun formatV3Clock(seconds: Int?): String = seconds?.let { "%d:%02d".format(it / 60, it % 60) } ?: "--:--"

private fun v3Compact(value: Int): String = when {
    value >= 10_000 -> "${value / 1_000}K"
    value >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000f).replace(".0K", "K")
    else -> value.toString()
}

private fun v3Age(seconds: Int): String = when {
    seconds < 60 -> "${seconds}s"
    seconds < 3_600 -> "${seconds / 60}m"
    else -> "${seconds / 3_600}h"
}
