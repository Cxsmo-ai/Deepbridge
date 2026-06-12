import { nanoid } from "nanoid";
import { DeepbridClient, MediaRequest } from "./apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { SourceCandidate } from "../core/types";
import { request } from "undici";

export type NormalizedTorrent = {
  id: string;
  filename: string;
  progress: number;
  seeders: number;
  speed: string;
  links: string[];
  imageStatusHtml?: string;
  status: "ready" | "ready_missing_links" | "processing" | "queued_or_initializing" | "dead" | "failed" | "unknown";
  error: number;
  message?: string;
};

type TorrentStats = {
  startedAt: string;
  finishedAt: string;
  configured: boolean;
  fetched: number;
  matched: number;
  ready: number;
  externalConfigured: number;
  errors: Record<string, number>;
};

let lastTorrentStats: TorrentStats = {
  startedAt: "",
  finishedAt: "",
  configured: false,
  fetched: 0,
  matched: 0,
  ready: 0,
  externalConfigured: 0,
  errors: {}
};

export function getLastTorrentStats(): TorrentStats {
  return lastTorrentStats;
}

function statusFrom(raw: any): NormalizedTorrent["status"] {
  const error = Number(raw?.error || 0);
  const progress = Number(raw?.progress || 0);
  const links = Array.isArray(raw?.links) ? raw.links : [];
  const img = String(raw?.["img-progress"] || raw?.imgProgress || "");
  if (error !== 0) return "failed";
  if (/dead\.png|dead links/i.test(img)) return "dead";
  if (progress === 100 && links.length > 0) return "ready";
  if (progress === 100) return "ready_missing_links";
  if (progress > 0 && progress < 100) return "processing";
  if (progress === 0) return "queued_or_initializing";
  return "unknown";
}

export function normalizeTorrent(raw: any): NormalizedTorrent {
  const links = Array.isArray(raw?.links) ? raw.links.map(String).filter(Boolean) : [];
  return {
    id: String(raw?.id || ""),
    filename: String(raw?.filename || raw?.name || ""),
    progress: Number(raw?.progress || 0),
    seeders: Number(raw?.seeders || 0),
    speed: String(raw?.speed || ""),
    links,
    imageStatusHtml: raw?.["img-progress"] ? String(raw["img-progress"]) : undefined,
    status: statusFrom(raw),
    error: Number(raw?.error || 0),
    message: raw?.message ? String(raw.message) : undefined
  };
}

function normalizeTorrentList(raw: any): NormalizedTorrent[] {
  if (Array.isArray(raw)) return raw.map(normalizeTorrent).filter(item => item.id);
  if (raw && typeof raw === "object") return Object.values(raw).map(normalizeTorrent).filter(item => item.id);
  return [];
}

