import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";

type QueryValue = string | string[] | undefined;

export type VercelRequest = IncomingMessage & {
  body?: unknown;
  headers: IncomingHttpHeaders & Record<string, string | string[] | undefined>;
  method?: string;
  query: Record<string, QueryValue>;
};

export type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};
