/**
 * Description of the Side enum.
 */
export enum Side {
	/**
	 * Left side.
	 */
	left = 'left',
	/**
	 * Right side.
	 */
	right = 'right',
}

export enum Flags {
	flag1 = 1,
	flag2 = 2,
	flag3 = 4,
	flag2And3 = flag2 | flag3,
	implicitValue,
}

export enum DegenerateN {
	theOnlyItem = 1,
}

export enum DegenerateS {
	theOnlyItem = 'one',
}
