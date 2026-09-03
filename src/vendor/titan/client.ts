// Minimal Titan V1 WebSocket client — vendored from @titanexchange/sdk-ts
// Source: https://github.com/Titan-Pathfinder/titan-sdk-ts (MIT)
//
// Differences from upstream:
// - No compression (negotiates only "v1.api.titan.ag" subprotocol)
// - Uses `ws` package instead of `websocket`
// - Only implements connect, newSwapQuoteStream, stopStream, close

import { Encoder, Decoder } from "@msgpack/msgpack";
import WebSocket from "ws";

import type {
  ClientRequest,
  SwapQuoteRequest,
  ServerMessage,
  ResponseSuccess,
  ResponseError,
  StreamData,
  StreamEnd,
  SwapQuotes,
  QuoteSwapStreamResponse,
  StopStreamResponse,
} from "./types";

const SUBPROTOCOL = "v1.api.titan.ag";
const UINT64_MAX = (1n << 64n) - 1n;

function toBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n || value > UINT64_MAX) {
      throw new RangeError(`Amount out of uint64 range: ${value}`);
    }
    return value;
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(`Amount must be a whole number, got ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`Amount must be non-negative, got ${value}`);
  }
  return BigInt(value);
}

// --- Error classes ---

export class ConnectionClosed extends Error {
  code: number;
  reason: string;

  constructor(code: number, reason: string) {
    super(`Client WebSocket closed with code ${code}: ${reason}`);
    this.name = "ConnectionClosed";
    Object.setPrototypeOf(this, ConnectionClosed.prototype);
    this.code = code;
    this.reason = reason;
  }
}

export class ErrorResponse extends Error {
  response: ResponseError;

  constructor(response: ResponseError) {
    super(`Request ${response.requestId} failed with code ${response.code}: ${response.message}`);
    this.name = "ErrorResponse";
    Object.setPrototypeOf(this, ErrorResponse.prototype);
    this.response = response;
  }
}

export class StreamError extends Error {
  streamId: number;
  errorCode: number;
  errorMessage: string;

  constructor(packet: StreamEnd) {
    const code = packet.errorCode ?? 0;
    const message = packet.errorMessage ?? "";
    super(`Stream ${packet.id} ended with error code ${code}: ${message}`);
    this.name = "StreamError";
    Object.setPrototypeOf(this, StreamError.prototype);
    this.streamId = packet.id;
    this.errorCode = code;
    this.errorMessage = message;
  }
}

// --- Response handler types ---

export interface ResponseWithStream<T, D> {
  response: T;
  stream: ReadableStream<D>;
  streamId: number;
}

type Resolver<T> = (value: T | PromiseLike<T>) => void;
type Rejector = (reason?: unknown) => void;

interface PendingRequest {
  resolve: Resolver<unknown>;
  reject: Rejector;
  kind: "NewSwapQuoteStream" | "StopStream";
}

// --- Codec (msgpack, no compression) ---

const encoder = new Encoder({ useBigInt64: true });
const decoder = new Decoder({ useBigInt64: true });

// --- V1Client ---

export class V1Client {
  private socket: WebSocket;
  private nextId = 0;
  private _closed = false;
  private _closing = false;

  private pending = new Map<number, PendingRequest>();
  private streams = new Map<number, ReadableStreamDefaultController<SwapQuotes>>();
  private streamStopping = new Map<number, boolean>();
  private closeListeners: { resolve: Resolver<void>; reject: Rejector }[] = [];

  // --- Static connect ---

  static connect(url: string): Promise<V1Client> {
    return new Promise<V1Client>((resolve, reject) => {
      const ws = new WebSocket(url, [SUBPROTOCOL]);

      ws.binaryType = "arraybuffer";

      const onOpen = () => {
        // ws doesn't populate .protocol when using the `ws` library in Node
        // but since we only offer one subprotocol, the server must accept it.
        ws.off("error", onError);
        ws.off("close", onClose);
        resolve(new V1Client(ws));
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        ws.off("close", onClose);
        reject(err);
      };
      // Guard against the socket closing before `open` fires without a
      // preceding `error` (e.g. a clean close during handshake). Without this
      // the promise would hang forever.
      const onClose = (code: number, reason: Buffer) => {
        ws.off("open", onOpen);
        ws.off("error", onError);
        reject(
          new Error(
            `WebSocket closed before open (code=${code}${
              reason.length ? `, reason=${reason.toString()}` : ""
            })`
          )
        );
      };

      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.once("close", onClose);
    });
  }

  // --- Constructor ---

  private constructor(socket: WebSocket) {
    this.socket = socket;

    this.socket.on("message", (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });
    this.socket.on("close", (code: number, reason: Buffer) => {
      this.handleClose(code, reason.toString());
    });
    this.socket.on("error", (err: Error) => {
      this.handleError(err);
    });
  }

  private nextRequestId(): number {
    return this.nextId++;
  }

  // --- Public API ---

  public get closed(): boolean {
    return this._closed;
  }

  public close(): Promise<void> {
    if (this._closed) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.closeListeners.push({ resolve, reject });
      if (!this._closing) {
        this._closing = true;
        this.socket.close();
      }
    });
  }

  public newSwapQuoteStream(
    params: SwapQuoteRequest
  ): Promise<ResponseWithStream<QuoteSwapStreamResponse, SwapQuotes>> {
    const requestId = this.nextRequestId();

    const promise = new Promise<ResponseWithStream<QuoteSwapStreamResponse, SwapQuotes>>(
      (resolve, reject) => {
        this.pending.set(requestId, {
          resolve: resolve as Resolver<unknown>,
          reject,
          kind: "NewSwapQuoteStream",
        });
      }
    );

    const normalized: SwapQuoteRequest = {
      ...params,
      swap: { ...params.swap, amount: toBigInt(params.swap.amount) },
    };

    const message: ClientRequest = {
      id: requestId,
      data: { NewSwapQuoteStream: normalized },
    };
    this.send(message);

    return promise;
  }

  public stopStream(streamId: number): Promise<StopStreamResponse> {
    const requestId = this.nextRequestId();

    const promise = new Promise<StopStreamResponse>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as Resolver<unknown>,
        reject,
        kind: "StopStream",
      });
    });

    const message: ClientRequest = {
      id: requestId,
      data: { StopStream: { id: streamId } },
    };
    this.send(message);

    return promise;
  }

  // --- Send ---

  private send(message: ClientRequest): void {
    try {
      const encoded = encoder.encode(message);
      this.socket.send(encoded);
    } catch (err) {
      const req = this.pending.get(message.id);
      if (req) {
        this.pending.delete(message.id);
        req.reject(err);
      }
    }
  }

  // --- Message handling ---

  private handleMessage(raw: WebSocket.RawData): void {
    let buf: Uint8Array;
    if (raw instanceof ArrayBuffer) {
      buf = new Uint8Array(raw);
    } else if (Buffer.isBuffer(raw)) {
      buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else if (Array.isArray(raw)) {
      buf = new Uint8Array(Buffer.concat(raw));
    } else {
      return;
    }

    let message: ServerMessage;
    try {
      message = decoder.decode(buf) as ServerMessage;
    } catch {
      this.socket.close(3002, "failed to decode message");
      return;
    }

    if ("Response" in message) {
      this.handleResponse(message.Response);
    } else if ("Error" in message) {
      this.handleResponseError(message.Error);
    } else if ("StreamData" in message) {
      this.handleStreamData(message.StreamData);
    } else if ("StreamEnd" in message) {
      this.handleStreamEnd(message.StreamEnd);
    }
  }

  private handleResponse(msg: ResponseSuccess): void {
    const req = this.pending.get(msg.requestId);
    if (!req) return;
    this.pending.delete(msg.requestId);

    if ("NewSwapQuoteStream" in msg.data && req.kind === "NewSwapQuoteStream") {
      const streamInfo = msg.stream;
      if (!streamInfo) {
        req.reject(new Error("No stream associated with NewSwapQuoteStream response"));
        return;
      }
      const stream = new ReadableStream<SwapQuotes>({
        start: (controller) => {
          this.streams.set(streamInfo.id, controller);
        },
        cancel: () => {
          return this.cancelStream(streamInfo.id);
        },
      });
      const result: ResponseWithStream<QuoteSwapStreamResponse, SwapQuotes> = {
        response: msg.data.NewSwapQuoteStream,
        stream,
        streamId: streamInfo.id,
      };
      req.resolve(result);
    } else if ("StreamStopped" in msg.data && req.kind === "StopStream") {
      req.resolve(msg.data.StreamStopped);
    } else {
      req.reject(new Error(`Unexpected response type for ${req.kind}`));
    }
  }

  private handleResponseError(error: ResponseError): void {
    const req = this.pending.get(error.requestId);
    if (!req) return;
    this.pending.delete(error.requestId);
    req.reject(new ErrorResponse(error));
  }

  private handleStreamData(packet: StreamData): void {
    const controller = this.streams.get(packet.id);
    if (!controller) return;
    if (packet.payload.SwapQuotes !== undefined) {
      controller.enqueue(packet.payload.SwapQuotes);
    }
  }

  private handleStreamEnd(packet: StreamEnd): void {
    const controller = this.streams.get(packet.id);
    if (!controller) return;
    this.streams.delete(packet.id);
    this.streamStopping.delete(packet.id);

    if (packet.errorCode !== undefined) {
      controller.error(new StreamError(packet));
    } else {
      controller.close();
    }
  }

  private async cancelStream(streamId: number): Promise<void> {
    if (this.streamStopping.get(streamId) || !this.streams.has(streamId)) return;
    this.streamStopping.set(streamId, true);
    await this.stopStream(streamId);
  }

  // --- Connection lifecycle ---

  private rejectAll(error: Error): void {
    for (const req of this.pending.values()) {
      req.reject(error);
    }
    this.pending.clear();
    for (const controller of this.streams.values()) {
      controller.error(error);
    }
    this.streams.clear();
    this.streamStopping.clear();
  }

  private handleClose(code: number, reason: string): void {
    this._closed = true;
    this.rejectAll(new ConnectionClosed(code, reason));
    for (const listener of this.closeListeners) {
      listener.resolve();
    }
    this.closeListeners = [];
  }

  private handleError(err: Error): void {
    this.rejectAll(err);
    this.socket.close(3002);
  }
}
