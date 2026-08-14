import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImage,
  buildStartContainerArgs,
  ensureNetwork,
  startContainer,
  stopContainer,
  removeNetwork,
} from "./docker.mjs";

test(
  "buildImage: rejects an unsafe image tag before spawning docker",
  async () => {
    await assert.rejects(
      () =>
        buildImage({
          dockerfile:
            "/tmp/x.Dockerfile",
          context: "/tmp",
          tag: "../escape:x",
        }),
      /Nama image tidak aman/,
    );
  },
);

test(
  "buildImage: accepts a well-formed nexdeploy image name",
  async () => {
    await assert.rejects(
      () =>
        buildImage({
          dockerfile:
            "/tmp/does-not-exist.Dockerfile",
          context: "/tmp",
          tag:
            "nexdeploy/my-app:abc123",
        }),
      (error) =>
        !/Nama image tidak aman/.test(
          error.message,
        ),
    );
  },
);

test(
  "ensureNetwork: rejects an unsafe network name",
  async () => {
    await assert.rejects(
      () =>
        ensureNetwork(
          "../evil; rm -rf /",
        ),
      /Nama network tidak aman/,
    );
  },
);

test(
  "startContainer: rejects an unsafe container or network name",
  async () => {
    await assert.rejects(
      () =>
        startContainer({
          name: "bad name!",
          image: "x",
          network: "net",
          hostPort: 20000,
          containerPort: 8080,
        }),
      /Nama container tidak aman/,
    );
  },
);

test(
  "startContainer: rejects an out-of-range host or container port",
  async () => {
    await assert.rejects(
      () =>
        startContainer({
          name: "ok-name",
          image: "x",
          network: "ok-net",
          hostPort: 99999,
          containerPort: 8080,
        }),
      /hostPort tidak valid/,
    );

    await assert.rejects(
      () =>
        startContainer({
          name: "ok-name",
          image: "x",
          network: "ok-net",
          hostPort: 20000,
          containerPort: 0,
        }),
      /containerPort tidak valid/,
    );
  },
);

test(
  "stopContainer / removeNetwork: reject unsafe names",
  () => {
    assert.throws(
      () =>
        stopContainer("../evil"),
      /Nama container tidak aman/,
    );

    assert.throws(
      () =>
        removeNetwork("../evil"),
      /Nama network tidak aman/,
    );
  },
);

test(
  "buildStartContainerArgs: env-file is passed before image",
  () => {
    const args =
      buildStartContainerArgs({
        name:
          "nexdeploy-demo-app-abc",
        image:
          "nexdeploy/demo:abc",
        network:
          "nexdeploy-demo-network",
        hostPort:
          22000,
        containerPort:
          8080,
        envFile:
          "/projects/demo/.env",
      });

    const envFileIndex =
      args.indexOf("--env-file");

    const imageIndex =
      args.indexOf(
        "nexdeploy/demo:abc",
      );

    assert.ok(
      envFileIndex >= 0,
    );

    assert.ok(
      imageIndex > envFileIndex,
    );

    assert.equal(
      args[
        envFileIndex + 1
      ],
      "/projects/demo/.env",
    );
  },
);

test(
  "buildStartContainerArgs: healthcheck options appear before image",
  () => {
    const args =
      buildStartContainerArgs({
        name:
          "nexdeploy-demo-app-abc",
        image:
          "nexdeploy/demo:abc",
        network:
          "nexdeploy-demo-network",
        hostPort:
          22000,
        containerPort:
          8080,
        healthcheck: {
          cmd:
            "wget -qO- http://127.0.0.1:8080/",
          interval:
            "5s",
          timeout:
            "3s",
          retries:
            5,
          startPeriod:
            "15s",
        },
      });

    const imageIndex =
      args.indexOf(
        "nexdeploy/demo:abc",
      );

    for (
      const option of [
        "--health-cmd",
        "--health-interval",
        "--health-timeout",
        "--health-retries",
        "--health-start-period",
      ]
    ) {
      const optionIndex =
        args.indexOf(option);

      assert.ok(
        optionIndex >= 0,
        `${option} tidak ditemukan`,
      );

      assert.ok(
        optionIndex <
          imageIndex,
        `${option} harus berada sebelum image`,
      );
    }
  },
);

test(
  "buildStartContainerArgs: never adds privileged or docker.sock implicitly",
  () => {
    const args =
      buildStartContainerArgs({
        name:
          "nexdeploy-demo-app-abc",
        image:
          "nexdeploy/demo:abc",
        network:
          "nexdeploy-demo-network",
        hostPort:
          22000,
        containerPort:
          8080,
        envFile:
          "/projects/demo/.env",
      });

    assert.equal(
      args.includes(
        "--privileged",
      ),
      false,
    );

    assert.equal(
      args.some(
        (value) =>
          String(
            value,
          ).includes(
            "/var/run/docker.sock",
          ),
      ),
      false,
    );
  },
);