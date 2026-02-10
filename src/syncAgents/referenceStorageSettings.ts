import { ClientToken } from "../shared/index.js";

export type ReferenceStorageSettings = {
  /**
   * The key associated with the stored reference.
   */
  key?: any;

  /**
   * The client token for which to store the reference.
   */
  clientToken?: ClientToken;
} & (
  | {
      /**
       * The value to store a reference for.
       */
      value: any;
    }
  | {
      /**
       * The values to store references for.
       */
      values: any[];
    }
);

export type SerializeAndReferenceStorageSettingsBase = {
  /**
   * The key associated with the stored reference.
   */
  key?: any;

  /**
   * The client token for which to store the reference.
   */
  clientToken: ClientToken;
};

export type SingleSerializeAndReferenceStorageSettings = SerializeAndReferenceStorageSettingsBase & {
  /**
   * The value to serialize and store a reference for.
   */
  value: any;
};

export type MultipleSerializeAndReferenceStorageSettings = SerializeAndReferenceStorageSettingsBase & {
  /**
   * The values to serialize and store references for.
   */
  values: any[];
};
