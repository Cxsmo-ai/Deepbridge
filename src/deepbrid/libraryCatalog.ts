import { createHash } from "crypto";
import { request } from "undici";
import { DeepbridClient } from "./apiClient";
import { NormalizedTorrent, normalizeTorrent } from "./torrents";
import { normalizeComparableTitle } from "../core/releaseMatch";
import { parseRelease } from "../core/parseRelease";

export type LibraryCatalogId = "deepbridge-library-movies" | "deepbridge-library-tv" | "deepbridge-library-anime";
type LibraryKind = "movie" | "series";

type StremioMeta = {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  genres?: string[];
  cast?: string[];
  director?: string[];
  runtime?: string;
  imdbRating?: string;
  imdb_id?: string;
  behaviorHints?: Record<string, unknown>;
};

export type LibraryItem = {
  id: string;
  torrentId: string;
  catalogId: LibraryCatalogId;
  type: LibraryKind;
  title: string;
  releaseTitle: string;
  season?: number;
  episode?: number;
  metadata: StremioMeta;
};

type LibraryIndex = {
  expiresAt: number;
  items: LibraryItem[];
};

const libraryIndexCache = new Map<string, LibraryIndex>();
const metadataSearchCache = new Map<string, StremioMeta | null>();
const libraryIndexTtlMs = 5 * 60 * 1000;

function apiCacheKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function titleFromRelease(filename: string): string {
  const parsed = parseRelease(filename);
  return parsed.normalizedTitle || filename;
}

function releaseYear(filename: string): number | undefined {
  const value = parseInt(filename.match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
  return Number.isFinite(value) ? value : undefined;
}

function isAnimeRelease(filename: string, absoluteEpisode?: number): boolean {
  return Boolean(
    absoluteEpisode
    || /\b(?:anime|anidb|crunchyroll|funimation|subsplease|erai-raws|nyaa)\b|\[[^\]]+\]/i.test(filename)
  );
}

function catalogForTorrent(torrent: NormalizedTorrent): { catalogId: LibraryCatalogId; type: LibraryKind; season?: number; episode?: number } {
  const parsed = parseRelease(torrent.filename);
  const hasSeriesShape = parsed.season !== undefined || parsed.episode !== undefined || parsed.absoluteEpisode !== undefined || parsed.seasonPack;
  if (!hasSeriesShape) return { catalogId: "deepbridge-library-movies", type: "movie" };
  if (isAnimeRelease(torrent.filename, parsed.absoluteEpisode)) {
    return {
      catalogId: "deepbridge-library-anime",
      type: "series",
      season: parsed.season || 1,
      episode: parsed.episode || parsed.absoluteEpisode || 1
    };
  }
  return {
    catalogId: "deepbridge-library-tv",
    type: "series",
    season: parsed.season || 1,
    episode: parsed.episode || 1
  };
}

function encodeTorrentId(torrentId: string): string {
  return Buffer.from(torrentId, "utf8").toString("base64url");
}

