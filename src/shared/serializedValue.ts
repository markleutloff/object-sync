export type PrimitiveValue = {
  value: string | number | boolean | null | undefined;
};

export type ObjectReference = {
  objectId: string;
  typeId: string;
};

export type InlineValue = {
  typeId: string;
  value: any;
};

export type SerializedValue = PrimitiveValue | ObjectReference | InlineValue | undefined;
