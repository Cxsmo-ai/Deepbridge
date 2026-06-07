export const manifest = {
  id: "community.deepbridge",
  version: "0.1.0",
  name: "Deepbridge",
  description:
    "Deepbrid official results plus extra Usenet indexer NZBs resolved through Deepbrid.",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "kitsu", "anilist", "mal"],
  catalogs: [],
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  }
};
