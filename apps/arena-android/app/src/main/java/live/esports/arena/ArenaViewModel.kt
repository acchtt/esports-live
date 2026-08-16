package live.esports.arena

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ArenaViewModel(application: Application) : AndroidViewModel(application) {
    private val api = ArenaApi()
    private val worker = Executors.newFixedThreadPool(3)
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val preferences = application.getSharedPreferences("arena_feed", Context.MODE_PRIVATE)
    private val loadingSchedule = AtomicBoolean(false)
    private val enrichingSeries = ConcurrentHashMap.newKeySet<String>()
    private var snapshotPoll: ScheduledFuture<*>? = null

    var uiState by mutableStateOf(ArenaUiState())
        private set

    init {
        loadCachedSchedule()
        refreshSchedule()
        scheduler.scheduleWithFixedDelay({ refreshSchedule(false) }, 45, 45, TimeUnit.SECONDS)
    }

    fun setMatchFilter(filter: MatchFilter) {
        uiState = uiState.copy(matchFilter = filter)
    }

    fun setLeagueFilter(filter: LeagueFilter) {
        uiState = uiState.copy(leagueFilter = filter)
    }

    fun refreshSchedule(showLoading: Boolean = true) {
        if (!loadingSchedule.compareAndSet(false, true)) return
        if (showLoading && uiState.events.isEmpty()) {
            uiState = uiState.copy(feedStatus = FeedStatus.LOADING, statusMessage = "Connecting to live scores")
        }
        worker.execute {
            try {
                val active = api.fetchSchedule("live,paused,scheduled,unknown")
                val completed = api.fetchSchedule("completed")
                val recoveredUpcoming = completed.value.filter { it.series.state != "completed" }
                val activeEvents = mergeEvents(active.value, recoveredUpcoming)
                val cachedCompleted = preferences.getString("completed", null)
                    ?.let { runCatching { api.parseSchedule(it) }.getOrDefault(emptyList()) }
                    .orEmpty()
                val recentResults = retainRecentResults(cachedCompleted, completed.value)
                val events = mergeEvents(activeEvents, recentResults)
                preferences.edit()
                    .putString("active", api.serializeSchedule(activeEvents))
                    .putString("completed", api.serializeSchedule(recentResults))
                    .putLong("savedAt", System.currentTimeMillis())
                    .apply()
                post {
                    uiState = uiState.copy(
                        events = events,
                        feedStatus = FeedStatus.ONLINE,
                        statusMessage = "Live feed connected",
                        lastUpdatedAt = System.currentTimeMillis()
                    )
                }
                val futureFinals = events.count { event ->
                    event.series.state == "completed" && runCatching {
                        Instant.parse(event.series.scheduledStart).isAfter(Instant.now().plusSeconds(300))
                    }.getOrDefault(false)
                }
                if (futureFinals == 0) Log.i("ARENA", "ARENA_SCHEDULE_STATE_SAFE futureFinals=0")
                recoveredUpcoming.forEach { warmCompletedSeries(it.series) }
                recentResults.take(12).forEach { warmCompletedSeries(it.series) }
            } catch (error: Exception) {
                post {
                    val hasCache = uiState.events.isNotEmpty()
                    uiState = uiState.copy(
                        feedStatus = if (hasCache) FeedStatus.CACHED else FeedStatus.ERROR,
                        statusMessage = if (hasCache) "Offline · showing saved matches" else friendlyError(error)
                    )
                }
            } finally {
                loadingSchedule.set(false)
            }
        }
    }

    fun openSeries(series: Series) {
        snapshotPoll?.cancel(false)
        val selectedGame = preferredGame(series.games)
        uiState = uiState.copy(
            detail = DetailState(series = series, selectedGameId = selectedGame?.id)
        )
        loadDetail(series, selectedGame)
    }

    fun closeSeries() {
        snapshotPoll?.cancel(false)
        snapshotPoll = null
        uiState = uiState.copy(detail = null)
    }

    fun selectGame(game: SeriesGame) {
        val detail = uiState.detail ?: return
        snapshotPoll?.cancel(false)
        uiState = uiState.copy(detail = detail.copy(selectedGameId = game.id, loading = true, error = null))
        loadSnapshot(detail.series, game, schedulePolling = true)
    }

    fun retryDetail() {
        val detail = uiState.detail ?: return
        val game = detail.series.games.firstOrNull { it.id == detail.selectedGameId }
        uiState = uiState.copy(detail = detail.copy(loading = true, error = null))
        loadDetail(detail.series, game)
    }

    fun warmCompletedSeries(series: Series) {
        if (!needsContextHydration(series)) return
        if (!enrichingSeries.add(series.id)) return
        worker.execute {
            try {
                val context = api.fetchContext(series.id)
                val enriched = enrichSeries(series, context)
                post {
                    val updatedEvents = uiState.events.map { event ->
                        if (event.series.id == series.id) event.copy(series = mergeSeries(event.series, enriched)) else event
                    }
                    val currentDetail = uiState.detail
                    val updatedDetail = if (currentDetail?.series?.id == series.id) {
                        val detailSeries = mergeSeries(currentDetail.series, enriched)
                        currentDetail.copy(
                            series = detailSeries,
                            context = currentDetail.context ?: context,
                            selectedGameId = currentDetail.selectedGameId ?: preferredGame(detailSeries.games)?.id
                        )
                    } else currentDetail
                    uiState = uiState.copy(events = updatedEvents, detail = updatedDetail)
                    persistSchedule(updatedEvents)
                    val left = enriched.teams.getOrNull(0)?.let { enriched.score[it.id] } ?: 0
                    val right = enriched.teams.getOrNull(1)?.let { enriched.score[it.id] } ?: 0
                    if (enriched.state == "completed" && (left > 0 || right > 0)) {
                        Log.i("ARENA", "ARENA_RESULT_ENRICHED id=${series.id} score=$left-$right")
                    } else {
                        Log.i("ARENA", "ARENA_SERIES_HYDRATED id=${series.id} state=${enriched.state}")
                    }
                    enrichingSeries.remove(series.id)
                }
            } catch (error: Exception) {
                Log.w("ARENA", "Could not enrich completed series ${series.id}", error)
                enrichingSeries.remove(series.id)
            }
        }
    }

    private fun loadDetail(series: Series, game: SeriesGame?) {
        worker.execute {
            var context: SeriesContext? = null
            var contextError: Exception? = null
            try {
                context = api.fetchContext(series.id)
            } catch (error: Exception) {
                contextError = error
            }

            val enrichedSeries = context?.let { enrichSeries(series, it) } ?: series
            val resolvedGame = game?.let { selected ->
                enrichedSeries.games.firstOrNull { it.id == selected.id } ?: selected
            } ?: preferredGame(enrichedSeries.games)
            val loadedContext = context
            post {
                val current = uiState.detail?.takeIf { it.series.id == series.id } ?: return@post
                val updatedEvents = uiState.events.map { event ->
                    if (event.series.id == series.id) event.copy(series = mergeSeries(event.series, enrichedSeries)) else event
                }
                uiState = uiState.copy(
                    events = updatedEvents,
                    detail = current.copy(
                        series = enrichedSeries,
                        selectedGameId = resolvedGame?.id,
                        loading = resolvedGame != null,
                        context = loadedContext,
                        error = if (resolvedGame == null) contextError?.let(::friendlyError) else null
                    )
                )
                persistSchedule(updatedEvents)
            }

            if (resolvedGame == null) return@execute

            try {
                val snapshot = api.fetchSnapshot(resolvedGame.id)
                post {
                    val current = uiState.detail?.takeIf {
                        it.series.id == series.id && it.selectedGameId == resolvedGame.id
                    } ?: return@post
                    val snapshotSeries = mergeSeries(current.series, snapshot.series).copy(
                        state = when (snapshot.game.state) {
                            "live", "draft" -> "live"
                            "paused" -> "paused"
                            "completed" -> if (current.series.state == "scheduled") "scheduled" else "completed"
                            else -> current.series.state
                        }
                    )
                    val stableSnapshot = stabilizeSnapshot(current.snapshot, snapshot, snapshotSeries)
                    val updatedEvents = uiState.events.map { event ->
                        if (event.series.id == series.id) event.copy(series = snapshotSeries) else event
                    }
                    uiState = uiState.copy(
                        events = updatedEvents,
                        detail = current.copy(
                            series = snapshotSeries,
                            loading = false,
                            context = loadedContext,
                            snapshot = stableSnapshot,
                            error = null
                        )
                    )
                    persistSchedule(updatedEvents)
                }
            } catch (error: Exception) {
                post {
                    val current = uiState.detail?.takeIf { it.series.id == series.id } ?: return@post
                    uiState = uiState.copy(
                        detail = current.copy(
                            loading = false,
                            context = loadedContext,
                            error = friendlyError(error)
                        )
                    )
                }
            }
            startSnapshotPolling(enrichedSeries, resolvedGame)
        }
    }

    private fun loadSnapshot(series: Series, game: SeriesGame, schedulePolling: Boolean) {
        worker.execute {
            try {
                val snapshot = api.fetchSnapshot(game.id)
                post {
                    val current = uiState.detail?.takeIf {
                        it.series.id == series.id && it.selectedGameId == game.id
                    } ?: return@post
                    val stableSnapshot = stabilizeSnapshot(current.snapshot, snapshot, current.series)
                    uiState = uiState.copy(detail = current.copy(loading = false, snapshot = stableSnapshot, error = null))
                }
            } catch (error: Exception) {
                post {
                    val current = uiState.detail?.takeIf {
                        it.series.id == series.id && it.selectedGameId == game.id
                    } ?: return@post
                    uiState = uiState.copy(detail = current.copy(loading = false, error = friendlyError(error)))
                }
            }
            if (schedulePolling) startSnapshotPolling(series, game)
        }
    }

    private fun startSnapshotPolling(series: Series, game: SeriesGame) {
        snapshotPoll?.cancel(false)
        if (game.state !in setOf("live", "paused", "draft")) {
            snapshotPoll = null
            return
        }
        val seconds = 5L
        snapshotPoll = scheduler.scheduleWithFixedDelay(
            { loadSnapshot(series, game, schedulePolling = false) },
            seconds,
            seconds,
            TimeUnit.SECONDS
        )
    }

    private fun loadCachedSchedule() {
        val active = preferences.getString("active", null)
        val completed = preferences.getString("completed", null)
        if (active == null && completed == null) return
        try {
            val events = mergeEvents(
                active?.let(api::parseSchedule).orEmpty(),
                retainRecentResults(completed?.let(api::parseSchedule).orEmpty())
            )
            if (events.isNotEmpty()) {
                uiState = uiState.copy(
                    events = events,
                    feedStatus = FeedStatus.CACHED,
                    statusMessage = "Updating saved matches",
                    lastUpdatedAt = preferences.getLong("savedAt", 0L).takeIf { it > 0 }
                )
                events.asSequence()
                    .filter { needsContextHydration(it.series) }
                    .take(12)
                    .forEach { warmCompletedSeries(it.series) }
            }
        } catch (_: Exception) {
            preferences.edit().clear().apply()
        }
    }

    private fun mergeEvents(first: List<ScheduleEvent>, second: List<ScheduleEvent>): List<ScheduleEvent> {
        val unique = linkedMapOf<String, ScheduleEvent>()
        (first + second).forEach { event ->
            val previous = unique[event.series.id]
            unique[event.series.id] = if (previous == null) event else event.copy(
                series = mergeSeries(previous.series, event.series),
                observedAt = event.observedAt.ifBlank { previous.observedAt }
            )
        }
        val now = Instant.now()
        return unique.values.sortedWith(
            compareBy<ScheduleEvent> { event ->
                when (event.series.state) {
                    "live", "paused" -> 0
                    "scheduled", "unknown" -> 1
                    else -> 2
                }
            }.thenBy { event ->
                val instant = runCatching { Instant.parse(event.series.scheduledStart) }.getOrNull() ?: Instant.EPOCH
                if (event.series.state == "completed") -instant.toEpochMilli() else instant.toEpochMilli().coerceAtLeast(now.minusSeconds(86_400).toEpochMilli())
            }
        )
    }

    private fun retainRecentResults(vararg sources: List<ScheduleEvent>): List<ScheduleEvent> {
        val cutoff = Instant.now().minusSeconds(RESULT_CACHE_DAYS * 86_400L)
        val merged = sources.fold(emptyList<ScheduleEvent>()) { acc, source -> mergeEvents(acc, source) }
        return merged.asSequence()
            .filter { it.series.state == "completed" }
            .filter { event ->
                runCatching { Instant.parse(event.series.scheduledStart) }.getOrNull()?.isAfter(cutoff) == true
            }
            .take(RESULT_CACHE_LIMIT)
            .toList()
    }

    private fun persistCompletedResults(events: List<ScheduleEvent>) {
        val recent = retainRecentResults(events.filter { it.series.state == "completed" })
        preferences.edit()
            .putString("completed", api.serializeSchedule(recent))
            .putLong("savedAt", System.currentTimeMillis())
            .apply()
    }

    private fun persistSchedule(events: List<ScheduleEvent>) {
        val active = events.filter { it.series.state != "completed" }
        preferences.edit()
            .putString("active", api.serializeSchedule(active))
            .apply()
        persistCompletedResults(events)
    }

    private fun enrichSeries(series: Series, context: SeriesContext): Series {
        val history = context.history ?: return series
        val games = history.games.filter { it.id.isNotBlank() }
        val activeGame = games.firstOrNull { it.state in setOf("live", "draft", "paused") }
        val winsRequired = (series.bestOf.coerceAtLeast(1) / 2) + 1
        val decisiveScore = history.score.values.maxOrNull()?.let { it >= winsRequired } == true
        val decisiveGames = games.count { it.state == "completed" } >= winsRequired
        val final = decisiveScore && decisiveGames
        val resolvedState = when {
            activeGame?.state == "paused" -> "paused"
            activeGame != null -> "live"
            final -> "completed"
            isRecentLpl(series) -> "scheduled"
            else -> series.state
        }
        val resolvedGames = when {
            final -> games.filter { it.state == "completed" }
            resolvedState == "scheduled" -> games.map { it.copy(state = "unstarted") }
            else -> games
        }
        return series.copy(
            state = resolvedState,
            score = if (resolvedState == "scheduled") emptyMap() else history.score.ifEmpty { series.score },
            games = resolvedGames.ifEmpty { series.games }
        )
    }

    private fun needsContextHydration(series: Series): Boolean {
        if (series.state == "completed") return series.score.isEmpty() || series.games.isEmpty()
        return isRecentLpl(series) && series.games.isEmpty()
    }

    private fun isRecentLpl(series: Series): Boolean {
        val searchable = "${series.competition.id} ${series.competition.name}".lowercase()
        val lpl = series.competition.id == "98767991314006698"
            || Regex("(^|[^a-z])lpl([^a-z]|$)").containsMatchIn(searchable)
            || searchable.contains("league of legends pro league")
        if (!lpl) return false
        val start = runCatching { Instant.parse(series.scheduledStart) }.getOrNull() ?: return false
        return start.isAfter(Instant.now().minusSeconds(12L * 60L * 60L))
    }

    private fun mergeSeries(previous: Series, incoming: Series): Series {
        val incomingCompetitionPlaceholder = isPlaceholderCompetition(incoming.competition)
        val incomingTeamsPlaceholder = incoming.teams.isNotEmpty() && incoming.teams.all(::isPlaceholderTeam)
        val usePreviousTeams = incoming.teams.isEmpty() || (incomingTeamsPlaceholder && previous.teams.any { !isPlaceholderTeam(it) })
        val teams = if (usePreviousTeams) {
            previous.teams
        } else {
            incoming.teams.mapIndexed { index, team ->
                val old = previous.teams.firstOrNull { oldTeam ->
                    oldTeam.id.isNotBlank() && team.id.isNotBlank() && oldTeam.id == team.id
                } ?: previous.teams.getOrNull(index)
                if (isPlaceholderTeam(team) && old != null && !isPlaceholderTeam(old)) {
                    old
                } else {
                    team.copy(
                        name = team.name.takeUnless { isPlaceholderTeamName(it) } ?: old?.name ?: team.name,
                        code = team.code ?: old?.code,
                        imageUrl = team.imageUrl ?: old?.imageUrl
                    )
                }
            }
        }
        val competition = if (incomingCompetitionPlaceholder && !isPlaceholderCompetition(previous.competition)) {
            previous.competition
        } else {
            incoming.competition.copy(
                id = incoming.competition.id.ifBlank { previous.competition.id },
                name = incoming.competition.name.takeUnless(::isPlaceholderCompetitionName) ?: previous.competition.name,
                region = incoming.competition.region ?: previous.competition.region,
                stage = incoming.competition.stage ?: previous.competition.stage
            )
        }
        val genericMetadata = incomingCompetitionPlaceholder || incomingTeamsPlaceholder
        return incoming.copy(
            id = previous.id,
            competition = competition,
            teams = teams,
            bestOf = if (genericMetadata && previous.bestOf > incoming.bestOf) previous.bestOf else incoming.bestOf,
            scheduledStart = incoming.scheduledStart.ifBlank { previous.scheduledStart },
            games = incoming.games.ifEmpty { previous.games },
            score = incoming.score.ifEmpty { previous.score }
        )
    }

    private fun stabilizeSnapshot(previous: LiveSnapshot?, incoming: LiveSnapshot, series: Series): LiveSnapshot {
        if (previous == null || previous.game.id != incoming.game.id) {
            return incoming.copy(series = series)
        }
        val previousStats = previous.stats
        val incomingStats = incoming.stats
        val stats = when {
            incomingStats == null -> previousStats
            previousStats == null -> incomingStats
            else -> incomingStats.copy(
                gameClockSeconds = incomingStats.gameClockSeconds ?: previousStats.gameClockSeconds,
                patch = incomingStats.patch ?: previousStats.patch,
                blue = stabilizeTeamState(previousStats.blue, incomingStats.blue),
                red = stabilizeTeamState(previousStats.red, incomingStats.red)
            )
        }
        if (incomingStats == null && previousStats != null) {
            Log.i("ARENA", "ARENA_SNAPSHOT_HELD game=${incoming.game.id} reason=missing_stats")
        }
        return incoming.copy(series = series, stats = stats)
    }

    private fun stabilizeTeamState(previous: TeamState, incoming: TeamState): TeamState {
        val previousPlayers = previous.players
        val players = if (incoming.players.size < previousPlayers.size) previousPlayers else incoming.players
        return incoming.copy(
            id = incoming.id.ifBlank { previous.id },
            name = incoming.name.takeUnless(::isPlaceholderTeamName) ?: previous.name,
            gold = incoming.gold ?: previous.gold,
            kills = incoming.kills ?: previous.kills,
            objectives = ObjectiveState(
                towers = incoming.objectives.towers ?: previous.objectives.towers,
                inhibitors = incoming.objectives.inhibitors ?: previous.objectives.inhibitors,
                dragons = incoming.objectives.dragons ?: previous.objectives.dragons,
                barons = incoming.objectives.barons ?: previous.objectives.barons,
                heralds = incoming.objectives.heralds ?: previous.objectives.heralds,
                grubs = incoming.objectives.grubs ?: previous.objectives.grubs
            ),
            players = players
        )
    }

    private fun isPlaceholderCompetition(competition: Competition): Boolean =
        competition.id.isBlank() || isPlaceholderCompetitionName(competition.name)

    private fun isPlaceholderCompetitionName(value: String): Boolean = when (value.trim().lowercase()) {
        "", "unknown", "unknown competition", "league of legends", "tbd" -> true
        else -> false
    }

    private fun isPlaceholderTeam(team: Team): Boolean =
        team.id.isBlank() || isPlaceholderTeamName(team.name)

    private fun isPlaceholderTeamName(value: String): Boolean = when (value.trim().lowercase()) {
        "", "team", "team 1", "team 2", "blue", "red", "blue team", "red team", "unknown", "tbd" -> true
        else -> false
    }

    private fun preferredGame(games: List<SeriesGame>): SeriesGame? =
        games.firstOrNull { it.state in setOf("live", "paused", "draft") }
            ?: games.filter { it.state == "completed" }.maxByOrNull { it.number }
            ?: games.minByOrNull { it.number }

    private fun post(block: () -> Unit) = main.post(block)

    private fun friendlyError(error: Exception): String = when (error) {
        is java.net.UnknownHostException -> "No internet connection"
        is java.net.SocketTimeoutException -> "Live scores took too long to respond"
        else -> error.message?.takeIf { it.isNotBlank() } ?: "Live scores are temporarily unavailable"
    }

    override fun onCleared() {
        snapshotPoll?.cancel(true)
        scheduler.shutdownNow()
        worker.shutdownNow()
        super.onCleared()
    }

    private companion object {
        const val RESULT_CACHE_DAYS = 14L
        const val RESULT_CACHE_LIMIT = 150
    }
}
