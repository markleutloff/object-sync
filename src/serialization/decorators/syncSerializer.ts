import { Constructor } from "../../shared/index.js";
import { defaultIntrinsicSerializers, defaultSerializersOrTypes } from "../serializers/base.js";
import { getSerializerSymbol, TypeSerializerConstructor } from "../serializedTypes.js";
import { TypeSerializer } from "../typeSerializer.js";

type SyncSerializerSettings<TSerializer extends TypeSerializer> = {
  /**
   * When provided will add a symbol to the type which tells it to use this serializer.
   * You can then use the type in the ObjectSync creation settings as serializer.
   */
  type?: Constructor;
} & (
  | {
      /**
       * Uses this type id then checking whether this serializer can serialize an object.
       */
      typeId: string;
      /**
       * Uses the provided type to check whether this serializer can serialize an object.
       */
      type: Constructor;
    }
  | {
      /**
       * Custom canSerialize function.
       * @param instanceOrTypeId An instance of the type or a type id.
       * @returns Whether this serializer can serialize the provided instance or type id.
       */
      canSerialize(instanceOrTypeId: object | string): boolean;
    }
) &
  (
    | {
        /**
         * Whether this serializer should be added to the default serializers list. Default is true.
         */
        defaultSerializer?: boolean;
      }
    | {
        /**
         * Whether this serializer should be added to the default intrinsic serializers list. Default is false.
         */
        defaultIntrinsicSerializer?: boolean;
      }
  );

export function syncSerializer<This extends new (...args: any) => TypeSerializer>(settings: SyncSerializerSettings<InstanceType<This>>) {
  return function syncObject(target: This, context: ClassDecoratorContext<This>) {
    context.addInitializer(function () {
      const serializerConstructor = target as unknown as TypeSerializerConstructor<any>;

      if ("canSerialize" in settings) {
        serializerConstructor.canSerialize = settings.canSerialize;
      } else {
        serializerConstructor.canSerialize = function canSerialize(instanceOrTypeId: object | string): boolean {
          if (typeof instanceOrTypeId === "string") {
            return instanceOrTypeId === settings.typeId;
          } else {
            return instanceOrTypeId instanceof settings.type;
          }
        };
      }

      if ("defaultIntrinsicSerializer" in settings && settings.defaultIntrinsicSerializer) {
        defaultIntrinsicSerializers.unshift(serializerConstructor);
      } else if (!("defaultSerializer" in settings) || settings.defaultSerializer) {
        defaultSerializersOrTypes.unshift(serializerConstructor);
      }

      // Add the getSerializer static property getter to the constructor type
      if (settings.type) {
        Object.defineProperty(settings.type, getSerializerSymbol, {
          value: () => serializerConstructor,
          writable: true,
          configurable: false,
          enumerable: false,
        });
      }
    });
  };
}
