import { nanoid } from "nanoid";

type BridgeConfig = { deepbridFinderBridgeEnabled?: boolean; deepbridFinderBridgeId?: string; deepbridFinderBridgeSecret?: string };
type BridgeRequest = { id: string; url: string; accept: string; ajax: boolean };
type PendingRequest = { request: BridgeRequest; resolve: (value: { statusCode: number; text: string }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type BridgeClient = { secret: string; queue: BridgeRequest[]; pollWaiters: Array<(request?: BridgeRequest) => void>; pending: Map<string, PendingRequest>; lastSeenAt: number };

const clients = new Map<string, BridgeClient>();

function config(config: BridgeConfig) {
  const id = String(config?.deepbridFinderBridgeId || "").trim();
  const secret = String(config?.deepbridFinderBridgeSecret || "").trim();
  return id && secret && config?.deepbridFinderBridgeEnabled ? { id, secret } : undefined;
}

function clientFor(value: BridgeConfig, create = false): BridgeClient | undefined {
  const pair = config(value);
  if (!pair) return undefined;
  let client = clients.get(pair.id);
  if (!client && create) {
    client = { secret: pair.secret, queue: [], pollWaiters: [], pending: new Map(), lastSeenAt: Date.now() };
    clients.set(pair.id, client);
  }
  if (!client || client.secret !== pair.secret) return undefined;
  return client;
}

export function isBrowserBridgeConfigured(value: BridgeConfig): boolean {
  return Boolean(config(value));
}

export function pairBrowserBridge(value: BridgeConfig): boolean {
  const client = clientFor(value, true);
  if (!client) return false;
  client.lastSeenAt = Date.now();
  return true;
}

export function pollBrowserBridge(value: BridgeConfig): BridgeRequest | undefined {
  const client = clientFor(value, true);
  if (!client) return undefined;
  client.lastSeenAt = Date.now();
  return client.queue.shift();
}

export function waitForBrowserBridgeRequest(value: BridgeConfig, timeoutMs = 25000): Promise<BridgeRequest | undefined> {
  const client = clientFor(value, true);
  if (!client) return Promise.resolve(undefined);
  const queued = client.queue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise(resolve => {
    let waiter: (request?: BridgeRequest) => void;
    const timer = setTimeout(() => {
      const index = client.pollWaiters.indexOf(waiter);
      if (index >= 0) client.pollWaiters.splice(index, 1);
      resolve(undefined);
    }, timeoutMs);
    waiter = request => { clearTimeout(timer); resolve(request); };
    client.pollWaiters.push(waiter);
  });
}

export function respondBrowserBridge(value: BridgeConfig, id: string, statusCode: number, text: string): boolean {
  const client = clientFor(value);
  const pending = client?.pending.get(id);
  if (!client || !pending || !Number.isInteger(statusCode) || typeof text !== "string") return false;
  client.pending.delete(id);
  clearTimeout(pending.timer);
  client.lastSeenAt = Date.now();
  pending.resolve({ statusCode, text: text.slice(0, 4 * 1024 * 1024) });
  return true;
}

export function requestBrowserBridge(value: BridgeConfig, url: string, accept: string, ajax: boolean, timeoutMs: number): Promise<{ statusCode: number; text: string }> {
  const client = clientFor(value);
  if (!client) return Promise.reject(new Error("deepbrid_finder_browser_not_paired"));
  const request: BridgeRequest = { id: nanoid(), url, accept, ajax };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(request.id);
      reject(new Error("deepbrid_finder_browser_timeout"));
    }, Math.max(1000, timeoutMs));
    client.pending.set(request.id, { request, resolve, reject, timer });
    const waiter = client.pollWaiters.shift();
    if (waiter) waiter(request);
    else client.queue.push(request);
  });
}

export function browserBridgeStatus(value: BridgeConfig) {
  const client = clientFor(value);
  return { configured: isBrowserBridgeConfigured(value), paired: Boolean(client), queued: client?.queue.length || 0, lastSeenAt: client?.lastSeenAt || 0 };
}
