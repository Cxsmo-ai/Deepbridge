import { DeepbridClient, MediaRequest } from "../deepbrid/apiClient";
import { SourceCandidate } from "../core/types";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { nanoid } from "nanoid";
import { request } from "undici";

const NEWZNAB_ATTRS = "files,usenetdate,group,language,resolution,season,episode,imdb,grabs,password,size";
const MIATRIX_V2_TYPE = "miatrix-v2";

function compact<T>(values: Array<T | undefined | null | false | "">): T[] {
  return values.filter(Boolean) as T[];
}

type IndexerSearchStats = {
  startedAt: string;
  finishedAt: string;
  mediaKey: string;
  configuredIndexers: number;
  totalCandidates: number;
  indexers: Array<{
    name: string;
    host: string;
    type: string;
    plannedSearches: number;
    fulfilledSearches: number;
    failedSearches: number;
    rawItems: number;
    dedupedItems: number;
    selectedItems: number;
    candidates: number;
    skippedArchives: number;
    byResolution: Record<string, number>;
    errors?: Record<string, number>;
    error?: string;
  }>;
};

type IndexerSourceOptions = {
  fallbackMode?: boolean;
};

let lastIndexerSearchStats: IndexerSearchStats = {
  startedAt: "",
  finishedAt: "",
  mediaKey: "",
  configuredIndexers: 0,
  totalCandidates: 0,
  indexers: []
};

export function getLastIndexerSearchStats(): IndexerSearchStats {
  return lastIndexerSearchStats;
}

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "invalid-url";
  }
}

function isEasynewsIndexer(indexer: any): boolean {
  const name = String(indexer?.name || "").toLowerCase();
  const url = String(indexer?.base_url || indexer?.url || "").toLowerCase();
  return name.includes("easynews") || url.includes("easynews");
}

function isMiatrixV2Indexer(indexer: any): boolean {
  const type = String(indexer?.type || "").toLowerCase();
  const url = String(indexer?.base_url || indexer?.url || "").toLowerCase();
  return type === MIATRIX_V2_TYPE || type === "nexus-v2" || type === "api-v2" || url.includes("nexus.miatrix.com/api/v2");
}

