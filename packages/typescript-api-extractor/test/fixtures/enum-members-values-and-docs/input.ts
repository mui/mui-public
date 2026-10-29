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

// The type of one member is a literal of its value, named after the member.
export const leftSide = Side.left;

export const secondFlag = Flags.flag2;

export interface MemberProps {
	side: Side.right;
	sides: Side.left | Side.right;
}

// An enum with a single member has the same type as that member, so it stays the enum.
export const onlyItem = DegenerateS.theOnlyItem;
