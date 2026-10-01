/**
 * A handle for controlling dialog visibility imperatively.
 *
 * Use this class to programmatically open or close dialogs
 * without using React state.
 */
export class Handle {
  /**
   * The version of the Handle class.
   */
  static readonly version: string = '1.0.0';

  /**
   * Whether the dialog is currently open.
   */
  declare private isOpen: boolean;

  /**
   * A unique identifier for this handle instance.
   */
  readonly id: string = Math.random().toString(36).slice(2);

  /**
   * Creates a new Handle instance.
   * @param initialOpen - Whether the dialog starts open.
   */
  constructor(initialOpen: boolean = false) {
    this.isOpen = initialOpen;
  }

  /**
   * Opens the dialog.
   * @returns Whether the operation succeeded.
   */
  open(): boolean {
    this.isOpen = true;
    return true;
  }

  /**
   * Closes the dialog.
   * @returns Whether the operation succeeded.
   */
  close(): boolean {
    this.isOpen = false;
    return true;
  }

  /**
   * Toggles the dialog open/closed state.
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
  }
}
