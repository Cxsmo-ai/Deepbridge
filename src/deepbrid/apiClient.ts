import { request } from "undici";

export interface MediaRequest {
  type: "movie" | "series";
  imdbId: string;
  season?: number;
  episode?: number;
}

export class DeepbridClient {
  private apiKey: string;
  private baseUrl = "https://www.deepbrid.com/api/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get headers() {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
  }

  async getOfficialStremioStreams(media: MediaRequest) {
    const baseUrl = "https://www.deepbrid.com/stremio"; 
    const path = media.type === "movie"
      ? `/stream/movie/${media.imdbId}.json`
      : `/stream/series/${media.imdbId}:${media.season}:${media.episode}.json`;

    // The official Deepbrid Stremio endpoint requires ~qall.s0.rar1 config string
    const res = await request(`${baseUrl}/${this.apiKey}~qall.s0.rar1${path}`, {
      signal: AbortSignal.timeout(4500)
    });
    if (res.statusCode !== 200) {
      throw new Error(`Failed to fetch official streams: ${res.statusCode}`);
    }

    const data = await res.body.json() as { streams: any[] };
    return data.streams || [];
  }

  async getUser() {
    const res = await request(`${this.baseUrl}/user`, { headers: this.headers });
    return await res.body.json();
  }

  async getApiKeyInfo(timeoutMs?: number) {
    const res = await request(`${this.baseUrl}/apikey/info`, {
      headers: this.headers,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
    return await res.body.json();
  }

  async getHosts() {
    const res = await request(`${this.baseUrl}/hosts`, { headers: this.headers });
    return await res.body.json();
  }

  async generateLink(link: string) {
    const res = await request(`${this.baseUrl}/generate/link`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ link })
    });
    return await res.body.json();
  }

  async addUsenetByUrl(nzbUrl: string, timeoutMs = 25000) {
    const res = await request(`${this.baseUrl}/usenet/add`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams({ nzb_url: nzbUrl }).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return await res.body.json();
  }

  async getDownloads(timeoutMs?: number) {
    const res = await request(`${this.baseUrl}/downloads`, {
      headers: this.headers,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
    return await res.body.json();
  }
}
