interface BaseProps {
	id: string;
}

export interface ExtendedProps extends BaseProps {
	name: string;
}

// Multiple extends
interface AnotherBase {
	count: number;
}

export interface MultiExtendedProps extends BaseProps, AnotherBase {
	description: string;
}

// Namespace with type alias pointing to flat-named interface
interface DialogProps {
	open: boolean;
}

namespace Dialog {
	export type Props = DialogProps;
}

export interface AlertDialogProps extends Dialog.Props {
	urgent: boolean;
}

// Also export the namespace for comparison
export type { Dialog };