async function fetchMediaMetadata(media: MediaRequest): Promise<MediaMetadata> {
  if (!media.imdbId.startsWith("tt")) return {};
  try {
    const res = await request(`https://v3-cinemeta.strem.io/meta/${media.type}/${media.imdbId}.json`, {
      signal: AbortSignal.timeout(2500)
    });
    const data = await res.body.json() as any;
    const meta = data?.meta;
    const year = parseInt(String(meta?.releaseInfo || meta?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
    return {
      title: meta?.name,
      aliases: [meta?.name, meta?.imdb_id, meta?.slug].filter(Boolean),
      year: Number.isFinite(year) ? year : undefined
    };
  } catch {
    return {};
  }
}

function encodeTorrentPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function normalizePlayableUrl(url: string): string {
  return new URL(url, "https://www.deepbrid.com").toString();
}

function selectTorrentLink(links: string[]): string | undefined {
  return links.find(link => /\.(?:mkv|mp4|m4v|avi|mov|ts|m2ts)(?:$|[/?#&])/i.test(link)) || links[0];
}

function externalTorrents(userConfig: any): any[] {
  if (Array.isArray(userConfig?.externalTorrents)) return userConfig.externalTorrents;
  const text = String(userConfig?.externalTorrentMagnets || "").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(magnet => ({ magnet }));
}

function isRelevantExternal(item: any, media: MediaRequest): boolean {
  if (item.imdbId && String(item.imdbId) !== media.imdbId) return false;
  if (media.type === "series") {
    if (item.season && Number(item.season) !== media.season) return false;
    if (item.episode && Number(item.episode) !== media.episode) return false;
  }
  return true;
}

export async function getTorrentSources(client: DeepbridClient, media: MediaRequest, userConfig: any, baseUrl: string, token: string): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const stats: TorrentStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: Boolean(userConfig?.deepbridLibraryEnabled !== false),
    fetched: 0,
    matched: 0,
    ready: 0,
    externalConfigured: externalTorrents(userConfig).length,
    errors: {}
  };

  const metadata = await fetchMediaMetadata(media);
  const candidates: SourceCandidate[] = [];
  const directLinksOnly = userConfig?.directLinksOnly !== false;

  if (userConfig?.deepbridLibraryEnabled !== false) {
    try {
      const raw = await client.getTorrentInfo(undefined, Number(userConfig?.torrentLibraryTimeout || 8000) || 8000);
      const torrents = normalizeTorrentList(raw);
      stats.fetched = torrents.length;
      for (const torrent of torrents) {
        const parsed = parseRelease(torrent.filename);
        const match = scoreReleaseMatch(torrent.filename, media, parsed, metadata);
        if (match.score < (media.type === "series" ? 650 : 600)) continue;
        stats.matched++;
        if (torrent.status !== "ready" && torrent.status !== "ready_missing_links") continue;
        let playableUrl = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}/torrent/play/${encodeTorrentPayload({ id: torrent.id, title: torrent.filename, season: media.season, episode: media.episode })}`;
        if (directLinksOnly) {
          const refreshed = normalizeTorrent(await client.getTorrentInfo(torrent.id, Number(userConfig?.torrentInfoTimeout || 12000) || 12000));
          const link = selectTorrentLink(refreshed.links);
          if (!link) continue;
          playableUrl = normalizePlayableUrl(link);
        }
        candidates.push({
          id: nanoid(),
          mediaType: media.type,
          imdbId: media.imdbId,
          season: media.season,
          episode: media.episode,
          mediaKey: makeMediaKey(media),
          origin: "deepbrid-torrent-library",
          title: torrent.filename,
          displayName: "[Deepbrid Library]",
          status: "ready",
          playableUrl,
          resolution: parsed.resolution,
          quality: parsed.quality,
          codec: parsed.codec,
          hdr: parsed.hdr,
          audio: parsed.audio,
          releaseGroup: parsed.releaseGroup,
          normalizedTitle: parsed.normalizedTitle,
          parsedSeason: parsed.season,
          parsedEpisode: parsed.episode,
          seasonPack: parsed.seasonPack,
          matchScore: match.score,
          matchReason: match.reason,
          score: 4200 + match.score,
          createdAt: new Date().toISOString()
        });
        stats.ready++;
      }
    } catch {
      stats.errors.library = (stats.errors.library || 0) + 1;
    }
  }

  if (directLinksOnly) {
    stats.finishedAt = new Date().toISOString();
    lastTorrentStats = stats;
    return candidates;
  }

  for (const item of externalTorrents(userConfig).filter(item => isRelevantExternal(item, media))) {
    const title = String(item.title || item.name || item.magnet || "External torrent");
    const parsed = parseRelease(title);
    candidates.push({
      id: nanoid(),
      mediaType: media.type,
      imdbId: media.imdbId,
      season: media.season,
      episode: media.episode,
      mediaKey: makeMediaKey(media),
      origin: "external-torrent",
      title,
      displayName: "[External Torrent]",
      status: "ready",
      playableUrl: `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}/torrent/add/${encodeTorrentPayload({ magnet: item.magnet, title, season: media.season, episode: media.episode })}`,
      resolution: parsed.resolution,
      quality: parsed.quality,
      codec: parsed.codec,
      hdr: parsed.hdr,
      audio: parsed.audio,
      releaseGroup: parsed.releaseGroup,
      normalizedTitle: parsed.normalizedTitle,
      parsedSeason: parsed.season,
      parsedEpisode: parsed.episode,
      seasonPack: parsed.seasonPack,
      score: 3600,
      createdAt: new Date().toISOString()
    });
  }

  stats.finishedAt = new Date().toISOString();
  lastTorrentStats = stats;
  return candidates;
}
