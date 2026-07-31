from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


main_path = Path("apps/web/src/main.ts")
main = main_path.read_text()

main = main.replace(
    "const qualityBanner = requiredElement<HTMLElement>('#quality-banner');\n",
    "",
    1,
)
main = main.replace(
    "let lastSourceTimestamp: string | null = null;\n",
    "let lastSourceTimestamp: string | null = null;\nlet renderedGameId: string | null = null;\n",
    1,
)

quality_start = main.index("function hideQuality(): void {")
quality_end = main.index("function objectiveMarkup", quality_start)
main = main[:quality_start] + main[quality_end:]

main = main.replace(
    "function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {\n  renderQuality(snapshot);\n  const stats = snapshot.stats;\n  if (!stats) {\n",
    "function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {\n  const stats = snapshot.stats;\n  if (!stats) {\n    if (renderedGameId === snapshot.game.id) return;\n    renderedGameId = null;\n",
    1,
)
main = main.replace(
    "\n  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);\n",
    "\n  renderedGameId = snapshot.game.id;\n  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);\n",
    1,
)
main = main.replace(
    "function renderUpcoming(event: ScheduleEvent): void {\n  hideQuality();\n",
    "function renderUpcoming(event: ScheduleEvent): void {\n  renderedGameId = null;\n",
    1,
)
main = main.replace(
    "    hideQuality();\n    gameContent.innerHTML = `<div class=\"analysis-empty\"><h3>Live feed unavailable</h3><p>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</p></div>`;\n",
    "    if (renderedGameId !== requestedGame) {\n      renderedGameId = null;\n      gameContent.innerHTML = `<div class=\"analysis-empty\"><h3>Live feed unavailable</h3><p>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</p></div>`;\n    }\n",
    1,
)

main_path.write_text(main)

replace_once(
    "apps/web/index.html",
    "      #quality-banner[hidden],\n",
    "",
)
replace_once(
    "apps/web/index.html",
    "          <section id=\"quality-banner\" class=\"quality-banner hidden\" aria-live=\"polite\"></section>\n\n",
    "",
)
replace_once(
    "apps/web/index.html",
    "              <p>Live game state, objectives, player telemetry, and source quality will appear here.</p>\n",
    "              <p>Live game state, objectives, and player telemetry will appear here.</p>\n",
)

print("Removed the telemetry quality banner and preserved the last valid live panel during transient updates.")
