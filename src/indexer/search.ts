import { DeepbridClient, MediaRequest } from "../deepbrid/apiClient";
import { SourceCandidate } from "../core/types";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { nanoid } from "nanoid";
import { request } from "undici";

const NEWZNAB_ATTRS = "files,usenetdate,group,language,resolution,season,episode,imdb,grabs,password,size";

function compact<T>(values: Array<T | undefined | null | false | "">): T[] {
  return values.filter(Boolean) as T[];
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

function buildNewznabUrl(baseUrl: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  search.set("extended", "1");
  search.set("attrs", NEWZNAB_ATTRS);
  search.set("o", "json");
  return `${baseUrl}/api?${search.toString()}`;
}

function buildSearchUrls(indexer: any, media: MediaRequest, metadata: MediaMetadata): string[] {
  const urls: string[] = [];
  const imdb = media.imdbId.startsWith("tt") ? media.imdbId.replace("tt", "") : "";
  const titles = buildQueryTitles(metadata);
  const baseUrl = String(indexer.base_url || "").replace(/\/+$/, "");
  const apikey = indexer.encrypted_api_key;
  const limit = 100;
  const offsets = [0, 100];
  const seasonEpisode = media.type === "series" && media.season && media.episode
    ? `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
    : "";
  const seasonOnly = media.type === "series" && media.season
    ? `S${String(media.season).padStart(2, "0")}`
    : "";

  if (media.type === "movie") {
    if (imdb) {
      urls.push(buildNewznabUrl(baseUrl, { t: "movie", apikey, imdbid: imdb, limit, offset: 0 }));
      urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, imdbid: imdb, cat: 2000, limit, offset: 0 }));
    }
    for (const title of titles) {
      for (const offset of offsets) {
        urls.push(buildNewznabUrl(baseUrl, { t: "search", apikey, q: title, cat: 2000, limit, offset }));
      }
      urls.push(buildNewznabUrl(baseUrl, { t: "movie", apikey, q: title, limit, offset: 0 }));
    }
  } else {
    if (imdb) {
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

  return [...new Set(urls)].slice(0, 32);
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

async function fetchNewznabItems(searchUrl: string): Promise<any[]> {
  const res = await request(searchUrl, {
    headers: { "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(5000)
  });
  const body = await res.body.text();
  try {
    const data = JSON.parse(body) as any;
    return asArray(data.channel?.item || data.rss?.channel?.item || data.item);
  } catch {
    return parseXmlItems(body);
  }
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
  userConfig?: any
): Promise<SourceCandidate[]> {
  let indexers: any[] = [];
  
  if (userConfig) {
    if (userConfig.indexers && Array.isArray(userConfig.indexers)) {
      indexers = userConfig.indexers.map((idx: any, i: number) => ({
        name: idx.name || `Custom Indexer ${i + 1}`,
        base_url: idx.url,
        encrypted_api_key: idx.key,
        limits: idx.limits,
        type: "althub"
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
  
  if (indexers.length === 0) return [];

  const candidates: SourceCandidate[] = [];
  const metadata = await fetchMediaMetadata(media);

  const indexerPromises = indexers.map(async (indexer) => {
    try {
      const rawItems: any[] = [];
      const seenItems = new Set<string>();
      const searchResults = await Promise.allSettled(buildSearchUrls(indexer, media, metadata).map(async (searchUrl) => {
        return fetchNewznabItems(searchUrl);
      }));

      for (const result of searchResults) {
        if (result.status !== "fulfilled") continue;
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
      
      // Group items by resolution to ensure we get a mix of 4K, 1080p, 720p, etc.
      const resolutionGroups: { [key: string]: any[] } = {
        "2160p": [],
        "1080p": [],
        "720p": [],
        "SD": []
      };

      for (const item of rawItems) {
        const title = item.title || "";
        if (isArchiveRelease(title)) continue;
        const lowerTitle = title.toLowerCase();
        
        // Skip obvious foreign dubs if you want, but for now just group by res
        if (lowerTitle.includes("2160p") || lowerTitle.includes("4k")) {
          resolutionGroups["2160p"].push(item);
        } else if (lowerTitle.includes("1080p")) {
          resolutionGroups["1080p"].push(item);
        } else if (lowerTitle.includes("720p")) {
          resolutionGroups["720p"].push(item);
        } else {
          resolutionGroups["SD"].push(item);
        }
      }

      // Pick top results based on user limits for THIS specific indexer
      let topItems: any[] = [];
      for (const res of ["2160p", "1080p", "720p", "SD"]) {
        const group = resolutionGroups[res];
        let limit: number | "all" = 15; // default 15
        
        if (indexer.limits && indexer.limits[res as keyof typeof indexer.limits] !== undefined) {
            limit = indexer.limits[res as keyof typeof indexer.limits];
        }

        if (limit === "all") {
            topItems = topItems.concat(group);
        } else {
            topItems = topItems.concat(group.slice(0, Number(limit)));
        }
      }

      for (const item of topItems) {
        const attrs = attrMap(item);
        let nzbUrl = getNzbUrl(item, attrs);
        if (!nzbUrl) continue;
        
        if (nzbUrl.includes("&") && !nzbUrl.includes("?")) {
          nzbUrl = nzbUrl.replace("&", "?");
        }

        const title = resolveFirst(item.title, attrs.title, parseGuid(item.guid), "Deepbrid NZB");
        if (isArchiveRelease(title)) continue;
        const parsed = parseRelease(title);
        const match = scoreReleaseMatch(title, media, parsed, metadata);
        const sizeBytes = getItemSize(item, attrs, parsed.sizeBytes);

        candidates.push({
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
        });
      }

    } catch (err) {
      console.error(`Error querying indexer ${indexer.name}:`, err);
    }
  });

  // Global 5-second timeout across ALL indexers concurrently
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
  await Promise.race([Promise.allSettled(indexerPromises), timeoutPromise]);

  return candidates.sort((a, b) => b.score - a.score);
}
