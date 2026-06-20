import assert from "node:assert/strict";
import { __libraryCatalogTest } from "../dist/deepbrid/libraryCatalog.js";

const { catalogForTorrent, parseLibraryItemId, itemId, directVideoLink } = __libraryCatalogTest;

const movieId = itemId("movie", "torrent-123");
assert.equal(movieId, "deepbridge-lib-movie-dG9ycmVudC0xMjM");
assert.deepEqual(parseLibraryItemId(movieId), {
  itemId: movieId,
  type: "movie",
  torrentId: "torrent-123",
  season: undefined,
  episode: undefined
});

const seriesId = itemId("series", "torrent-456");
assert.deepEqual(parseLibraryItemId(`${seriesId}:2:3`), {
  itemId: seriesId,
  type: "series",
  torrentId: "torrent-456",
  season: 2,
  episode: 3
});

assert.equal(
  catalogForTorrent({ id: "1", filename: "Movie.Title.2025.2160p.REMUX.mkv", progress: 100, seeders: 0, speed: "", links: [], status: "ready", error: 0 }).catalogId,
  "deepbridge-library-movies"
);
assert.equal(
  catalogForTorrent({ id: "2", filename: "Example.Show.S01E02.1080p.WEB-DL.mkv", progress: 100, seeders: 0, speed: "", links: [], status: "ready", error: 0 }).catalogId,
  "deepbridge-library-tv"
);
assert.equal(
  catalogForTorrent({ id: "3", filename: "[SubsPlease] Example Anime - 03 (1080p).mkv", progress: 100, seeders: 0, speed: "", links: [], status: "ready", error: 0 }).catalogId,
  "deepbridge-library-anime"
);
assert.equal(directVideoLink(["https://example.test/file.nfo", "https://example.test/video.mkv"]), "https://example.test/video.mkv");

console.log("Deepbrid library catalog tests passed");
