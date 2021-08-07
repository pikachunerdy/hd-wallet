import * as core from "@shapeshiftoss/hdwallet-core";

import tx_unsigned from "./tx01.mainnet.osmosis.json";
import tx_signed from "./tx01.mainnet.osmosis.json";

const MNEMONIC12_NOPIN_NOPASSPHRASE = "alcohol woman abuse must during monitor noble actual mixed trade anger aisle";

const TIMEOUT = 60 * 1000;

/**
 *  Main integration suite for testing OsmosisWallet implementations' Osmosis support.
 */
export function osmosisTests(get: () => { wallet: core.HDWallet; info: core.HDWalletInfo }): void {
  let wallet: core.OsmosisWallet & core.HDWallet;

  describe.only("Osmosis", () => {
    beforeAll(async () => {
      const { wallet: w } = get();
      if (core.supportsOsmosis(w)) wallet = w;
    });

    beforeEach(async () => {
      if (!wallet) return;
      await wallet.wipe();
      await wallet.loadDevice({
        mnemonic: MNEMONIC12_NOPIN_NOPASSPHRASE,
        label: "test",
        skipChecksum: true,
      });
    }, TIMEOUT);

    test(
      "osmosisGetAccountPaths()",
      () => {
        if (!wallet) return;
        const paths = wallet.osmosisGetAccountPaths({ accountIdx: 0 });
        expect(paths.length > 0).toBe(true);
        expect(paths[0].addressNList[0] > 0x80000000).toBe(true);
      },
      TIMEOUT
    );

    test(
      "osmosisGetAddress()",
      async () => {
        if (!wallet) return;
        expect(
          await wallet.osmosisGetAddress({
            addressNList: core.bip32ToAddressNList("m/44'/118'/0'/0/0"),
            showDisplay: false,
          })
        ).toEqual("");
      },
      TIMEOUT
    );

    test(
      "osmosisSignTx()",
      async () => {
        if (!wallet) return;
        const input: core.OsmosisSignTx = {
          tx: (tx_unsigned as unknown) as core.OsmosisTx,
          addressNList: core.bip32ToAddressNList("m/44'/118'/0'/0/0"),
          chain_id: "osmosis-1",
          account_number: "16354",
          sequence: "5",
        };

        const res = await wallet.osmosisSignTx(input);
        expect(res?.signatures?.[0].signature).toEqual(tx_signed.signatures[0].signature);
      },
      TIMEOUT
    );
  });
}
