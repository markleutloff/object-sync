import { describe, it, beforeEach } from "node:test";
import { ObjectSyncHost, ClientConnection, Message } from "../../src/index.js";
import assert from "assert";
import { getHostObjectInfo } from "../../src/shared/objectSyncMetaInfo.js";

import { Alpha, Beta, Gamma } from "./shared.js";

describe("ObjectSyncHost integration", () => {
  let host: ObjectSyncHost;
  let alpha: Alpha;
  let beta: Beta;
  let gamma: Gamma;
  let clientToken: ClientConnection;

  beforeEach(() => {
    host = new ObjectSyncHost();
    beta = new Beta();
    alpha = new Alpha();
    alpha.beta = beta;
    alpha.nonSpecial = "initial";
    gamma = new Gamma(alpha);
    clientToken = host.registerClient({
      designation: "client",
    });
    host.track(gamma, { clientVisibility: { clients: clientToken } });
  });

  it("should create and track objects", () => {
    const messages = host.getMessages().get(clientToken)!;
    assert(messages.some((m) => m.type === "create" && m.typeId === "Gamma"));
    assert(messages.some((m) => m.type === "create" && m.typeId === "Alpha"));
    assert(messages.some((m) => m.type === "create" && m.typeId === "Beta"));
  });

  it("should send property changes", () => {
    // discard initial creation messages
    host.getMessages();

    alpha.nonSpecial = "changed";
    const messages = host.getMessages().get(clientToken)!;
    const changeMsg = messages.find((m) => m.type === "change" && m.objectId === getHostObjectInfo(alpha)?.objectId);
    assert(changeMsg);
    assert.strictEqual((changeMsg as any).properties.nonSpecial.value, "changed");
  });

  it("should not send properties when not designated for the client", () => {
    // discard initial creation messages
    host.getMessages();

    alpha.special = "changed";
    const messages = host.getMessages().get(clientToken)!;
    assert.equal(messages.length, 0);
  });

  it("should send method execution", () => {
    alpha.what(42);
    const messages = host.getMessages().get(clientToken)!;
    const execMsg = messages.find((m) => m.type === "execute" && m.objectId === getHostObjectInfo(alpha)?.objectId);
    assert(execMsg);
    assert.strictEqual((execMsg as any).method, "what");
    assert.strictEqual((execMsg as any).parameters[0].value, 42);
  });

  it("should support client-specific property views", () => {
    getHostObjectInfo(beta)?.addView({
      filter: { clients: new Set([clientToken]), isExclusive: true },
      onProperty(client, key, propertyInfo) {
        if (key === "value") return { value: 999 };
        return propertyInfo;
      },
    });
    const messages = host.getMessages().get(clientToken)!;
    const betaMsg = messages.find((m) => m.type === "create" && m.typeId === "Beta");
    assert(betaMsg);
    assert.strictEqual((betaMsg as any).properties.value.value, 999);
  });

  it("should untrack and send delete message", () => {
    host.getMessages();

    const gammaTrackable = getHostObjectInfo(gamma)!;
    host.untrack(gamma);

    const messages = host.getMessages().get(clientToken)!;
    assert(messages.some((m) => m.type === "delete" && m.objectId === gammaTrackable.objectId));
  });

  it("should support multiple clients", () => {
    getHostObjectInfo(beta)?.addView({
      filter: { clients: new Set([clientToken]), isExclusive: true },
      onProperty(client, key, propertyInfo) {
        if (key === "value") return { value: 999 };
        return propertyInfo;
      },
    });

    const otherClientToken = host.registerClient();
    const messagesByClient = host.getMessages();
    const messages0 = messagesByClient.get(clientToken)!;
    const messages1 = messagesByClient.get(otherClientToken)!;

    assertCreationMessages(messages0, true);
    assertCreationMessages(messages1, false);

    assertBetaDeltaValue(messages0, 999);
    assertBetaDeltaValue(messages1, 0);

    function assertCreationMessages(messages: Message[], shouldHaveGamma: boolean) {
      assert(messages.some((m) => m.type === "create" && m.typeId === "Gamma") === shouldHaveGamma);
      assert(messages.some((m) => m.type === "create" && m.typeId === "Alpha"));
      assert(messages.some((m) => m.type === "create" && m.typeId === "Beta"));
    }

    function assertBetaDeltaValue(messages: Message[], expectedValue: number) {
      const betaMsg = messages.find((m) => m.type === "create" && m.typeId === "Beta");
      assert(betaMsg);
      assert.strictEqual((betaMsg as any).properties.value.value, expectedValue);
    }
  });
});
