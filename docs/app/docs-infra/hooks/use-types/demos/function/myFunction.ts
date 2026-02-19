/**
 * Formats a greeting message.
 */
export function formatGreeting(options: {
  /** The name to greet */
  name: string;
  /** Whether to use a formal greeting */
  formal?: boolean;
}): string {
  const { name, formal } = options;
  return formal ? `Good day, ${name}.` : `Hey ${name}!`;
}
