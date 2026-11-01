"use strict";
const assert = require("assert");
const { avaliarHardwareLocal } = require("../electron/iaHardware");

async function main() {
  const baixo = await avaliarHardwareLocal({
    ramMinGb: 9999,
    diskMinGb: 0,
    probeOllama: async () => false,
  });
  assert.strictEqual(baixo.localOk, false);
  assert.ok(baixo.motivo);

  const ok = await avaliarHardwareLocal({
    ramMinGb: 0,
    diskMinGb: 0,
    probeOllama: async () => true,
    ramLivreGbOverride: 16,
  });
  assert.strictEqual(ok.localOk, true);
  console.log("ok hardware");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
