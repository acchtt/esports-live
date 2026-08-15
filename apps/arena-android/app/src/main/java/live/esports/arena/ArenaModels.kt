package live.esports.arena

data class Team(
    val id: String,
    val name: String,
    val code: String? = null,
    val imageUrl: String? = null
)

data class Competition(
    val id: String,
    val name: String,
    val region: String? = null,
    val stage: String? = null
)

data class SeriesGame(
    val id: String,
    val number: Int,
    val state: String
)

data class Series(
    val id: String,
    val competition: Competition,
    val teams: List<Team>,
    val bestOf: Int,
    val state: String,
    val scheduledStart: String,
    val games: List<SeriesGame>,
    val score: Map<String, Int>
) {
    val isLive: Boolean get() = state == "live" || state == "paused"
}

data class ScheduleEvent(
    val series: Series,
    val observedAt: String
)

data class ObjectiveState(
    val towers: Int? = null,
    val inhibitors: Int? = null,
    val dragons: List<String>? = null,
    val barons: Int? = null,
    val heralds: Int? = null,
    val grubs: Int? = null
)

data class PlayerState(
    val id: String,
    val handle: String?,
    val championId: String?,
    val role: String?,
    val level: Int?,
    val kills: Int?,
    val deaths: Int?,
    val assists: Int?,
    val creepScore: Int?,
    val totalGold: Int?
)

data class TeamState(
    val id: String,
    val name: String,
    val side: String,
    val gold: Int?,
    val kills: Int?,
    val objectives: ObjectiveState,
    val players: List<PlayerState>
)

data class LolStats(
    val gameClockSeconds: Int?,
    val patch: String?,
    val blue: TeamState,
    val red: TeamState
)

data class SnapshotQuality(
    val freshness: String,
    val observedAt: String,
    val ageSeconds: Int?,
    val complete: Boolean,
    val safeForLiveAnalysis: Boolean
)

data class LiveSnapshot(
    val series: Series,
    val game: SeriesGame,
    val stats: LolStats?,
    val quality: SnapshotQuality
)

data class Standing(
    val rank: Int?,
    val team: Team,
    val wins: Int?,
    val losses: Int?
)

data class Roster(
    val team: Team,
    val players: List<PlayerState>
)

data class SeriesHistory(
    val score: Map<String, Int>,
    val games: List<SeriesGame>
)

data class SeriesContext(
    val standings: List<Standing>,
    val rosters: List<Roster>,
    val history: SeriesHistory?,
    val complete: Boolean
)

enum class FeedStatus { LOADING, ONLINE, CACHED, ERROR }

enum class MatchFilter(val label: String) {
    ALL("All"), LIVE("Live"), UPCOMING("Upcoming"), RESULTS("Results")
}

enum class LeagueFilter(val label: String) {
    ALL("All leagues"), LCK("LCK"), LPL("LPL"), LEC("LEC"), LCS("LCS")
}

data class DetailState(
    val series: Series,
    val selectedGameId: String?,
    val loading: Boolean = true,
    val context: SeriesContext? = null,
    val snapshot: LiveSnapshot? = null,
    val error: String? = null
)

data class ArenaUiState(
    val events: List<ScheduleEvent> = emptyList(),
    val feedStatus: FeedStatus = FeedStatus.LOADING,
    val statusMessage: String = "Connecting to live scores",
    val matchFilter: MatchFilter = MatchFilter.ALL,
    val leagueFilter: LeagueFilter = LeagueFilter.ALL,
    val detail: DetailState? = null,
    val lastUpdatedAt: Long? = null
)
