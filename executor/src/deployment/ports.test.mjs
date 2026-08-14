import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULTS,
  allocateHostPort,
  isValidPort,
  parseDockerPublishedPorts,
  parseListeningPorts,
  portRange,
} from "./ports.mjs";

function withPortEnv(
  min,
  max,
  callback,
) {
  const previousMin =
    process.env.DEPLOY_PORT_MIN;

  const previousMax =
    process.env.DEPLOY_PORT_MAX;

  if (min === undefined) {
    delete process.env.DEPLOY_PORT_MIN;
  } else {
    process.env.DEPLOY_PORT_MIN =
      String(min);
  }

  if (max === undefined) {
    delete process.env.DEPLOY_PORT_MAX;
  } else {
    process.env.DEPLOY_PORT_MAX =
      String(max);
  }

  try {
    return callback();
  } finally {
    if (
      previousMin === undefined
    ) {
      delete process.env.DEPLOY_PORT_MIN;
    } else {
      process.env.DEPLOY_PORT_MIN =
        previousMin;
    }

    if (
      previousMax === undefined
    ) {
      delete process.env.DEPLOY_PORT_MAX;
    } else {
      process.env.DEPLOY_PORT_MAX =
        previousMax;
    }
  }
}

test(
  "portRange: defaults to 20000-29999 when env is unset",
  () => {
    withPortEnv(
      undefined,
      undefined,
      () => {
        assert.deepEqual(
          portRange(),
          {
            min: 20000,
            max: 29999,
          },
        );
      },
    );
  },
);

test(
  "portRange: honors DEPLOY_PORT_MIN/MAX overrides",
  () => {
    withPortEnv(
      25000,
      25100,
      () => {
        assert.deepEqual(
          portRange(),
          {
            min: 25000,
            max: 25100,
          },
        );
      },
    );
  },
);

test(
  "portRange: rejects inverted or out-of-bounds ranges",
  () => {
    withPortEnv(
      30000,
      20000,
      () => {
        assert.throws(
          () => portRange(),
          /tidak valid/,
        );
      },
    );

    withPortEnv(
      0,
      20000,
      () => {
        assert.throws(
          () => portRange(),
          /tidak valid/,
        );
      },
    );

    withPortEnv(
      20000,
      70000,
      () => {
        assert.throws(
          () => portRange(),
          /tidak valid/,
        );
      },
    );
  },
);

test(
  "portRange: rejects malformed integer environment values",
  () => {
    withPortEnv(
      "20000abc",
      "29999",
      () => {
        assert.throws(
          () => portRange(),
          /integer/,
        );
      },
    );
  },
);

test(
  "isValidPort",
  () => {
    assert.equal(
      isValidPort(
        20000,
        {
          min: 20000,
          max: 29999,
        },
      ),
      true,
    );

    assert.equal(
      isValidPort(
        19999,
        {
          min: 20000,
          max: 29999,
        },
      ),
      false,
    );
  },
);

test(
  "parseListeningPorts: extracts IPv4, IPv6 and loopback listening ports",
  () => {
    const sample = `
LISTEN 0 4096 10.90.100.3:8088 0.0.0.0:*
LISTEN 0 128 0.0.0.0:22 0.0.0.0:*
LISTEN 0 4096 127.0.0.1:9100 0.0.0.0:*
LISTEN 0 4096 [::]:9443 [::]:*
`;

    assert.deepEqual(
      parseListeningPorts(sample).sort(
        (a, b) => a - b,
      ),
      [
        22,
        8088,
        9100,
        9443,
      ],
    );
  },
);

test(
  "parseDockerPublishedPorts: extracts IPv4 and IPv6 published ports",
  () => {
    const sample = `
0.0.0.0:8095->80/tcp, [::]:8095->80/tcp
10.90.100.3:8088->3000/tcp
127.0.0.1:9100->9100/tcp
3306/tcp
`;

    assert.deepEqual(
      parseDockerPublishedPorts(
        sample,
      ).sort(
        (a, b) => a - b,
      ),
      [
        8088,
        8095,
        9100,
      ],
    );
  },
);

test(
  "allocateHostPort: returns lowest free port and reserves it",
  async () => {
    await withPortEnv(
      21000,
      21002,
      async () => {
        const excluded =
          new Set([21000]);

        const port =
          await allocateHostPort(
            excluded,
          );

        assert.equal(
          port,
          21001,
        );

        assert.equal(
          excluded.has(21001),
          true,
        );
      },
    );
  },
);

test(
  "allocateHostPort: throws when range is exhausted",
  async () => {
    await withPortEnv(
      22000,
      22001,
      async () => {
        await assert.rejects(
          () =>
            allocateHostPort(
              new Set([
                22000,
                22001,
              ]),
            ),
          /Tidak ada host port kosong/,
        );
      },
    );
  },
);

test(
  "allocateHostPort: never returns reserved service port",
  async () => {
    const excluded =
      new Set(
        DEFAULTS.reserved,
      );

    await withPortEnv(
      8088,
      8089,
      async () => {
        const port =
          await allocateHostPort(
            excluded,
          );

        assert.equal(
          port,
          8089,
        );
      },
    );
  },
);