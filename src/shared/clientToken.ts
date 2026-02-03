/**
 * Settings for a client connection.
 */
export type ClientConnectionSettings = {
  /**
   * Identity of the client (e.g., "host", "client1", etc.).
   */
  identity: string;
};

/**
 * Representation of a connection to a client.
 */
export type ClientToken = {
  /**
   * Identity of the client (e.g., "host", "client1", etc.).
   */
  identity: string;
};
