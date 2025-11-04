import { ObjectSyncClient, syncMethod, syncObject, syncProperty } from "../../src/index.js";

@syncObject({})
export class Beta {
  @syncProperty()
  accessor value: number | undefined = 0;
}

@syncObject<Alpha>({
  generator: {
    create(client, properties, objectId, typeId) {
      return new Alpha(client);
    },
    getType(client, properties, objectId, typeId) {
      return Alpha;
    },
  },
})
export class Alpha {
  constructor(public readonly _owner?: ObjectSyncClient) {}

  @syncProperty()
  accessor nonSpecial: string | undefined;

  @syncProperty()
  accessor beta: Beta | undefined;

  @syncProperty({ designations: "special" })
  accessor special: string | undefined;

  @syncMethod()
  what(number: number) {
    (this as any)._lastWhat = number;
  }
}

@syncObject<Gamma>({
  generator: {
    create(client, properties, objectId, typeId) {
      const result = new Gamma(properties.alpha!);
      properties.deleteProperty("alpha");
      return result;
    },
    getType(client, properties, objectId, typeId) {
      return Gamma;
    },
  },
})
export class Gamma {
  constructor(alpha: Alpha) {
    this.alpha = alpha;
  }
  @syncProperty()
  accessor alpha: Alpha;
}
