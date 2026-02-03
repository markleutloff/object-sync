import { syncMethod, syncObject, syncProperty } from "../../../src/index.js";

@syncObject()
export class Root {
  @syncProperty()
  accessor value: number = 0;

  @syncMethod({
    promiseHandlingType: "await",
    beforeExecuteOnClient({ instance, key, args, destinationClientConnection }) {
      args[0] = args[0] + destinationClientConnection.identity;
      return true;
    },
  })
  invoke(returnValue: string) {
    return returnValue;
  }
}
