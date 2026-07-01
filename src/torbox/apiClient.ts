import { request } from "undici";

const TORBOX_BASE_URL = "https://api.torbox.app/v1/api";

export type TorBoxUsenetFile = {
  id?: number | string;
  name?: string;
  short_name?: string;
  size?: number;
  mimetype?: string;
};

export type TorBoxUsenetItem = {
  id?: number | string;
  usenet_id?: number | string;
  name?: string;
  hash?: string;
  download_state?: string;
  progress?: number;
  cached?: boolean;
  download_present?: boolean;
  download_finished?: boolean;
  files?: TorBoxUsenetFile[];
};

export class TorBoxClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get headers() {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Accept": "application/json"
    };
  }

  async getUser(timeoutMs = 8000) {
    const res = await request(`${TORBOX_BASE_URL}/user/me`, {
      headers: this.headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return await res.body.json();
  }

  async getUsenetList(id?: string | number, timeoutMs = 12000) {
    const url = id
      ? `${TORBOX_BASE_URL}/usenet/mylist?id=${encodeURIComponent(String(id))}`
      : `${TORBOX_BASE_URL}/usenet/mylist`;
    const res = await request(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return await res.body.json();
  }

  async createUsenetDownloadFromLink(options: {
    link: string;
    name?: string;
    cacheOnly?: boolean;
    timeoutMs?: number;
  }) {
    const form = new FormData();
    form.set("link", options.link);
    if (options.name) form.set("name", options.name.slice(0, 180));
    form.set("post_processing", "-1");
    if (options.cacheOnly) form.set("add_only_if_cached", "true");

    const res = await fetch(`${TORBOX_BASE_URL}/usenet/createusenetdownload`, {
      method: "POST",
      headers: this.headers,
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs || 45000)
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `torbox_http_${res.status}`,
        detail: text.slice(0, 240)
      };
    }
  }

  requestDownloadPermalink(usenetId: string | number, fileId: string | number): string {
    const params = new URLSearchParams({
      token: this.apiKey,
      usenet_id: String(usenetId),
      file_id: String(fileId),
      redirect: "true",
      append_name: "true"
    });
    return `${TORBOX_BASE_URL}/usenet/requestdl?${params.toString()}`;
  }
}

export function torBoxDataItems(data: any): TorBoxUsenetItem[] {
  const payload = data?.data;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}