async function fetchMediaMetadata(media: MediaRequest): Promise<MediaMetadata> {
  if (media.imdbId.startsWith("tt")) {
    try {
      const metaRes = await request(`https://v3-cinemeta.strem.io/meta/${media.type}/${media.imdbId}.json`, {
        signal: AbortSignal.timeout(2500)
      });
      const metaData = await metaRes.body.json() as any;
      const meta = metaData?.meta;
      const year = parseInt(String(meta?.releaseInfo || meta?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
      const countries = String(meta?.country || "").split(",").map(country => country.trim()).filter(Boolean);
      const aliases = [meta?.name, meta?.imdb_id, meta?.slug];
      if (meta?.name && Number.isFinite(year)) aliases.push(`${meta.name} ${year}`);
      if (meta?.name && countries.some(country => /united states|usa|us/i.test(country))) {
        aliases.push(`${meta.name} US`, `${meta.name} USA`);
      }
      return {
        title: meta?.name,
        aliases: aliases.filter(Boolean),
        year: Number.isFinite(year) ? year : undefined,
        countries
      };
    } catch (e) {
      console.error("Cinemeta fetch failed", e);
    }
  }

  const [prefix, id] = media.imdbId.split(":");
  try {
    if (prefix === "kitsu" && id) {
      const res = await request(`https://kitsu.io/api/edge/anime/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(2500)
      });
      const data = await res.body.json() as any;
      const titles = data?.data?.attributes?.titles || {};
      const startYear = parseInt(String(data?.data?.attributes?.startDate || "").match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
      const aliases = Object.values(titles).filter((value): value is string => typeof value === "string");
      return {
        title: data?.data?.attributes?.canonicalTitle,
        aliases,
        year: Number.isFinite(startYear) ? startYear : undefined,
        countries: ["Japan"],
        isAnime: true
      };
    }

    if ((prefix === "anilist" || prefix === "mal") && id) {
      const query = prefix === "anilist"
        ? `query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english native } synonyms startDate { year } } }`
        : `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { title { romaji english native } synonyms startDate { year } } }`;
      const res = await request("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: prefix === "anilist" ? { id: parseInt(id, 10) } : { idMal: parseInt(id, 10) } }),
        signal: AbortSignal.timeout(2500)
      });
      const data = await res.body.json() as any;
      const mediaData = data?.data?.Media;
      const startYear = Number(mediaData?.startDate?.year);
      const aliases = [mediaData?.title?.romaji, mediaData?.title?.english, mediaData?.title?.native, ...(mediaData?.synonyms || [])].filter(Boolean);
      if (Number.isFinite(startYear)) {
        for (const title of [mediaData?.title?.romaji, mediaData?.title?.english].filter(Boolean)) {
          aliases.push(`${title} ${startYear}`);
        }
      }
      return {
        title: mediaData?.title?.english || mediaData?.title?.romaji,
        aliases,
        year: Number.isFinite(startYear) ? startYear : undefined,
        countries: ["Japan"],
        isAnime: true
      };
    }
  } catch (e) {
    console.error("Anime metadata fetch failed", e);
  }

  return {};
}

function buildQueryTitles(metadata: MediaMetadata): string[] {
  const seen = new Set<string>();
  const titles = [metadata.title, ...(metadata.aliases || [])].filter((title): title is string => Boolean(title));
  const out: string[] = [];
  for (const title of titles) {
    const normalized = normalizeComparableTitle(title);
    const dotted = normalized.replace(/\s+/g, ".");
    const spaced = title.replace(/[._-]+/g, " ");
    for (const value of [title, normalized, dotted, spaced]) {
      const key = normalizeComparableTitle(value);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out.slice(0, 8);
}

function normalizeNewznabApiUrl(rawBaseUrl: string): string {
  const baseUrl = String(rawBaseUrl || "").replace(/\/+$/, "");
  if (/\/api$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/api`;
}

function normalizeIndexerDownloadUrl(rawUrl: string, indexer: any): string {
  let value = String(rawUrl || "").trim();
  if (value.includes("&") && !value.includes("?")) {
    value = value.replace("&", "?");
  }

  try {
    const configuredApiUrl = new URL(normalizeNewznabApiUrl(String(indexer.base_url || "")));
    const url = new URL(value, configuredApiUrl);

    // Some bridges generate links from their internal HTTP origin while sitting
    // behind HTTPS Traefik. Deepbrid must fetch the public configured origin.
    if (url.hostname === configuredApiUrl.hostname || isEasynewsIndexer(indexer)) {
      url.protocol = configuredApiUrl.protocol;
      url.host = configuredApiUrl.host;
    }

    return url.toString();
  } catch {
    return value;
  }
}

function buildNewznabUrl(baseUrl: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  search.set("extended", "1");
  search.set("attrs", NEWZNAB_ATTRS);
  search.set("o", "json");
  return `${normalizeNewznabApiUrl(baseUrl)}?${search.toString()}`;
}

function normalizeMiatrixV2BaseUrl(rawBaseUrl: string): string {
  const trimmed = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/api\/v2$/i.test(trimmed)) return trimmed;
  if (/\/api\/v2\//i.test(trimmed)) return trimmed.replace(/\/api\/v2\/.*$/i, "/api/v2");
  return `${trimmed}/api/v2`;
}

function buildMiatrixV2Url(baseUrl: string, endpoint: string, token: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  search.set("api_token", token);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return `${normalizeMiatrixV2BaseUrl(baseUrl)}/${endpoint.replace(/^\/+/, "")}?${search.toString()}`;
}

function buildMiatrixV2SearchUrls(indexer: any, media: MediaRequest, metadata: MediaMetadata): string[] {
  const urls: string[] = [];
  const imdb = media.imdbId.startsWith("tt") ? media.imdbId : "";
  const imdbNumeric = imdb.replace(/^tt/i, "");
  const titles = buildQueryTitles(metadata).slice(0, 4);
  const baseUrl = String(indexer.base_url || "").replace(/\/+$/, "");
  const token = indexer.encrypted_api_key;
  const category = media.type === "series" ? "5000" : "2000";

  if (media.type === "series") {
    if (imdbNumeric) {
      urls.push(buildMiatrixV2Url(baseUrl, "tv", token, { imdbid: imdbNumeric, season: media.season, ep: media.episode }));
      urls.push(buildMiatrixV2Url(baseUrl, "tv", token, { imdbid: imdbNumeric, season: media.season }));
    }
    for (const title of titles) {
      urls.push(buildMiatrixV2Url(baseUrl, "tv", token, { id: title, season: media.season, ep: media.episode }));
      urls.push(buildMiatrixV2Url(baseUrl, "tv", token, { id: title, season: media.season }));
      urls.push(buildMiatrixV2Url(baseUrl, "search", token, { id: `${title} S${String(media.season || "").padStart(2, "0")}E${String(media.episode || "").padStart(2, "0")}`, cat: category }));
    }
  } else {
    if (imdb) urls.push(buildMiatrixV2Url(baseUrl, "movies", token, { imdbid: imdb }));
    if (imdbNumeric) urls.push(buildMiatrixV2Url(baseUrl, "movies", token, { imdbid: imdbNumeric }));
    for (const title of titles) {
      urls.push(buildMiatrixV2Url(baseUrl, "movies", token, { id: title }));
      urls.push(buildMiatrixV2Url(baseUrl, "search", token, { id: metadata.year ? `${title} ${metadata.year}` : title, cat: category }));
    }
  }

  return [...new Set(urls)].slice(0, 18);
}

function buildSearchUrls(indexer: any, media: MediaRequest, metadata: MediaMetadata): string[] {
  if (isMiatrixV2Indexer(indexer)) {
    return buildMiatrixV2SearchUrls(indexer, media, metadata);
  }

  const urls: string[] = [];
  const easynewsMode = isEasynewsIndexer(indexer);
  const imdb = media.imdbId.startsWith("tt") ? media.imdbId.replace("tt", "") : "";
  const titles = buildQueryTitles(metadata).slice(0, easynewsMode ? 2 : 8);
  const baseUrl = String(indexer.base_url || "").replace(/\/+$/, "");
  const apikey = indexer.encrypted_api_key;
  const limit = easynewsMode ? 50 : 100;
  const offsets = easynewsMode ? [0] : [0, 100];
  const seasonEpisode = media.type === "series" && media.season && media.episode
    ? `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
    : "";
  const seasonOnly = media.type === "series" && media.season
    ? `S${String(media.season).padStart(2, "0")}`
    : "";

  if (easynewsMode) {
    const primaryTitle = titles[0];
    if (!primaryTitle) return [];
    if (media.type === "movie") {
      urls.push(buildNewznabUrl(baseUrl, { t: "movie", apikey, q: primaryTitle, year: metadata.year, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: metadata.year ? `${primaryTitle} ${metadata.year}` : primaryTitle, cat: 2000, limit, offset: 0 }));
    } else {
      if (seasonEpisode) {
        urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, q: primaryTitle, season: media.season, ep: media.episode, limit, offset: 0 }));
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: `${primaryTitle} ${seasonEpisode}`, cat: 5000, limit, offset: 0 }));
      } else if (seasonOnly) {
        urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, q: primaryTitle, season: media.season, limit, offset: 0 }));
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: `${primaryTitle} ${seasonOnly}`, cat: 5000, limit, offset: 0 }));
      } else {
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: primaryTitle, cat: 5000, limit, offset: 0 }));
      }
    }
    return [...new Set(urls)];
  }

  if (media.type === "movie") {
    if (imdb && !easynewsMode) {
      urls.push(buildNewznabUrl(baseUrl, { t: "movie", apikey, imdbid: imdb, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, imdbid: imdb, cat: 2000, limit, offset: 0 }));
    }
    for (const title of titles) {
      for (const offset of offsets) {
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: title, cat: 2000, limit, offset }));
      }
      urls.push(buildNewznabUrl(baseUrl, { t: "movie", apikey, q: title, year: metadata.year, limit, offset: 0 }));
    }
  } else {
    if (imdb && !easynewsMode) {
      urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, imdbid: imdb, season: media.season, ep: media.episode, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, imdbid: imdb, season: media.season, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, imdbid: imdb, cat: 5000, limit, offset: 0 }));
    }
    for (const title of titles) {
      urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, q: title, season: media.season, ep: media.episode, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "tvsearch", apikey, q: title, season: media.season, limit, offset: 0 }));
      if (seasonEpisode) {
        for (const offset of offsets) {
          urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: `${title} ${seasonEpisode}`, cat: 5000, limit, offset }));
        }
      }
      if (seasonOnly) {
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: `${title} ${seasonOnly}`, cat: 5000, limit, offset: 0 }));
      }
    }
  }

  return [...new Set(urls)].slice(0, easynewsMode ? 6 : 32);
}

function asArray(items: any): any[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function isArchiveRelease(title: string): boolean {
  return /(?:^|[.\s_-])(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[.\s_-])/i.test(title);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function tagValue(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1]).trim() : undefined;
}

function parseXmlItems(xml: string): any[] {
  const items: any[] = [];
  for (const match of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const enclosureMatch = block.match(/<enclosure\b([^>]*)>/i);
    const enclosureAttrs: Record<string, string> = {};
    if (enclosureMatch?.[1]) {
      for (const attr of enclosureMatch[1].matchAll(/([:\w-]+)="([^"]*)"/g)) {
        enclosureAttrs[attr[1]] = decodeXml(attr[2]);
      }
    }
    const attrs = [...block.matchAll(/<(?:newznab:)?attr\b([^>]*)\/?>/gi)].map(attrMatch => {
      const payload: Record<string, string> = {};
      for (const attr of attrMatch[1].matchAll(/([:\w-]+)="([^"]*)"/g)) {
        payload[attr[1]] = decodeXml(attr[2]);
      }
      return payload;
    });
    items.push({
      title: tagValue(block, "title"),
      link: tagValue(block, "link"),
      guid: tagValue(block, "guid"),
      pubDate: tagValue(block, "pubDate"),
      enclosure: Object.keys(enclosureAttrs).length > 0 ? { "@attributes": enclosureAttrs } : undefined,
      "newznab:attr": attrs
    });
  }
  return items;
}

async function fetchNewznabItems(searchUrl: string, timeoutMs = 5000): Promise<any[]> {
  const res = await request(searchUrl, {
    headers: { "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await res.body.text();
  try {
    const data = JSON.parse(body) as any;
    return asArray(data.channel?.item || data.rss?.channel?.item || data.item);
  } catch {
    return parseXmlItems(body);
  }
}

function asMiatrixV2Items(data: any): any[] {
  return asArray(
    data?.results
    || data?.data
    || data?.nzbs
    || data?.items
    || data?.releases
    || data?.list
    || data
  );
}

function normalizeMiatrixV2Item(item: any, indexer: any): any {
  const id = resolveFirst(item.id, item.ID, item.nzb_id, item.nzbId, item.guid, item.hash, item.releaseHash, item.nzbHash);
  const title = resolveFirst(item.title, item.name, item.release_name, item.releaseName, item.subject);
  const downloadUrl = resolveFirst(item.downloadUrl, item.download_url, item.getnzb, item.nzbUrl, item.nzb_url, item.link, item.url);
  return {
    ...item,
    title,
    size: resolveFirst(item.size, item.sizeBytes, item.size_bytes, item.filesize, item.bytes),
    downloadUrl: downloadUrl || (id ? buildMiatrixV2Url(String(indexer.base_url || ""), "getnzb", indexer.encrypted_api_key, { id }) : undefined),
    guid: id,
    attr: [
      { name: "size", value: resolveFirst(item.size, item.sizeBytes, item.size_bytes, item.filesize, item.bytes) },
      { name: "grabs", value: resolveFirst(item.grabs, item.downloads) }
    ].filter(attr => attr.value !== undefined && attr.value !== null)
  };
}

async function fetchMiatrixV2Items(searchUrl: string, indexer: any, timeoutMs = 8000): Promise<any[]> {
  const res = await request(searchUrl, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await res.body.json() as any;
  return asMiatrixV2Items(data)
    .map(item => normalizeMiatrixV2Item(item, indexer))
    .filter(item => item.title && item.downloadUrl);
}

function newznabErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/timeout|aborted|AbortError|UND_ERR_ABORTED/i.test(message)) return "timeout";
  if (/statusCode|HTTP|401|403/i.test(message)) return "http";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(message)) return "network";
  return "other";
}

function resolveFirst(...values: any[]): any {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const nested = resolveFirst(...value);
      if (nested !== undefined && nested !== null) return nested;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    return value;
  }
  return undefined;
}

function attrMap(item: any): Record<string, any> {
  const map: Record<string, any> = {};
  const sources = compact([
    item.attr,
    item.attrs,
    item.attribute,
    item.attributes,
    item["newznab:attr"],
    item["newznab:attrs"]
  ]);
  for (const source of sources.flatMap(source => Array.isArray(source) ? source : [source])) {
    const payload = source?.["@attributes"] || source?.$ || source;
    const name = String(payload?.name || payload?.Name || payload?.key || payload?.field || "").trim().toLowerCase();
    const value = payload?.value ?? payload?.Value ?? payload?.content ?? payload?.text;
    if (name && value !== undefined && value !== null) {
      map[name] = value;
    }
  }
  return map;
}

function parseGuid(rawGuid: any): string | undefined {
  if (!rawGuid) return undefined;
  if (typeof rawGuid === "string") return rawGuid;
  return rawGuid._ || rawGuid["#text"] || rawGuid.url || rawGuid.href;
}

function enclosureAttrs(item: any): Record<string, any> {
  const enclosure = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
  return enclosure?.["@attributes"] || enclosure?.$ || enclosure || {};
}

function getNzbUrl(item: any, attrs: Record<string, any>): string | undefined {
  const enclosure = enclosureAttrs(item);
  const guid = parseGuid(item.guid);
  return resolveFirst(
    enclosure.url,
    enclosure.href,
    item.link,
    item.url,
    item.downloadUrl,
    item.download_url,
    attrs.downloadurl,
    attrs.url,
    guid
  );
}

function getItemSize(item: any, attrs: Record<string, any>, parsedSizeBytes?: number): number {
  const enclosure = enclosureAttrs(item);
  const value = resolveFirst(
    enclosure.length,
    attrs.size,
    attrs.filesize,
    attrs.contentlength,
    attrs["content-length"],
    attrs.length,
    attrs.nzbsize,
    item.size,
    item.Size,
    parsedSizeBytes
  );
  const size = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(size) ? size : 0;
}

export async function getIndexerSources(
  deepbridClient: DeepbridClient,
  media: MediaRequest,
  userConfig?: any,
  options: IndexerSourceOptions = {}
): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  let indexers: any[] = [];
  
  if (userConfig) {
    if (userConfig.indexers && Array.isArray(userConfig.indexers)) {
      indexers = userConfig.indexers.map((idx: any, i: number) => ({
        name: idx.name || `Custom Indexer ${i + 1}`,
        base_url: idx.url,
        encrypted_api_key: idx.key,
        limits: idx.limits,
        type: idx.type || "althub",
        fallbackOnly: idx.fallbackOnly === true,
        fallbackMaxResults: idx.fallbackMaxResults
      }));
    }
    
    // Legacy support
    if (userConfig.indexerUrl && userConfig.indexerApiKey && indexers.length === 0) {
      indexers = [{
        name: "Custom Indexer",
        base_url: userConfig.indexerUrl,
        encrypted_api_key: userConfig.indexerApiKey,
        type: "althub"
      }];
    }
  }

  indexers = indexers.filter(indexer => options.fallbackMode ? indexer.fallbackOnly === true : indexer.fallbackOnly !== true);

  const stats: IndexerSearchStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    mediaKey: makeMediaKey(media),
    configuredIndexers: indexers.length,
    totalCandidates: 0,
    indexers: []
  };
  
  if (indexers.length === 0) {
    stats.finishedAt = new Date().toISOString();
    lastIndexerSearchStats = stats;
    return [];
  }

  const candidates: SourceCandidate[] = [];
  const metadata = await fetchMediaMetadata(media);

  const indexerPromises = indexers.map(async (indexer) => {
    const indexerStats = {
      name: String(indexer.name || "Unnamed Indexer"),
      host: safeHost(String(indexer.base_url || "")),
      type: String(indexer.type || "newznab"),
      plannedSearches: 0,
      fulfilledSearches: 0,
      failedSearches: 0,
      rawItems: 0,
      dedupedItems: 0,
      selectedItems: 0,
      candidates: 0,
      skippedArchives: 0,
      byResolution: {
        "2160p": 0,
        "1080p": 0,
        "720p": 0,
        "SD": 0
      } as Record<string, number>,
      errors: {} as Record<string, number>,
      error: undefined as string | undefined
    };
    stats.indexers.push(indexerStats);

    try {
      const rawItems: any[] = [];
      const seenItems = new Set<string>();
      const searchUrls = buildSearchUrls(indexer, media, metadata);
      const easynewsMode = isEasynewsIndexer(indexer);
      const miatrixV2Mode = isMiatrixV2Indexer(indexer);
      const userIndexerTimeout = userConfig?.indexerTimeout;
      const searchTimeoutMs = easynewsMode ? parseInt(process.env.DEEPBRID_INDEXER_TIMEOUT_EASYNEWS || "45000") : (userIndexerTimeout && Number.isFinite(userIndexerTimeout) && userIndexerTimeout > 0 ? userIndexerTimeout : parseInt(process.env.DEEPBRID_INDEXER_TIMEOUT || "12000"));
      indexerStats.plannedSearches = searchUrls.length;
      const searchResults: PromiseSettledResult<any[]>[] = [];
      if (easynewsMode) {
        for (const searchUrl of searchUrls) {
          try {
            searchResults.push({ status: "fulfilled", value: await fetchNewznabItems(searchUrl, searchTimeoutMs) });
          } catch (error) {
            searchResults.push({ status: "rejected", reason: error });
          }
        }
      } else {
        searchResults.push(...await Promise.allSettled(searchUrls.map(async (searchUrl) => {
          return miatrixV2Mode
            ? fetchMiatrixV2Items(searchUrl, indexer, searchTimeoutMs)
            : fetchNewznabItems(searchUrl, searchTimeoutMs);
        })));
      }

      for (const result of searchResults) {
        if (result.status !== "fulfilled") {
          indexerStats.failedSearches++;
          const category = newznabErrorCategory(result.reason);
          indexerStats.errors[category] = (indexerStats.errors[category] || 0) + 1;
          continue;
        }
        indexerStats.fulfilledSearches++;
        indexerStats.rawItems += result.value.length;
        for (const item of result.value) {
          const attrs = attrMap(item);
          const nzbUrl = getNzbUrl(item, attrs);
          const key = `${item.title || ""}|${nzbUrl || parseGuid(item.guid) || ""}`;
          if (!seenItems.has(key)) {
            seenItems.add(key);
            rawItems.push(item);
          }
        }
      }
      indexerStats.dedupedItems = rawItems.length;
      
      // Group items by resolution to ensure we get a mix of 4K, 1080p, 720p, etc.
      const resolutionGroups: { [key: string]: any[] } = {
        "2160p": [],
        "1080p": [],
        "720p": [],
        "SD": []
      };

      for (const item of rawItems) {
        const title = item.title || "";
        if (isArchiveRelease(title)) {
          indexerStats.skippedArchives++;
          continue;
        }
        const lowerTitle = title.toLowerCase();
        
        if (lowerTitle.includes("2160p") || lowerTitle.includes("4k")) {
          resolutionGroups["2160p"].push(item);
          indexerStats.byResolution["2160p"]++;
        } else if (lowerTitle.includes("1080p")) {
          resolutionGroups["1080p"].push(item);
          indexerStats.byResolution["1080p"]++;
        } else if (lowerTitle.includes("720p")) {
          resolutionGroups["720p"].push(item);
          indexerStats.byResolution["720p"]++;
        } else {
          resolutionGroups["SD"].push(item);
          indexerStats.byResolution["SD"]++;
        }
      }

      // Pick top results based on user limits for THIS specific indexer.
      // Defaults are intentionally higher now so health/streams can show more working sources.
      let topItems: any[] = [];
      for (const res of ["2160p", "1080p", "720p", "SD"]) {
        const group = resolutionGroups[res];
        let limit: number | "all" = 30;
        
        if (indexer.limits && indexer.limits[res as keyof typeof indexer.limits] !== undefined) {
          limit = indexer.limits[res as keyof typeof indexer.limits];
        }

        if (limit === "all") {
          topItems = topItems.concat(group);
        } else {
          topItems = topItems.concat(group.slice(0, Number(limit)));
        }
      }
      if (options.fallbackMode) {
        const fallbackCap = Math.max(1, Math.min(Number(indexer.fallbackMaxResults || userConfig?.fallbackIndexerMaxResults || 4) || 4, 12));
        topItems = topItems.slice(0, fallbackCap);
      }
      indexerStats.selectedItems = topItems.length;

      for (const item of topItems) {
        const attrs = attrMap(item);
        let nzbUrl = getNzbUrl(item, attrs);
        if (!nzbUrl) continue;
        nzbUrl = normalizeIndexerDownloadUrl(nzbUrl, indexer);

        const title = resolveFirst(item.title, attrs.title, parseGuid(item.guid), "Deepbrid NZB");
        if (isArchiveRelease(title)) continue;
        const parsed = parseRelease(title);
        const match = scoreReleaseMatch(title, media, parsed, metadata);
        const sizeBytes = getItemSize(item, attrs, parsed.sizeBytes);

        const candidate: SourceCandidate = {
          id: nanoid(),
          mediaType: media.type,
          imdbId: media.imdbId,
          season: media.season,
          episode: media.episode,
          mediaKey: makeMediaKey(media),
          origin: (indexer.type || "althub") as any,
          title: title,
          displayName: `[${indexer.name}] ${parsed.resolution || "Unknown"}`,
          status: "needs_deepbrid_submit",
          nzbUrl: nzbUrl,
          resolution: parsed.resolution as any,
          quality: parsed.quality as any,
          codec: parsed.codec as any,
          hdr: parsed.hdr as any,
          audio: parsed.audio,
          releaseGroup: parsed.releaseGroup,
          normalizedTitle: parsed.normalizedTitle,
          parsedSeason: parsed.season,
          parsedEpisode: parsed.episode,
          absoluteEpisode: parsed.absoluteEpisode,
          seasonPack: parsed.seasonPack,
          sizeBytes: sizeBytes,
          language: attrs.language ? String(attrs.language) : undefined,
          matchScore: match.score,
          matchReason: match.reason,
          score: 1000 + match.score + (sizeBytes / (1024 * 1024 * 1024)),
          createdAt: new Date().toISOString()
        };
        candidates.push(candidate);
        indexerStats.candidates++;
      }

    } catch (err) {
      indexerStats.error = err instanceof Error ? err.message : "indexer_search_failed";
      console.error(`Error querying indexer ${indexer.name}:`, err);
    }
  });

  // Give broad Newznab fan-out enough time to return useful candidates.
  const fanoutTimeout = userConfig?.indexerTimeout && Number.isFinite(userConfig.indexerTimeout) && userConfig.indexerTimeout > 0 ? userConfig.indexerTimeout : parseInt(process.env.DEEPBRID_INDEXER_TIMEOUT || "12000");
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, fanoutTimeout));
  await Promise.race([Promise.allSettled(indexerPromises), timeoutPromise]);

  stats.finishedAt = new Date().toISOString();
  stats.totalCandidates = candidates.length;
  lastIndexerSearchStats = stats;
  return candidates.sort((a, b) => b.score - a.score);
}
