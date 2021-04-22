import { ECPairInterface } from "bitcoinjs-lib";
import * as bitcoin from "bitcoinjs-lib";
import { toCashAddress, toLegacyAddress } from "bchaddrjs";
import * as core from "@shapeshiftoss/hdwallet-core";
import { getNetwork } from "./networks";
import { NativeHDWalletBase } from "./native";

// TODO: add bitcoincash support. Everything is working outside of transaction signing. There is a fork of bitcoinjs-lib that supports bitcoin clones that would be worth looking into (see: https://github.com/junderw/bitcoinjs-lib/tree/cashv5).

const supportedCoins = ["bitcoin", "dash", "digibyte", "dogecoin", "litecoin", "testnet"];

const segwit = ["p2wpkh", "p2sh-p2wpkh"];

type BTCScriptType = core.BTCInputScriptType | core.BTCOutputScriptType;

type NonWitnessUtxo = Buffer;

type WitnessUtxo = {
  script: Buffer;
  amount: Number;
};

type UtxoData = NonWitnessUtxo | WitnessUtxo;

type ScriptData = {
  redeemScript?: Buffer;
  witnessScript?: Buffer;
};

type InputData = UtxoData | ScriptData;

function getKeyPair(
  seed: Buffer,
  addressNList: number[],
  coin = "bitcoin",
  scriptType?: BTCScriptType
): ECPairInterface {
  const network = getNetwork(coin, scriptType);
  const wallet = bitcoin.bip32.fromSeed(seed, network);
  const path = core.addressNListToBIP32(addressNList);
  return bitcoin.ECPair.fromWIF(wallet.derivePath(path).toWIF(), getNetwork(coin, scriptType));
}

export function MixinNativeBTCWalletInfo<TBase extends core.Constructor>(Base: TBase) {
  return class MixinNativeBTCWalletInfo extends Base implements core.BTCWalletInfo {
    _supportsBTCInfo = true;

    async btcSupportsCoin(coin: core.Coin): Promise<boolean> {
      return supportedCoins.includes(String(coin).toLowerCase());
    }

    async btcSupportsScriptType(coin: core.Coin, scriptType: core.BTCInputScriptType): Promise<boolean> {
      if (!(await this.btcSupportsCoin(coin))) return false;

      switch (scriptType) {
        case core.BTCInputScriptType.SpendMultisig:
        case core.BTCInputScriptType.SpendAddress:
        case core.BTCInputScriptType.SpendWitness:
        case core.BTCInputScriptType.SpendP2SHWitness:
          return true;
        default:
          return false;
      }
    }

    async btcSupportsSecureTransfer(): Promise<boolean> {
      return false;
    }

    btcSupportsNativeShapeShift(): boolean {
      return false;
    }

    btcGetAccountPaths(msg: core.BTCGetAccountPaths): Array<core.BTCAccountPath> {
      const slip44 = core.slip44ByCoin(msg.coin);
      const bip44 = core.legacyAccount(msg.coin, slip44, msg.accountIdx);
      const bip49 = core.segwitAccount(msg.coin, slip44, msg.accountIdx);
      const bip84 = core.segwitNativeAccount(msg.coin, slip44, msg.accountIdx);

      const coinPaths = {
        bitcoin: [bip44, bip49, bip84],
        bitcoincash: [bip44, bip49, bip84],
        dash: [bip44],
        digibyte: [bip44, bip49, bip84],
        dogecoin: [bip44],
        litecoin: [bip44, bip49, bip84],
        testnet: [bip44, bip49, bip84],
      };

      let paths: Array<core.BTCAccountPath> = coinPaths[msg.coin.toLowerCase()] || [];

      if (msg.scriptType !== undefined) {
        paths = paths.filter((path) => {
          return path.scriptType === msg.scriptType;
        });
      }

      return paths;
    }

    btcIsSameAccount(msg: Array<core.BTCAccountPath>): boolean {
      // TODO: support at some point
      return false;
    }

    btcNextAccountPath(msg: core.BTCAccountPath): core.BTCAccountPath {
      const description = core.describeUTXOPath(msg.addressNList, msg.coin, msg.scriptType);

      if (!description.isKnown) {
        return undefined;
      }

      let addressNList = msg.addressNList;

      if (
        addressNList[0] === 0x80000000 + 44 ||
        addressNList[0] === 0x80000000 + 49 ||
        addressNList[0] === 0x80000000 + 84
      ) {
        addressNList[2] += 1;
        return {
          ...msg,
          addressNList,
        };
      }

      return undefined;
    }
  };
}

