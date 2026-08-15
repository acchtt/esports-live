package live.esports.arena

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.request.ImageRequest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

@Composable
fun ArenaApp(
    viewModel: ArenaViewModel = viewModel(),
    onFirstFrame: () -> Unit = {}
) {
    val state = viewModel.uiState
    LaunchedEffect(Unit) { onFirstFrame() }
    BackHandler(enabled = state.detail != null) { viewModel.closeSeries() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ArenaBackground)
            .semantics { contentDescription = "ARENA_NATIVE_UI_READY" }
            .testTag("arena-native-root")
    ) {
        AnimatedContent(targetState = state.detail, label = "screen") { detail ->
            if (detail == null) {
                HomeScreen(
                    state = state,
                    onMatchFilter = viewModel::setMatchFilter,
                    onLeagueFilter = viewModel::setLeagueFilter,
                    onRefresh = { viewModel.refreshSchedule() },
                    onOpenSeries = viewModel::openSeries,
                    onVisibleSeries = viewModel::warmCompletedSeries
                )
            } else {
                MatchDetailScreen(
                    detail = detail,
                    onBack = viewModel::closeSeries,
                    onGame = viewModel::selectGame,
                    onRetry = viewModel::retryDetail
                )
            }
        }
    }
}

@Composable
private fun HomeScreen(
    state: ArenaUiState,
    onMatchFilter: (MatchFilter) -> Unit,
    onLeagueFilter: (LeagueFilter) -> Unit,
    onRefresh: () -> Unit,
    onOpenSeries: (Series) -> Unit,
    onVisibleSeries: (Series) -> Unit
) {
    val filtered = remember(state.events, state.matchFilter, state.leagueFilter) {
        state.events.filter { event ->
            matchesState(event.series, state.matchFilter) && matchesLeague(event.series, state.leagueFilter)
        }
    }

    Column(Modifier.fillMaxSize()) {
        ArenaHeader(state.feedStatus, state.statusMessage, onRefresh)
        MatchFilterRow(state.matchFilter, onMatchFilter)
        LeagueFilterRow(state.leagueFilter, onLeagueFilter)

        when {
            state.feedStatus == FeedStatus.LOADING && state.events.isEmpty() -> LoadingFeed()
            state.feedStatus == FeedStatus.ERROR && state.events.isEmpty() -> ErrorFeed(state.statusMessage, onRefresh)
            filtered.isEmpty() -> EmptyFeed(state.matchFilter, state.leagueFilter)
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    FeedSummary(filtered.size, state.feedStatus, state.lastUpdatedAt)
                }
                items(filtered, key = { it.series.id }) { event ->
                    MatchCard(
                        event.series,
                        onClick = { onOpenSeries(event.series) },
                        onVisible = { onVisibleSeries(event.series) }
                    )
                }
                item { Spacer(Modifier.navigationBarsPadding()) }
            }
        }
    }
}

@Composable
private fun ArenaHeader(status: FeedStatus, message: String, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(start = 18.dp, top = 14.dp, end = 8.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ArenaMark(38.dp)
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "ARENA",
                color = ArenaText,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 1.8.sp
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(6.dp)
                        .background(statusColor(status), CircleShape)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    message.uppercase(Locale.ROOT),
                    color = ArenaMuted,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.7.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = ArenaCyan.copy(alpha = 0.10f)
        ) {
            Text(
                "LOL",
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                color = ArenaCyan,
                fontSize = 11.sp,
                fontWeight = FontWeight.Black
            )
        }
        IconButton(onClick = onRefresh) {
            Icon(Icons.Default.Refresh, contentDescription = "Refresh matches", tint = ArenaText)
        }
    }
}

@Composable
private fun MatchFilterRow(selected: MatchFilter, onSelect: (MatchFilter) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        MatchFilter.entries.forEach { filter ->
            FilterChip(
                selected = selected == filter,
                onClick = { onSelect(filter) },
                label = { Text(filter.label, fontWeight = FontWeight.SemiBold) },
                colors = FilterChipDefaults.filterChipColors(
                    containerColor = ArenaSurface,
                    labelColor = ArenaMuted,
                    selectedContainerColor = ArenaCyan,
                    selectedLabelColor = ArenaBackground
                ),
                border = FilterChipDefaults.filterChipBorder(
                    enabled = true,
                    selected = selected == filter,
                    borderColor = ArenaLine,
                    selectedBorderColor = ArenaCyan
                )
            )
        }
    }
}

