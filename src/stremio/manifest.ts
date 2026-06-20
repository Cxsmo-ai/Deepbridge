export const manifest = {
  id: "community.deepbridge",
  version: "0.1.0",
  name: "Deepbridge",
  description:
    "Deepbrid official results plus extra Usenet indexer NZBs resolved through Deepbrid.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "kitsu", "anilist", "mal"],
  catalogs: [
    {
      type: "movie",
      id: "deepbridge-library-movies",
      name: "My Library Movies",
      extra: [{ name: "skip" }, { name: "search" }]
    },
    {
      type: "series",
      id: "deepbridge-library-tv",
      name: "My Library TV Shows",
      extra: [{ name: "skip" }, { name: "search" }]
    },
    {
      type: "series",
      id: "deepbridge-library-anime",
      name: "My Library Anime",
      extra: [{ name: "skip" }, { name: "search" }]
    }
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  }
};