export function MixinNativeBTCWallet<TBase extends core.Constructor<NativeHDWalletBase>>(Base: TBase) {
  return class MixinNativeBTCWallet extends Base {
    _supportsBTC: boolean;

    #wallet: Buffer;

    async btcInitializeWallet(seed: Buffer): Promise<void> {
      this.#wallet = seed;
    }

    btcWipe(): void {
      this.#wallet = undefined;
    }

    createPayment(pubkey: Buffer, scriptType: BTCScriptType, network?: bitcoin.Network): bitcoin.Payment {
      switch (scriptType) {
        case "p2sh":
          return bitcoin.payments.p2sh({ pubkey, network });
        case "p2pkh":
          return bitcoin.payments.p2pkh({ pubkey, network });
        case "p2wpkh":
          return bitcoin.payments.p2wpkh({ pubkey, network });
        case "p2sh-p2wpkh":
          return bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
            network,
          });
        default:
          throw new Error(`no implementation for script type: ${scriptType}`);
      }
    }

    validateVoutOrdering(msg: core.BTCSignTx, tx: bitcoin.Transaction): boolean {
      // From THORChain specification:
      /* ignoreTx checks if we can already ignore a tx according to preset rules
        
         we expect array of "vout" for a BTC to have this format
         OP_RETURN is mandatory only on inbound tx
         vout:0 is our vault
         vout:1 is any any change back to themselves
         vout:2 is OP_RETURN (first 80 bytes)
         vout:3 is OP_RETURN (next 80 bytes)
        
         Rules to ignore a tx are:
         - vout:0 doesn't have coins (value)
         - vout:0 doesn't have address
         - count vouts > 4
         - count vouts with coins (value) > 2
      */

      // Check that vout:0 contains the vault address
      if (bitcoin.address.fromOutputScript(tx.outs[0].script) != msg.vaultAddress) {
        console.error("Vout:0 does not contain vault address.");
        return false;
      }

      // TODO: Can we check and  make sure vout:1 is our address?

      // Check and make sure vout:2 exists
      if (tx.outs.length < 3) {
        console.error("Not enough outputs found in transaction.", msg);
        return false;
      }
      // Check and make sure vout:2 has OP_RETURN data
      let opcode = bitcoin.script.decompile(tx.outs[2].script)[0];
      if (Object.keys(bitcoin.script.OPS).find((k) => bitcoin.script.OPS[k] === opcode) != "OP_RETURN") {
        console.error("OP_RETURN output not found for transaction.");
        return false;
      }

      // Make sure vout:3 does not exist
      if (tx.outs[3]) {
        console.error("Illegal second op_return output found.");
        return false;
      }

      return true;
    }

    buildInput(coin: core.Coin, input: core.BTCSignTxInput): InputData {
      return this.needsMnemonic(!!this.#wallet, () => {
        const { addressNList, amount, hex, scriptType, tx, vout } = input;
        const keyPair = getKeyPair(this.#wallet, addressNList, coin, scriptType);

        const isSegwit = segwit.includes(scriptType);
        const nonWitnessUtxo = hex && Buffer.from(hex, "hex");
        const witnessUtxo = tx && {
          script: Buffer.from(tx.vout[vout].scriptPubKey.hex, "hex"),
          value: Number(amount),
        };
        const utxoData = isSegwit && witnessUtxo ? { witnessUtxo } : { nonWitnessUtxo };

        if (!utxoData) {
          throw new Error(
            "failed to build input - must provide prev rawTx (segwit input can provide scriptPubKey hex and value instead)"
          );
        }

        const { publicKey, network } = keyPair;
        const payment = this.createPayment(publicKey, scriptType, network);

        let scriptData: ScriptData = {};
        switch (scriptType) {
          case "p2sh":
          case "p2sh-p2wpkh":
            scriptData.redeemScript = payment.redeem.output;
            break;
        }

        return {
          ...utxoData,
          ...scriptData,
        };
      });
    }

    async btcGetAddress(msg: core.BTCGetAddress): Promise<string> {
      return this.needsMnemonic(!!this.#wallet, () => {
        const { addressNList, coin, scriptType } = msg;
        const keyPair = getKeyPair(this.#wallet, addressNList, coin, scriptType);
        const { address } = this.createPayment(keyPair.publicKey, scriptType, keyPair.network);
        return coin.toLowerCase() === "bitcoincash" ? toCashAddress(address) : address;
      });
    }

    async btcSignTx(msg: core.BTCSignTx): Promise<core.BTCSignedTx> {
      return this.needsMnemonic(!!this.#wallet, () => {
        const { coin, inputs, outputs, version, locktime } = msg;

        const psbt = new bitcoin.Psbt({ network: getNetwork(coin) });

        psbt.setVersion(version | 1);
        locktime && psbt.setLocktime(locktime);

        inputs.forEach((input) => {
          try {
            const inputData = this.buildInput(coin, input);

            psbt.addInput({
              hash: input.txid,
              index: input.vout,
              ...inputData,
            });
          } catch (e) {
            throw new Error(`failed to add input: ${e}`);
          }
        });

        outputs.map((output) => {
          try {
            const { address: addr, amount, addressNList, scriptType } = output;

            let address = addr;
            if (!address) {
              const keyPair = getKeyPair(this.#wallet, addressNList, coin, scriptType);
              const { publicKey, network } = keyPair;
              const payment = this.createPayment(publicKey, scriptType, network);
              address = payment.address;
            }

            if (coin.toLowerCase() === "bitcoincash") {
              address = toLegacyAddress(address);
            }

            psbt.addOutput({ address, value: Number(amount) });
          } catch (e) {
            throw new Error(`failed to add output: ${e}`);
          }
        });

        if (msg.opReturnData) {
          const data = Buffer.from(msg.opReturnData, "utf-8");
          const embed = bitcoin.payments.embed({ data: [data] });
          psbt.addOutput({ script: embed.output, value: 0 });
        }

        inputs.forEach((input, idx) => {
          try {
            const { addressNList, scriptType } = input;
            const keyPair = getKeyPair(this.#wallet, addressNList, coin, scriptType);
            psbt.signInput(idx, keyPair);
          } catch (e) {
            throw new Error(`failed to sign input: ${e}`);
          }
        });

        psbt.finalizeAllInputs();

        const tx = psbt.extractTransaction(true);

        // If this is a THORChain transaction, validate the vout ordering
        if (msg.vaultAddress && !this.validateVoutOrdering(msg, tx)) {
          throw new Error("Improper vout ordering for BTC Thorchain transaction");
        }

        const signatures = tx.ins.map((input) => {
          const sigLen = input.script[0];
          return input.script.slice(1, sigLen).toString("hex");
        });

        return {
          signatures,
          serializedTx: tx.toHex(),
        };
      });
    }

    async btcSignMessage(msg: core.BTCSignMessage): Promise<core.BTCSignedMessage> {
      throw new Error("function not implemented");
    }

    async btcVerifyMessage(msg: core.BTCVerifyMessage): Promise<boolean> {
      throw new Error("function not implemented");
    }
  };
}
