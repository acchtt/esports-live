package live.esports.arena

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class ApiPayload<T>(val value: T, val raw: String)

class ArenaApi(private val baseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/')) {
    fun fetchSchedule(states: String): ApiPayload<List<ScheduleEvent>> {
        val raw = get("/v1/lol/schedule?states=$states&limit=100")
        return ApiPayload(parseSchedule(raw), raw)
    }

    fun parseSchedule(raw: String): List<ScheduleEvent> {
        val root = JSONObject(raw)
        require(root.optString("esport") == "lol") { "Unexpected esport response" }
        return root.optJSONArray("events").objects().map(::parseScheduleEvent)
    }

    fun fetchContext(seriesId: String): SeriesContext {
        return parseContext(get("/v1/lol/series/${encodePath(seriesId)}/context"))
    }

    fun fetchSnapshot(gameId: String): LiveSnapshot {
        return parseSnapshot(get("/v1/lol/games/${encodePath(gameId)}/live"))
    }

    fun parseContext(raw: String): SeriesContext {
        val root = JSONObject(raw)
        val standings = root.optJSONArray("standings").objects().map { item ->
            Standing(
                rank = item.intOrNull("rank"),
                team = parseTeam(item.getJSONObject("team")),
                wins = item.intOrNull("wins"),
                losses = item.intOrNull("losses")
            )
        }
        val rosters = root.optJSONArray("rosters").objects().map { item ->
            Roster(
                team = parseTeam(item.getJSONObject("team")),
                players = item.optJSONArray("players").objects().map(::parseRosterPlayer)
            )
        }
        return SeriesContext(standings, rosters, root.optBoolean("complete", false))
    }

    fun parseSnapshot(raw: String): LiveSnapshot {
        val root = JSONObject(raw)
        val qualityJson = root.optJSONObject("quality") ?: JSONObject()
        val quality = SnapshotQuality(
            freshness = qualityJson.optString("freshness", "unavailable"),
            observedAt = qualityJson.optString("observedAt", ""),
            ageSeconds = qualityJson.intOrNull("ageSeconds"),
            complete = qualityJson.optBoolean("complete", false),
            safeForLiveAnalysis = qualityJson.optBoolean("safeForLiveAnalysis", false)
        )
        val stats = root.optJSONObject("stats")?.let(::parseStats)
        return LiveSnapshot(
            series = parseSeries(root.getJSONObject("series")),
            game = parseGame(root.getJSONObject("game")),
            stats = stats,
            quality = quality
        )
    }

    private fun get(path: String): String {
        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "ARENA-Android/${BuildConfig.VERSION_NAME}")
            useCaches = false
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IOException("Score service returned HTTP $status")
            if (body.isBlank()) throw IOException("Score service returned an empty response")
            return body
        } finally {
            connection.disconnect()
        }
    }

    private fun parseScheduleEvent(json: JSONObject) = ScheduleEvent(
        series = parseSeries(json.getJSONObject("series")),
        observedAt = json.optString("observedAt", "")
    )

    private fun parseSeries(json: JSONObject): Series {
        val teams = json.optJSONArray("teams").objects().map(::parseTeam)
        val score = json.optJSONArray("score").objects().associate { item ->
            item.getJSONObject("team").optString("id") to item.optInt("wins", 0)
        }
        return Series(
            id = json.getString("id"),
            competition = parseCompetition(json.getJSONObject("competition")),
            teams = teams,
            bestOf = json.optInt("bestOf", 1),
            state = json.optString("state", "unknown"),
            scheduledStart = json.optString("scheduledStart", ""),
            games = json.optJSONArray("games").objects().map(::parseGame),
            score = score
        )
    }

    private fun parseCompetition(json: JSONObject) = Competition(
        id = json.optString("id"),
        name = json.optString("name", "League of Legends"),
        region = json.stringOrNull("region"),
        stage = json.stringOrNull("stage")
    )

    private fun parseTeam(json: JSONObject) = Team(
        id = json.optString("id"),
        name = json.optString("name", "TBD"),
        code = json.stringOrNull("code"),
        imageUrl = json.stringOrNull("imageUrl")
    )

    private fun parseGame(json: JSONObject) = SeriesGame(
        id = json.optString("id"),
        number = json.optInt("number", 1),
        state = json.optString("state", "unknown")
    )

    private fun parseStats(json: JSONObject) = LolStats(
        gameClockSeconds = json.intOrNull("gameClockSeconds"),
        patch = json.stringOrNull("patch"),
        blue = parseTeamState(json.getJSONObject("blue")),
        red = parseTeamState(json.getJSONObject("red"))
    )

    private fun parseTeamState(json: JSONObject) = TeamState(
        id = json.optString("id"),
        name = json.optString("name", "Team"),
        side = json.optString("side", "blue"),
        gold = json.intOrNull("gold"),
        kills = json.intOrNull("kills"),
        objectives = json.optJSONObject("objectives")?.let(::parseObjectives) ?: ObjectiveState(),
        players = json.optJSONArray("players").objects().map(::parsePlayer)
    )

    private fun parseObjectives(json: JSONObject) = ObjectiveState(
        towers = json.intOrNull("towers"),
        inhibitors = json.intOrNull("inhibitors"),
        dragons = json.optJSONArray("dragons")?.strings(),
        barons = json.intOrNull("barons"),
        heralds = json.intOrNull("heralds"),
        grubs = json.intOrNull("grubs")
    )

    private fun parsePlayer(json: JSONObject) = PlayerState(
        id = json.optString("id"),
        handle = json.stringOrNull("handle"),
        championId = json.stringOrNull("championId"),
        role = json.stringOrNull("role"),
        level = json.intOrNull("level"),
        kills = json.intOrNull("kills"),
        deaths = json.intOrNull("deaths"),
        assists = json.intOrNull("assists"),
        creepScore = json.intOrNull("creepScore"),
        totalGold = json.intOrNull("totalGold")
    )

    private fun parseRosterPlayer(json: JSONObject) = PlayerState(
        id = json.optString("id"),
        handle = json.stringOrNull("handle") ?: json.stringOrNull("displayName"),
        championId = null,
        role = json.stringOrNull("role"),
        level = null,
        kills = null,
        deaths = null,
        assists = null,
        creepScore = null,
        totalGold = null
    )

    private fun encodePath(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}

private fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index) }
}

private fun JSONArray.strings(): List<String> =
    (0 until length()).mapNotNull { index -> optString(index).takeIf(String::isNotBlank) }

private fun JSONObject.stringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}

private fun JSONObject.intOrNull(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return optInt(key)
}
