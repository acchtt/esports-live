package live.esports.arena

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import java.time.Instant
import java.util.concurrent.Executors
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
                val events = mergeEvents(active.value, completed.value)
                preferences.edit()
                    .putString("active", active.raw)
                    .putString("completed", completed.raw)
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

    private fun loadDetail(series: Series, game: SeriesGame?) {
        worker.execute {
            var context: SeriesContext? = null
            var contextError: Exception? = null
            try {
                context = api.fetchContext(series.id)
            } catch (error: Exception) {
                contextError = error
            }

            if (game == null) {
                val loadedContext = context
                post {
                    val current = uiState.detail?.takeIf { it.series.id == series.id } ?: return@post
                    uiState = uiState.copy(
                        detail = current.copy(
                            loading = false,
                            context = loadedContext,
                            error = contextError?.let(::friendlyError)
                        )
                    )
                }
                return@execute
            }

            try {
                val snapshot = api.fetchSnapshot(game.id)
                val loadedContext = context
                post {
                    val current = uiState.detail?.takeIf {
                        it.series.id == series.id && it.selectedGameId == game.id
                    } ?: return@post
                    uiState = uiState.copy(
                        detail = current.copy(
                            loading = false,
                            context = loadedContext,
                            snapshot = snapshot,
                            error = null
                        )
                    )
                }
            } catch (error: Exception) {
                val loadedContext = context
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
            startSnapshotPolling(series, game)
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
                    uiState = uiState.copy(detail = current.copy(loading = false, snapshot = snapshot, error = null))
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
        val seconds = if (game.state in setOf("live", "paused", "draft")) 5L else 20L
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
                completed?.let(api::parseSchedule).orEmpty()
            )
            if (events.isNotEmpty()) {
                uiState = uiState.copy(
                    events = events,
                    feedStatus = FeedStatus.CACHED,
                    statusMessage = "Updating saved matches",
                    lastUpdatedAt = preferences.getLong("savedAt", 0L).takeIf { it > 0 }
                )
            }
        } catch (_: Exception) {
            preferences.edit().clear().apply()
        }
    }

    private fun mergeEvents(first: List<ScheduleEvent>, second: List<ScheduleEvent>): List<ScheduleEvent> {
        val unique = (first + second).associateBy { it.series.id }.values
        val now = Instant.now()
        return unique.sortedWith(
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
}