@Composable
private fun LeagueFilterRow(selected: LeagueFilter, onSelect: (LeagueFilter) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        LeagueFilter.entries.forEach { filter ->
            Surface(
                modifier = Modifier.clickable { onSelect(filter) },
                shape = RoundedCornerShape(8.dp),
                color = if (selected == filter) ArenaSurfaceRaised else Color.Transparent,
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (selected == filter) ArenaRed.copy(alpha = 0.8f) else Color.Transparent
                )
            ) {
                Text(
                    filter.label.uppercase(Locale.ROOT),
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                    color = if (selected == filter) ArenaText else ArenaMuted,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.6.sp
                )
            }
        }
    }
}

@Composable
private fun FeedSummary(count: Int, status: FeedStatus, updatedAt: Long?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 2.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            "$count MATCH${if (count == 1) "" else "ES"}",
            color = ArenaMuted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp
        )
        if (updatedAt != null) {
            Text(
                if (status == FeedStatus.CACHED) "SAVED ${relativeTime(updatedAt)}" else "UPDATED ${relativeTime(updatedAt)}",
                color = if (status == FeedStatus.CACHED) ArenaGold else ArenaMuted,
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
private fun MatchCard(series: Series, onClick: () -> Unit, onVisible: () -> Unit) {
    val left = series.teams.getOrNull(0) ?: Team("left", "TBD")
    val right = series.teams.getOrNull(1) ?: Team("right", "TBD")
    LaunchedEffect(series.id, series.state, series.score.size, series.games.size) {
        onVisible()
    }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        color = ArenaSurface,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (series.isLive) ArenaRed.copy(alpha = 0.55f) else ArenaLine
        )
    ) {
        Column(Modifier.padding(15.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        series.competition.name.uppercase(Locale.ROOT),
                        color = ArenaText,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        listOfNotNull(series.competition.stage, "BEST OF ${series.bestOf}").joinToString(" · ").uppercase(Locale.ROOT),
                        color = ArenaMuted,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1
                    )
                }
                MatchStatusPill(series)
            }
            Spacer(Modifier.height(14.dp))
            TeamRow(left, series.score[left.id], series.state, ArenaCyan)
            Spacer(Modifier.height(10.dp))
            TeamRow(right, series.score[right.id], series.state, ArenaRed)
            Spacer(Modifier.height(13.dp))
            HorizontalDivider(color = ArenaLine.copy(alpha = 0.65f))
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatMatchTime(series.scheduledStart), color = ArenaMuted, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                Text("MATCH CENTER  ›", color = ArenaCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun TeamRow(team: Team, score: Int?, state: String, accent: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        TeamAvatar(team, accent, 34.dp)
        Spacer(Modifier.width(11.dp))
        Text(
            team.name,
            modifier = Modifier.weight(1f),
            color = ArenaText,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            if (state in setOf("scheduled", "unknown") || score == null) "–" else score.toString(),
            color = ArenaText,
            fontSize = 22.sp,
            fontWeight = FontWeight.Black
        )
    }
}

@Composable
private fun MatchStatusPill(series: Series) {
    val color = when (series.state) {
        "live", "paused" -> ArenaRed
        "completed" -> ArenaGreen
        else -> ArenaCyan
    }
    val label = when (series.state) {
        "live" -> "LIVE"
        "paused" -> "PAUSED"
        "completed" -> "FINAL"
        else -> shortTime(series.scheduledStart)
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (series.isLive) {
            Box(Modifier.size(6.dp).background(color, CircleShape))
            Spacer(Modifier.width(5.dp))
        }
        Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun LoadingFeed() {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(color = ArenaCyan, strokeWidth = 3.dp, modifier = Modifier.size(38.dp))
        Spacer(Modifier.height(18.dp))
        Text("Loading LoL matches", color = ArenaText, fontWeight = FontWeight.Bold)
        Text("Connecting to the ARENA score service", color = ArenaMuted, fontSize = 12.sp)
    }
}

@Composable
private fun ErrorFeed(message: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        ArenaMark(58.dp)
        Spacer(Modifier.height(18.dp))
        Text("Scores are offline", color = ArenaText, fontSize = 20.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(6.dp))
        Text(message, color = ArenaMuted, fontSize = 13.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        TextButton(
            onClick = onRetry,
            colors = ButtonDefaults.textButtonColors(contentColor = ArenaCyan)
        ) { Text("TRY AGAIN", fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun EmptyFeed(matchFilter: MatchFilter, leagueFilter: LeagueFilter) {
    Column(
        Modifier.fillMaxSize().padding(30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("No matches here", color = ArenaText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Text(
            "No ${matchFilter.label.lowercase()} matches for ${leagueFilter.label}.",
            color = ArenaMuted,
            fontSize = 12.sp,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun MatchDetailScreen(
    detail: DetailState,
    onBack: () -> Unit,
    onGame: (SeriesGame) -> Unit,
    onRetry: () -> Unit
) {
    val series = detail.series
    Column(Modifier.fillMaxSize()) {
        DetailHeader(series, onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 26.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (series.games.isNotEmpty()) {
                item { V3GameSelector(series.games, detail.selectedGameId, onGame) }
            }
            if (detail.loading && detail.snapshot == null) {
                item { DetailLoading() }
            }
            detail.error?.let { message ->
                item { DetailError(message, onRetry) }
            }
            detail.snapshot?.let { snapshot ->
                snapshot.stats?.let { stats ->
                    item { V3Scoreboard(series, snapshot, stats) }
                } ?: item { WaitingForTelemetry(snapshot.game.state) }
            }
            if (detail.snapshot?.stats == null) detail.context?.standings?.takeIf { it.isNotEmpty() }?.let { standings ->
                item { StandingsBoard(standings) }
            }
            item { Spacer(Modifier.navigationBarsPadding()) }
        }
    }
}

@Composable
private fun DetailHeader(series: Series, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 4.dp, top = 8.dp, end = 14.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = ArenaText)
        }
        Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
            Text(
                series.competition.name.uppercase(Locale.ROOT),
                color = ArenaCyan,
                fontSize = 10.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${series.teams.getOrNull(0)?.name ?: "TBD"} vs ${series.teams.getOrNull(1)?.name ?: "TBD"}",
                color = ArenaText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                listOfNotNull(series.competition.stage, formatMatchTime(series.scheduledStart)).joinToString(" · "),
                color = ArenaMuted,
                fontSize = 10.sp,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun SeriesHero(series: Series) {
    val left = series.teams.getOrNull(0) ?: Team("left", "TBD")
    val right = series.teams.getOrNull(1) ?: Team("right", "TBD")
    val leftScore = series.score[left.id]?.toString() ?: "–"
    val rightScore = series.score[right.id]?.toString() ?: "–"
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = ArenaSurface,
        border = androidx.compose.foundation.BorderStroke(1.dp, ArenaLine)
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                listOfNotNull(series.competition.stage, "BEST OF ${series.bestOf}").joinToString(" · ").uppercase(Locale.ROOT),
                color = ArenaMuted,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.7.sp
            )
            Spacer(Modifier.height(15.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                HeroTeam(left, ArenaCyan, Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(84.dp)) {
                    Text(
                        "$leftScore  :  $rightScore",
                        color = ArenaText,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text(formatMatchTime(series.scheduledStart), color = ArenaMuted, fontSize = 9.sp, textAlign = TextAlign.Center)
                }
                HeroTeam(right, ArenaRed, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun HeroTeam(team: Team, accent: Color, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        TeamAvatar(team, accent, 52.dp)
        Spacer(Modifier.height(8.dp))
        Text(
            team.code ?: team.name,
            color = ArenaText,
            fontSize = 12.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun GameSelector(games: List<SeriesGame>, selectedId: String?, onGame: (SeriesGame) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        games.sortedBy { it.number }.forEach { game ->
            val selected = game.id == selectedId
            Surface(
                modifier = Modifier.clickable { onGame(game) },
                shape = RoundedCornerShape(10.dp),
                color = if (selected) ArenaCyan else ArenaSurface,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) ArenaCyan else ArenaLine)
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("GAME ${game.number}", color = if (selected) ArenaBackground else ArenaText, fontSize = 10.sp, fontWeight = FontWeight.Black)
                    Text(game.state.uppercase(Locale.ROOT), color = if (selected) ArenaBackground.copy(alpha = 0.7f) else gameStateColor(game.state), fontSize = 8.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun DetailLoading() {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = ArenaSurface) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(24.dp), color = ArenaCyan, strokeWidth = 2.dp)
            Spacer(Modifier.width(12.dp))
            Text("Loading game data", color = ArenaMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun DetailError(message: String, onRetry: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = ArenaRed.copy(alpha = 0.09f),
        border = androidx.compose.foundation.BorderStroke(1.dp, ArenaRed.copy(alpha = 0.35f))
    ) {
        Row(Modifier.padding(start = 14.dp, top = 8.dp, end = 5.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), color = ArenaText, fontSize = 11.sp)
            TextButton(onClick = onRetry) { Text("RETRY", color = ArenaRed, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun SnapshotFreshness(quality: SnapshotQuality) {
    val good = quality.freshness == "fresh"
    val color = if (good) ArenaGreen else ArenaGold
    Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(
            if (good) "LIVE DATA · ${quality.ageSeconds?.let { "${it}s old" } ?: "just now"}" else "${quality.freshness.uppercase()} DATA",
            color = color,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.6.sp
        )
    }
}

@Composable
private fun LiveScoreboard(snapshot: LiveSnapshot, stats: LolStats) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = ArenaSurface,
        border = androidx.compose.foundation.BorderStroke(1.dp, ArenaLine)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("GAME ${snapshot.game.number}", color = ArenaMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(formatClock(stats.gameClockSeconds), color = ArenaText, fontSize = 28.sp, fontWeight = FontWeight.Black)
                Text(stats.patch?.let { "PATCH $it" } ?: "LIVE", color = ArenaMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                LiveTeam(stats.blue, ArenaCyan, Modifier.weight(1f), Alignment.Start)
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(80.dp)) {
                    Text(
                        "${stats.blue.kills ?: "–"}  :  ${stats.red.kills ?: "–"}",
                        color = ArenaText,
                        fontSize = 27.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text("KILLS", color = ArenaMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                }
                LiveTeam(stats.red, ArenaRed, Modifier.weight(1f), Alignment.End)
            }
            Spacer(Modifier.height(18.dp))
            GoldBar(stats.blue.gold, stats.red.gold)
        }
    }
}

@Composable
private fun LiveTeam(team: TeamState, accent: Color, modifier: Modifier, alignment: Alignment.Horizontal) {
    Column(modifier, horizontalAlignment = alignment) {
        Box(Modifier.size(10.dp).background(accent, CircleShape))
        Spacer(Modifier.height(7.dp))
        Text(team.name, color = ArenaText, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(formatGold(team.gold), color = accent, fontSize = 14.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun GoldBar(blue: Int?, red: Int?) {
    val total = (blue ?: 0) + (red ?: 0)
    val blueWeight = if (total > 0) (blue ?: 0).toFloat() / total else 0.5f
    val diff = if (blue != null && red != null) blue - red else null
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("GOLD", color = ArenaMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
            Text(
                diff?.let { "${if (it >= 0) "+" else ""}${formatGold(abs(it))} ${if (it >= 0) "BLUE" else "RED"}" } ?: "NO GOLD DATA",
                color = if ((diff ?: 0) >= 0) ArenaCyan else ArenaRed,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold
            )
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth().height(7.dp).clip(RoundedCornerShape(8.dp))) {
            Box(Modifier.weight(blueWeight.coerceIn(0.08f, 0.92f)).fillMaxHeight().background(ArenaCyan))
            Box(Modifier.weight((1f - blueWeight).coerceIn(0.08f, 0.92f)).fillMaxHeight().background(ArenaRed))
        }
    }
}

@Composable
private fun ObjectiveBoard(stats: LolStats) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = ArenaSurface) {
        Column(Modifier.padding(15.dp)) {
            SectionTitle("OBJECTIVES")
            Spacer(Modifier.height(12.dp))
            ObjectiveRow("Towers", stats.blue.objectives.towers, stats.red.objectives.towers)
            ObjectiveRow("Dragons", stats.blue.objectives.dragons?.size, stats.red.objectives.dragons?.size)
            ObjectiveRow("Barons", stats.blue.objectives.barons, stats.red.objectives.barons)
            ObjectiveRow("Heralds", stats.blue.objectives.heralds, stats.red.objectives.heralds)
            AnimatedVisibility(stats.blue.objectives.grubs != null || stats.red.objectives.grubs != null) {
                ObjectiveRow("Void grubs", stats.blue.objectives.grubs, stats.red.objectives.grubs)
            }
        }
    }
}

@Composable
private fun ObjectiveRow(label: String, blue: Int?, red: Int?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text((blue ?: 0).toString(), Modifier.weight(1f), color = ArenaCyan, fontSize = 14.sp, fontWeight = FontWeight.Black)
        Text(label.uppercase(Locale.ROOT), Modifier.weight(2f), color = ArenaMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text((red ?: 0).toString(), Modifier.weight(1f), color = ArenaRed, fontSize = 14.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.End)
    }
}

@Composable
private fun PlayerBoard(team: TeamState) {
    val accent = if (team.side == "blue") ArenaCyan else ArenaRed
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = ArenaSurface) {
        Column(Modifier.padding(15.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                SectionTitle(team.name.uppercase(Locale.ROOT))
                Text(team.side.uppercase(Locale.ROOT), color = accent, fontSize = 9.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.height(9.dp))
            team.players.forEachIndexed { index, player ->
                if (index > 0) HorizontalDivider(color = ArenaLine.copy(alpha = 0.45f))
                Row(Modifier.fillMaxWidth().padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(player.handle ?: "Unknown player", color = ArenaText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Text(listOfNotNull(player.role, player.championId).joinToString(" · ").ifBlank { "–" }, color = ArenaMuted, fontSize = 9.sp)
                    }
                    PlayerMetric("KDA", "${player.kills ?: 0}/${player.deaths ?: 0}/${player.assists ?: 0}")
                    PlayerMetric("CS", player.creepScore?.toString() ?: "–")
                    PlayerMetric("GOLD", formatGold(player.totalGold))
                }
            }
        }
    }
}

@Composable
private fun PlayerMetric(label: String, value: String) {
    Column(Modifier.width(50.dp), horizontalAlignment = Alignment.End) {
        Text(value, color = ArenaText, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(label, color = ArenaMuted, fontSize = 7.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun StandingsBoard(standings: List<Standing>) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = ArenaSurface) {
        Column(Modifier.padding(15.dp)) {
            SectionTitle("STANDINGS")
            Spacer(Modifier.height(9.dp))
            standings.take(8).forEach { standing ->
                Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(standing.rank?.toString() ?: "–", Modifier.width(25.dp), color = ArenaMuted, fontSize = 11.sp)
                    TeamAvatar(standing.team, ArenaCyan, 26.dp)
                    Spacer(Modifier.width(9.dp))
                    Text(standing.team.name, Modifier.weight(1f), color = ArenaText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    Text("${standing.wins ?: "–"}–${standing.losses ?: "–"}", color = ArenaText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun WaitingForTelemetry(state: String) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = ArenaSurface) {
        Column(Modifier.padding(18.dp)) {
            SectionTitle("GAME DATA")
            Spacer(Modifier.height(7.dp))
            Text(
                if (state == "unstarted") "Live stats will appear when the game begins." else "Detailed stats are not available for this game yet.",
                color = ArenaMuted,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun SectionTitle(value: String) {
    Text(value, color = ArenaText, fontSize = 10.sp, fontWeight = FontWeight.Black, letterSpacing = 0.8.sp)
}

@Composable
private fun TeamAvatar(team: Team, accent: Color, size: androidx.compose.ui.unit.Dp) {
    val context = LocalContext.current
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size / 3))
            .background(accent.copy(alpha = 0.12f))
            .border(1.dp, accent.copy(alpha = 0.4f), RoundedCornerShape(size / 3)),
        contentAlignment = Alignment.Center
    ) {
        Text(
            initials(team),
            color = accent,
            fontSize = (size.value * 0.30f).sp,
            fontWeight = FontWeight.Black
        )
        team.imageUrl?.let { imageUrl ->
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(imageUrl)
                    .memoryCacheKey("arena-team:$imageUrl")
                    .diskCacheKey("arena-team:$imageUrl")
                    .crossfade(true)
                    .build(),
                imageLoader = ArenaImageLoader.get(context),
                contentDescription = "${team.name} logo",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(size * 0.12f)
            )
        }
    }
}

@Composable
private fun ArenaMark(size: androidx.compose.ui.unit.Dp) {
    Canvas(Modifier.size(size)) {
        val width = this.size.width
        val height = this.size.height
        val cyan = Path().apply {
            moveTo(width * .50f, height * .05f)
            lineTo(width * .16f, height * .88f)
            lineTo(width * .40f, height * .78f)
            lineTo(width * .60f, height * .25f)
            close()
        }
        val red = Path().apply {
            moveTo(width * .60f, height * .25f)
            lineTo(width * .50f, height * .53f)
            lineTo(width * .70f, height * .86f)
            lineTo(width * .88f, height * .90f)
            close()
        }
        drawPath(cyan, ArenaCyan)
        drawPath(red, ArenaRed)
        drawLine(ArenaText, Offset(width * .42f, height * .74f), Offset(width * .68f, height * .83f), strokeWidth = width * .06f, cap = StrokeCap.Round)
    }
}

private fun matchesState(series: Series, filter: MatchFilter): Boolean = when (filter) {
    MatchFilter.ALL -> true
    MatchFilter.LIVE -> series.state in setOf("live", "paused")
    MatchFilter.UPCOMING -> series.state in setOf("scheduled", "unknown")
    MatchFilter.RESULTS -> series.state == "completed"
}

private fun matchesLeague(series: Series, filter: LeagueFilter): Boolean {
    if (filter == LeagueFilter.ALL) return true
    val searchable = "${series.competition.name} ${series.competition.region}".uppercase(Locale.ROOT)
    return searchable.contains(filter.label)
}

private fun initials(team: Team): String {
    team.code?.takeIf { it.isNotBlank() }?.let { return it.take(3).uppercase(Locale.ROOT) }
    return team.name.split(Regex("\\s+")).filter(String::isNotBlank).take(3).mapNotNull { it.firstOrNull() }.joinToString("").uppercase(Locale.ROOT).ifBlank { "?" }
}

private fun statusColor(status: FeedStatus): Color = when (status) {
    FeedStatus.ONLINE -> ArenaGreen
    FeedStatus.CACHED -> ArenaGold
    FeedStatus.ERROR -> ArenaRed
    FeedStatus.LOADING -> ArenaCyan
}

private fun gameStateColor(state: String): Color = when (state) {
    "live", "paused", "draft" -> ArenaRed
    "completed" -> ArenaGreen
    else -> ArenaMuted
}

private fun parseInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()

private fun shortTime(value: String): String = parseInstant(value)
    ?.atZone(ZoneId.systemDefault())
    ?.format(DateTimeFormatter.ofPattern("HH:mm"))
    ?: "TBD"

private fun formatMatchTime(value: String): String {
    val dateTime = parseInstant(value)?.atZone(ZoneId.systemDefault()) ?: return "Time TBD"
    val today = LocalDate.now()
    val day = when (dateTime.toLocalDate()) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        today.minusDays(1) -> "Yesterday"
        else -> dateTime.format(DateTimeFormatter.ofPattern("EEE, d MMM"))
    }
    return "$day · ${dateTime.format(DateTimeFormatter.ofPattern("HH:mm"))}"
}

private fun formatClock(seconds: Int?): String {
    if (seconds == null) return "--:--"
    return "%02d:%02d".format(seconds / 60, seconds % 60)
}

private fun formatGold(value: Int?): String {
    if (value == null) return "–"
    return if (value >= 1000) String.format(Locale.US, "%.1fk", value / 1000f) else value.toString()
}

private fun relativeTime(epochMillis: Long): String {
    val seconds = Duration.between(Instant.ofEpochMilli(epochMillis), Instant.now()).seconds.coerceAtLeast(0)
    return when {
        seconds < 60 -> "NOW"
        seconds < 3600 -> "${seconds / 60}M AGO"
        else -> "${seconds / 3600}H AGO"
    }
}
