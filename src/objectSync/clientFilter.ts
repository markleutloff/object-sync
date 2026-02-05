import { hasInIterable, OneOrMany } from "../shared/types.js";
import { ClientToken } from "../shared/clientToken.js";

export type ClientTokenFilter = {
  /**
   * Set of clients to include or exclude
   */
  clientTokens?: OneOrMany<ClientToken>;

  /**
   * Set of client identities to include or exclude
   */
  identities?: OneOrMany<string>;

  /**
   * If true, only the specified clients are included; if false, they are excluded, default is true
   */
  isExclusive?: boolean;
};

export function isForClientToken(clientToken: ClientToken, filter: ClientTokenFilter): boolean {
  let hasDesignation = filter.identities === undefined || clientToken.identity === undefined;
  if (!hasDesignation) {
    hasDesignation = hasInIterable(filter.identities!, clientToken.identity);
  }

  let hasClientToken = filter.clientTokens === undefined;
  if (!hasClientToken) {
    hasClientToken = hasInIterable(filter.clientTokens!, clientToken);
  }

  return filter.isExclusive === (hasDesignation && hasClientToken);
}
