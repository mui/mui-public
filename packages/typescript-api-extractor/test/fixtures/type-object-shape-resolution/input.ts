export function acceptsInlineObjectTypes(
	emptyObject: {},
	objectKeyword: object,
	record: Record<string, any>,
) {}

export function acceptsNamedObjectTypes(
	emptyInterface: EmptyInterface,
	emptyObject: EmptyObject,
	objectKeyword: ObjectKeyword,
	recordType: RecordType,
) {}

export function acceptsObjectProps(params: Params) {}

interface Params {
	emptyInterface: EmptyInterface;
	emptyObject: EmptyObject;
	inlineEmptyObject: {};
	objectKeyword: ObjectKeyword;
	inlineObjectKeyword: object;
	recordType: RecordType;
	inlineRecordType: Record<string, any>;
}

type EmptyObject = {};

interface EmptyInterface {}

type ObjectKeyword = object;

type RecordType = Record<string, any>;
