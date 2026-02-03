import { ObjectInfo } from "../shared/objectInfo.js";
import { ClientToken } from "../shared/clientToken.js";

export class ObjectReference {
  static from(objectInfo: ObjectInfo, clientToken: ClientToken): ObjectReference | undefined {
    const typeId = objectInfo.serializer.getTypeId(clientToken);
    if (typeId === undefined || typeId === null) {
      return undefined;
    }

    return new ObjectReference(objectInfo.objectId, typeId);
  }

  private constructor(
    public readonly objectId: string,
    public readonly typeId: string,
  ) {}
}
