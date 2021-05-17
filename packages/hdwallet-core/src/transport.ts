import * as eventemitter2 from "eventemitter2";
import { Keyring } from "./keyring";

export abstract class Transport extends eventemitter2.EventEmitter2 {
  public keyring: Keyring;

  constructor(keyring: Keyring) {
    super();
    this.keyring = keyring;
  }

  public abstract getDeviceID(): Promise<string>;

  /**
   * Must emit outgoing message events and communicate with underlying interface
   */
  public abstract call(...args: any[]): Promise<any>;

  /**
   * Optional method to bootstrap connection to device
   */
  public async connect(): Promise<void> {}

  /**
   * Optional function that gets called to clean up connection to device
   */
  public async disconnect(): Promise<void> {}
}
