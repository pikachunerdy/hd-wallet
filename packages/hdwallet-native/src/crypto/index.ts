import { validateMnemonic } from "bip39";
import { CryptoEngine } from "./engines";
import CryptoHelper from "./CryptoHelper";
import { CipherString, SymmetricCryptoKey } from "./classes";
import * as utils from "./utils";

export class EncryptedWallet {
  readonly #engine: CryptoEngine;
  readonly #helper: CryptoHelper;
  #email: string;
  #encryptedWallet: string;
  #key: SymmetricCryptoKey;
  #password: string;
  #passwordHash: string;

  constructor(engine: CryptoEngine) {
    if (!engine) {
      throw new Error("Missing cryptography engine");
    }
    this.#engine = engine;
    this.#helper = new CryptoHelper(this.#engine);
  }

  get isInitialized() {
    return Boolean(this.#email && this.#password && this.#passwordHash && this.#key);
  }

  get email() {
    return this.#email;
  }

  get passwordHash() {
    return this.#passwordHash;
  }

  get encryptedWallet() {
    return this.#encryptedWallet;
  }

  set encryptedWallet(wallet: string) {
    this.#encryptedWallet = new CipherString(wallet).encryptedString;
  }

  /**
   * Initialize the wallet with and email and password
   *
   * This cannot be done in the constructor because it performs async operations
   */
  async init(email: string, password: string, encryptedWallet?: string): Promise<EncryptedWallet> {
    if (!(email && typeof email === "string" && email.length > 0)) {
      throw new Error("Invalid email address");
    }
    if (!(password && typeof password === "string" && password.length > 0)) {
      throw new Error("Invalid password");
    }

    this.#email = email.normalize("NFKC").trim().toLowerCase();
    this.#password = password.normalize("NFKC");
    this.#key = await this.#helper.makeKey(this.#password, this.#email);
    this.#passwordHash = await this.#helper.hashPassword(this.#password, this.#key);

    if (encryptedWallet) {
      this.encryptedWallet = encryptedWallet;
    }

    return this;
  }

  async createWallet() {
    if (!this.isInitialized) throw new Error("Wallet is not initialized");
    const mnemonic = await this.#helper.generateMnemonic();

    if (!validateMnemonic(mnemonic)) {
      throw new Error("Invalid mnemonic");
    }

    const stretchedKey = await this.#helper.stretchKey(this.#key);
    const encrypted = new CipherString(await this.#helper.aesEncrypt(utils.toArrayBuffer(mnemonic), stretchedKey));
    this.#encryptedWallet = encrypted.encryptedString;

    return this;
  }

  async decrypt(encryptedWallet = this.#encryptedWallet): Promise<string> {
    if (!this.isInitialized) throw new Error("Wallet is not initialized");
    return this.#helper.decryptWallet(new CipherString(encryptedWallet), this.#key);
  }

  reset() {
    this.#email = undefined;
    this.#encryptedWallet = undefined;
    this.#key = undefined;
    this.#password = undefined;
    this.#passwordHash = undefined;
  }
}
