class Internal {
	private secret: string = '';
	protected prot: number = 0;
	public open: boolean = true;
	#ecma = 1;
	static staticProp: string = 'hello';
}

export type InternalAlias = Internal;
