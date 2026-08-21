import { env } from "cloudflare:workers";

type NpmProxyHost = {
  id: number;
  domain_names?: string[];
};

type NpmCertificate = {
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

function validateDomain(domain: string) {
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      domain,
    )
  ) {
    throw new Error("Domain project tidak valid untuk NPM.");
  }
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
  certificateId: number,
) {
  const {
    accessListId,
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

async function ensureNpmCertificate(
  npmUrl: string,
  token: string,
  domain: string,
  configuredCertificateId: number,
) {
  if (configuredCertificateId > 0) {
    return configuredCertificateId;
  }

  const certificates =
    await npmFetch<NpmCertificate[]>(
      npmUrl,
      token,
      "/api/nginx/certificates",
    );

  const existing =
    certificates.find((certificate) =>
      (certificate.domain_names ?? []).includes(domain),
    );

  if (existing) {
    return existing.id;
  }

  const reachability =
    await npmFetch<Record<string, string>>(
      npmUrl,
      token,
      "/api/nginx/certificates/test-http",
      {
        method: "POST",
        body: JSON.stringify({
          domains: [domain],
        }),
      },
    );

  const challengeStatus =
    reachability[domain] ?? "tidak ada respons";

  if (
    challengeStatus !== "ok" &&
    challengeStatus !== "404"
  ) {
    throw new Error(
      `HTTP challenge NPM untuk ${domain} gagal: ${challengeStatus}.`,
    );
  }

  const certificatePayloads = [
    {
      provider: "letsencrypt",
      domain_names: [domain],
      meta: {
        letsencrypt_agree: true,
      },
    },
    {
      provider: "letsencrypt",
      domain_names: [domain],
      meta: {
        dns_challenge: false,
      },
    },
    {
      provider: "letsencrypt",
      domain_names: [domain],
      meta: {},
    },
    {
      provider: "letsencrypt",
      domain_names: [domain],
    },
  ];

  let lastSchemaError: Error | null = null;

  for (const payload of certificatePayloads) {
    try {
      const created =
        await npmFetch<NpmCertificate>(
          npmUrl,
          token,
          "/api/nginx/certificates",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
        );

      if (!created.id) {
        throw new Error(
          "NPM tidak mengembalikan ID sertifikat Let's Encrypt.",
        );
      }

      return created.id;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (
        !/additional properties|must NOT have|data\/meta|schema/i.test(
          message,
        )
      ) {
        throw error;
      }

      lastSchemaError =
        error instanceof Error
          ? error
          : new Error(message);
    }
  }

  throw (
    lastSchemaError ??
    new Error(
      "NPM menolak semua format payload sertifikat Let's Encrypt.",
    )
  );
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

  validateDomain(input.domain);

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

  const resolvedCertificateId =
    await ensureNpmCertificate(
      npmUrl,
      token,
      input.domain,
      certificateId,
    );

  const payload =
    buildProxyHostPayload(
      input,
      resolvedCertificateId,
    );

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
      ssl: resolvedCertificateId > 0,
      certificateId: resolvedCertificateId,
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
    ssl: resolvedCertificateId > 0,
    certificateId: resolvedCertificateId,
  };
}