function decodeTorrentId(value: string): string | undefined {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function itemId(type: LibraryKind, torrentId: string): string {
  return `deepbridge-lib-${type}-${encodeTorrentId(torrentId)}`;
}

export function parseLibraryItemId(id: string): { itemId: string; type: LibraryKind; torrentId: string; season?: number; episode?: number } | undefined {
  const match = id.match(/^(deepbridge-lib-(movie|series)-([A-Za-z0-9_-]+))(?:\:(\d+)\:(\d+))?$/);
  if (!match) return undefined;
  const torrentId = decodeTorrentId(match[3]);
  if (!torrentId) return undefined;
  return {
    itemId: match[1],
    type: match[2] as LibraryKind,
    torrentId,
    season: match[4] ? Number(match[4]) : undefined,
    episode: match[5] ? Number(match[5]) : undefined
  };
}

export function isLibraryItemId(id: string): boolean {
  return Boolean(parseLibraryItemId(id));
}

function displayReleaseTitle(filename: string): string {
  const parsed = parseRelease(filename);
  const details = [parsed.resolution !== "unknown" ? parsed.resolution : "", parsed.quality !== "unknown" ? parsed.quality : "", parsed.codec !== "unknown" ? parsed.codec : ""]
    .filter(Boolean)
    .join(" ");
  return details ? `${filename} [${details}]` : filename;
}

function metadataSearchUrl(type: LibraryKind, title: string): string {
  return `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;
}

function bestMetadataCandidate(metas: StremioMeta[], title: string, year?: number): StremioMeta | undefined {
  const comparable = normalizeComparableTitle(title);
  const exact = metas.find(meta => normalizeComparableTitle(meta.name) === comparable && (!year || String(meta.releaseInfo || "").includes(String(year))));
  if (exact) return exact;
  const yearMatch = metas.find(meta => normalizeComparableTitle(meta.name) === comparable || (year && String(meta.releaseInfo || "").includes(String(year))));
  return yearMatch || metas.find(meta => normalizeComparableTitle(meta.name) === comparable);
}

async function findMetadata(type: LibraryKind, title: string, year?: number): Promise<StremioMeta | undefined> {
  const cacheKey = `${type}|${normalizeComparableTitle(title)}|${year || ""}`;
  if (metadataSearchCache.has(cacheKey)) return metadataSearchCache.get(cacheKey) || undefined;
  try {
    const res = await request(metadataSearchUrl(type, title), { signal: AbortSignal.timeout(6000) });
    if (res.statusCode !== 200) throw new Error(`cinemeta_search_${res.statusCode}`);
    const data = await res.body.json() as { metas?: StremioMeta[] };
    const meta = bestMetadataCandidate(data.metas || [], title, year);
    metadataSearchCache.set(cacheKey, meta || null);
    return meta;
  } catch {
    metadataSearchCache.set(cacheKey, null);
    return undefined;
  }
}

function isReady(torrent: NormalizedTorrent): boolean {
  return torrent.status === "ready" || torrent.status === "ready_missing_links";
}

function normalizeTorrentList(raw: unknown): NormalizedTorrent[] {
  if (Array.isArray(raw)) return raw.map(normalizeTorrent).filter(torrent => torrent.id && torrent.filename);
  if (raw && typeof raw === "object") return Object.values(raw).map(normalizeTorrent).filter(torrent => torrent.id && torrent.filename);
  return [];
}

async function buildLibraryIndex(client: DeepbridClient, apiKey: string, timeoutMs: number): Promise<LibraryIndex> {
  const raw = await client.getTorrentInfo(undefined, timeoutMs);
  const torrents = normalizeTorrentList(raw).filter(isReady);
  const items: LibraryItem[] = [];
  for (const torrent of torrents) {
    const classification = catalogForTorrent(torrent);
    const title = titleFromRelease(torrent.filename);
    const metadata = await findMetadata(classification.type, title, releaseYear(torrent.filename));
    if (!metadata) continue;
    const id = itemId(classification.type, torrent.id);
    items.push({
      id,
      torrentId: torrent.id,
      catalogId: classification.catalogId,
      type: classification.type,
      title,
      releaseTitle: displayReleaseTitle(torrent.filename),
      season: classification.season,
      episode: classification.episode,
      metadata
    });
  }
  return { expiresAt: Date.now() + libraryIndexTtlMs, items };
}

async function getLibraryIndex(client: DeepbridClient, apiKey: string, timeoutMs: number): Promise<LibraryIndex> {
  const key = apiCacheKey(apiKey);
  const cached = libraryIndexCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const index = await buildLibraryIndex(client, apiKey, timeoutMs);
  libraryIndexCache.set(key, index);
  return index;
}

function catalogMeta(item: LibraryItem): Record<string, unknown> {
  return {
    ...item.metadata,
    id: item.id,
    type: item.type,
    name: item.releaseTitle,
    releaseInfo: item.metadata.releaseInfo,
    behaviorHints: {
      ...(item.metadata.behaviorHints || {}),
      defaultVideoId: item.type === "movie" ? item.id : `${item.id}:${item.season || 1}:${item.episode || 1}`
    }
  };
}

export async function getLibraryCatalog(client: DeepbridClient, apiKey: string, catalogId: LibraryCatalogId, options: { skip?: number; search?: string; timeoutMs?: number }): Promise<{ metas: Record<string, unknown>[] }> {
  const index = await getLibraryIndex(client, apiKey, options.timeoutMs || 12000);
  const search = normalizeComparableTitle(options.search || "");
  const filtered = index.items
    .filter(item => item.catalogId === catalogId)
    .filter(item => !search || normalizeComparableTitle(`${item.title} ${item.releaseTitle}`).includes(search))
    .sort((left, right) => left.releaseTitle.localeCompare(right.releaseTitle));
  return { metas: filtered.slice(Math.max(0, options.skip || 0), Math.max(0, options.skip || 0) + 100).map(catalogMeta) };
}

export async function getLibraryMeta(client: DeepbridClient, apiKey: string, id: string, timeoutMs?: number): Promise<{ meta: Record<string, unknown> } | undefined> {
  const parsedId = parseLibraryItemId(id);
  if (!parsedId) return undefined;
  const index = await getLibraryIndex(client, apiKey, timeoutMs || 12000);
  const item = index.items.find(candidate => candidate.id === parsedId.itemId);
  if (!item) return undefined;
  const meta = catalogMeta(item);
  if (item.type === "series") {
    meta.videos = [{
      id: `${item.id}:${item.season || 1}:${item.episode || 1}`,
      title: item.releaseTitle,
      season: item.season || 1,
      episode: item.episode || 1,
      released: new Date().toISOString()
    }];
  }
  return { meta };
}

function directVideoLink(links: string[]): string | undefined {
  return links.find(link => /\.(?:mkv|mp4|m4v|avi|mov|ts|m2ts)(?:$|[/?#&])/i.test(link)) || links[0];
}

export async function getLibraryDirectStream(client: DeepbridClient, id: string, timeoutMs?: number): Promise<{ streams: Array<{ name: string; title: string; url: string }> }> {
  const parsedId = parseLibraryItemId(id);
  if (!parsedId) return { streams: [] };
  const torrent = normalizeTorrent(await client.getTorrentInfo(parsedId.torrentId, timeoutMs || 12000));
  if (!isReady(torrent)) return { streams: [] };
  const directUrl = directVideoLink(torrent.links);
  if (!directUrl) return { streams: [] };
  return {
    streams: [{
      name: "Deepbrid Library",
      title: displayReleaseTitle(torrent.filename),
      url: new URL(directUrl, "https://www.deepbrid.com").toString()
    }]
  };
}

export const __libraryCatalogTest = {
  catalogForTorrent,
  parseLibraryItemId,
  itemId,
  directVideoLink
};
