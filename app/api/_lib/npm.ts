import { env } from "cloudflare:workers";

type NpmProxyHost = {
  id: number;
  domain_names?: string[];
};

type EnsureNpmProxyHostInput = {
  domain: string;
  forwardHost: string;
  forwardPort: number;
  npmUrl: string;
};

function getNpmEnv() {
  const values = env as unknown as {
    NPM_IDENTITY?: string;
    NPM_SECRET?: string;
    NPM_ACCESS_LIST_ID?: string;
    NPM_CERTIFICATE_ID?: string;
  };

  return {
    identity: values.NPM_IDENTITY?.trim() ?? "",
    secret: values.NPM_SECRET?.trim() ?? "",
    accessListId: Number(values.NPM_ACCESS_LIST_ID ?? "0"),
    certificateId: Number(values.NPM_CERTIFICATE_ID ?? "0"),
  };
}

function normalizeNpmUrl(url: string) {
  return url.replace(/\/+$/, "");
}

async function readNpmError(response: Response) {
  const output =
    await response.json().catch(() => null) as {
      error?: {
        message?: string;
      };
      message?: string;
    } | null;

  return (
    output?.error?.message ||
    output?.message ||
    `NPM API mengembalikan HTTP ${response.status}`
  );
}

async function getNpmToken(
  npmUrl: string,
  identity: string,
  secret: string,
) {
  const response = await fetch(`${npmUrl}/api/tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identity,
      secret,
    }),
  });

  if (!response.ok) {
    throw new Error(await readNpmError(response));
  }

  const output =
    await response.json() as {
      token?: string;
    };

  if (!output.token) {
    throw new Error("NPM tidak mengembalikan token akses.");
  }

  return output.token;
}

async function npmFetch<T>(
  npmUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${npmUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readNpmError(response));
  }

  if (response.status === 204) {
    return null as T;
  }

  return await response.json() as T;
}

function buildProxyHostPayload(
  input: EnsureNpmProxyHostInput,
) {
  const {
    accessListId,
    certificateId,
  } = getNpmEnv();

  return {
    domain_names: [input.domain],
    forward_scheme: "http",
    forward_host: input.forwardHost,
    forward_port: input.forwardPort,
    access_list_id: accessListId,
    certificate_id: certificateId,
    ssl_forced: certificateId > 0,
    caching_enabled: false,
    block_exploits: true,
    advanced_config: "",
    meta: {
      letsencrypt_agree: false,
      dns_challenge: false,
    },
    allow_websocket_upgrade: true,
    http2_support: certificateId > 0,
    hsts_enabled: false,
    hsts_subdomains: false,
    enabled: true,
    locations: [],
  };
}

export async function ensureNpmProxyHost(
  input: EnsureNpmProxyHostInput,
) {
  const {
    identity,
    secret,
    certificateId,
  } = getNpmEnv();

  if (!identity || !secret || !input.npmUrl) {
    return {
      skipped: true,
      ssl: false,
    };
  }

  const npmUrl =
    normalizeNpmUrl(input.npmUrl);

  const token =
    await getNpmToken(
      npmUrl,
      identity,
      secret,
    );

  const hosts =
    await npmFetch<NpmProxyHost[]>(
      npmUrl,
      token,
      "/api/nginx/proxy-hosts",
    );

  const existing =
    hosts.find((host) =>
      (host.domain_names ?? []).includes(
        input.domain,
      ),
    );

  const payload =
    buildProxyHostPayload(input);

  if (existing) {
    await npmFetch<NpmProxyHost>(
      npmUrl,
      token,
      `/api/nginx/proxy-hosts/${existing.id}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );

    return {
      skipped: false,
      created: false,
      updated: true,
      id: existing.id,
      ssl: certificateId > 0,
    };
  }

  const created =
    await npmFetch<NpmProxyHost>(
      npmUrl,
      token,
      "/api/nginx/proxy-hosts",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

  return {
    skipped: false,
    created: true,
    updated: false,
    id: created.id,
    ssl: certificateId > 0,
  };
}
