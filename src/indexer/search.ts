import { DeepbridClient, MediaRequest } from "../deepbrid/apiClient";
import { SourceCandidate } from "../core/types";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { nanoid } from "nanoid";
import { request } from "undici";

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
    for (const value of [title, normalized]) {
      const key = normalizeComparableTitle(value);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out.slice(0, 4);
}

function buildSearchUrls(indexer: any, media: MediaRequest, metadata: MediaMetadata): string[] {
  const urls: string[] = [];
  const imdb = media.imdbId.startsWith("tt") ? media.imdbId.replace("tt", "") : "";
  const titles = buildQueryTitles(metadata);

  if (media.type === "movie") {
    if (imdb) urls.push(`${indexer.base_url}/api?t=movie&apikey=${indexer.encrypted_api_key}&imdbid=${imdb}&limit=100&o=json`);
    for (const title of titles) {
      urls.push(`${indexer.base_url}/api?t=movie&apikey=${indexer.encrypted_api_key}&q=${encodeURIComponent(title)}&limit=100&o=json`);
    }
  } else {
    for (const title of titles) {
      urls.push(`${indexer.base_url}/api?t=tvsearch&apikey=${indexer.encrypted_api_key}&q=${encodeURIComponent(title)}&season=${media.season}&ep=${media.episode}&o=json`);
      urls.push(`${indexer.base_url}/api?t=tvsearch&apikey=${indexer.encrypted_api_key}&q=${encodeURIComponent(title)}&season=${media.season}&o=json`);
    }
    if (imdb) {
      urls.push(`${indexer.base_url}/api?t=tvsearch&apikey=${indexer.encrypted_api_key}&imdbid=${imdb}&season=${media.season}&ep=${media.episode}&o=json`);
      urls.push(`${indexer.base_url}/api?t=tvsearch&apikey=${indexer.encrypted_api_key}&imdbid=${imdb}&season=${media.season}&o=json`);
    }
  }

  return [...new Set(urls)].slice(0, 8);
}

function asArray(items: any): any[] {
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function isArchiveRelease(title: string): boolean {
  return /(?:^|[.\s_-])(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[.\s_-])/i.test(title);
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
        const res = await request(searchUrl, { signal: AbortSignal.timeout(2500) });
        const data = await res.body.json() as any;
        return asArray(data.channel && data.channel.item ? data.channel.item : data.item);
      }));

      for (const result of searchResults) {
        if (result.status !== "fulfilled") continue;
        for (const item of result.value) {
          const key = `${item.title || ""}|${item.link || item.guid || ""}`;
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
        let nzbUrl = item.link || (item.enclosure && item.enclosure["@attributes"] && item.enclosure["@attributes"].url);
        if (!nzbUrl) continue;
        
        if (nzbUrl.includes("&") && !nzbUrl.includes("?")) {
          nzbUrl = nzbUrl.replace("&", "?");
        }

        const title = item.title || "Deepbrid NZB";
        if (isArchiveRelease(title)) continue;
        const parsed = parseRelease(title);
        const match = scoreReleaseMatch(title, media, parsed, metadata);
        
        let sizeBytes = 0;
        if (item.enclosure && item.enclosure["@attributes"] && item.enclosure["@attributes"].length) {
            sizeBytes = parseInt(item.enclosure["@attributes"].length);
        } else if (item.size) {
            sizeBytes = parseInt(item.size);
        }
        if (!sizeBytes && parsed.sizeBytes) sizeBytes = parsed.sizeBytes;

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

  return candidates;
}
