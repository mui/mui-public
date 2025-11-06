// Base error class for all CodeHighlighter errors
export class ErrorCodeHighlighter extends Error {
  constructor(message: string) {
    super(`CodeHighlighter: ${message}`);
    this.name = this.constructor.name;
  }
}

// Server-side errors (during SSR/precomputation)
export class ErrorCodeHighlighterServer extends ErrorCodeHighlighter {
  constructor(message: string) {
    super(`[Server] ${message}`);
  }
}

// Client-side errors (during hydration/runtime)
export class ErrorCodeHighlighterClient extends ErrorCodeHighlighter {
  constructor(message: string) {
    super(`[Client] ${message}`);
  }
}

// === SERVER ERROR TYPES ===

// Configuration errors on server
export class ErrorCodeHighlighterServerConfiguration extends ErrorCodeHighlighterServer {
  constructor(message: string) {
    super(`[Configuration] ${message}`);
  }
}

// Loading errors on server
export class ErrorCodeHighlighterServerLoader extends ErrorCodeHighlighterServer {
  constructor(message: string) {
    super(`[Loader] ${message}`);
  }
}

// Validation errors on server
export class ErrorCodeHighlighterServerValidation extends ErrorCodeHighlighterServer {
  constructor(message: string) {
    super(`[Validation] ${message}`);
  }
}

// === CLIENT ERROR TYPES ===

// Configuration errors on client
export class ErrorCodeHighlighterClientConfiguration extends ErrorCodeHighlighterClient {
  constructor(message: string) {
    super(`[Configuration] ${message}`);
  }
}

// Loading errors on client
export class ErrorCodeHighlighterClientLoader extends ErrorCodeHighlighterClient {
  constructor(message: string) {
    super(`[Loader] ${message}`);
  }
}

// Validation errors on client
export class ErrorCodeHighlighterClientValidation extends ErrorCodeHighlighterClient {
  constructor(message: string) {
    super(`[Validation] ${message}`);
  }
}

// Provider errors on client
export class ErrorCodeHighlighterClientProvider extends ErrorCodeHighlighterClient {
  constructor(message: string) {
    super(`[Provider] ${message}`);
  }
}

// === SERVER SPECIFIC ERRORS ===

// Server Configuration Errors
export class ErrorCodeHighlighterServerMissingLoadCodeMeta extends ErrorCodeHighlighterServerConfiguration {
  constructor(context?: string) {
    const message = context
      ? `Missing loadCodeMeta function - ${context}`
      : 'Missing loadCodeMeta function - No code provided and "loadCodeMeta" function is not defined';
    super(message);
  }
}

export class ErrorCodeHighlighterServerMissingLoadCodeMetaForGlobals extends ErrorCodeHighlighterServerConfiguration {
  constructor() {
    super(
      'Missing loadCodeMeta function - loadCodeMeta function is required when globalsCode contains string URLs',
    );
  }
}

export class ErrorCodeHighlighterServerMissingUrl extends ErrorCodeHighlighterServerValidation {
  constructor(context?: string) {
    const message = context
      ? `Missing URL - URL is required ${context}`
      : 'Missing URL - URL is required for loading initial source';
    super(message);
  }
}

export class ErrorCodeHighlighterServerMissingUrlForLoadCodeMeta extends ErrorCodeHighlighterServerValidation {
  constructor() {
    super('Missing URL - URL is required when loading code with "loadCodeMeta"');
  }
}

export class ErrorCodeHighlighterServerInvalidProps extends ErrorCodeHighlighterServerValidation {
  constructor() {
    super('Invalid props - Cannot provide both "children" and "code" or "precompute" props');
  }
}

export class ErrorCodeHighlighterServerMissingData extends ErrorCodeHighlighterServerValidation {
  constructor() {
    super('Missing data - No code or components provided');
  }
}

export class ErrorCodeHighlighterServerMissingVariant extends ErrorCodeHighlighterServerValidation {
  constructor(variantName: string) {
    super(`Missing variant - No code or component for variant "${variantName}"`);
  }
}

export class ErrorCodeHighlighterServerMissingFileName extends ErrorCodeHighlighterServerValidation {
  constructor(variantName: string) {
    super(
      `Missing fileName - fileName or url is required for variant "${variantName}" when extraFiles are provided`,
    );
  }
}

export class ErrorCodeHighlighterServerMissingContentLoading extends ErrorCodeHighlighterServerConfiguration {
  constructor() {
    super(
      `Missing ContentLoading component - ContentLoading component is required for stream highlighting`,
    );
  }
}

export class ErrorCodeHighlighterServerInvalidClientMode extends ErrorCodeHighlighterServerValidation {
  constructor() {
    super(
      `Invalid client mode - Client only mode with highlightAfter: init requires precomputed and parsed source code`,
    );
  }
}

// Server Loading Errors
export class ErrorCodeHighlighterServerLoadCodeFailure extends ErrorCodeHighlighterServerLoader {
  constructor(url: string, error: any) {
    super(`Failed to load code from URL:\n\n${url}\n\nError:\n${JSON.stringify(error, null, 2)}`);
  }
}

export class ErrorCodeHighlighterServerLoadGlobalsFailure extends ErrorCodeHighlighterServerLoader {
  constructor(url: string, error: any) {
    super(
      `Failed to load globalsCode from URL:\n\n${url}\n\nError:\n${JSON.stringify(error, null, 2)}`,
    );
  }
}

export class ErrorCodeHighlighterServerLoadVariantsFailure extends ErrorCodeHighlighterServerLoader {
  constructor(url: string, errors: Error[]) {
    super(
      `Failed to load all variants of URL:\n\n${url}:\n\n${errors.map((error) => error.message).join('\n')}`,
    );
  }
}

// === CLIENT SPECIFIC ERRORS ===

// Client Provider Errors
export class ErrorCodeHighlighterClientMissingLoadFallbackCode extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string) {
    super(
      `Missing loadCodeFallback function - loadCodeFallback is required (${url || 'No URL'}) add a <CodeProvider />`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingLoadVariant extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string) {
    super(
      `Missing loadCodeVariant function - loadCodeVariant function is required when no initial code is provided (${url || 'No URL'})`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingLoadCodeMeta extends ErrorCodeHighlighterClientProvider {
  constructor(context?: string) {
    const message = context
      ? `Missing loadCodeMeta function - ${context}`
      : 'Missing loadCodeMeta function - loadCodeMeta is required';
    super(message);
  }
}

export class ErrorCodeHighlighterClientMissingLoadCodeMetaForNoCode extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string) {
    super(
      `Missing loadCodeMeta function - loadCodeMeta function is required when no code is provided (${url || 'No URL'})`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingLoadCodeMetaForGlobals extends ErrorCodeHighlighterClientProvider {
  constructor() {
    super(
      `Missing loadCodeMeta function - loadCodeMeta function is required when globalsCode contains string URLs`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingLoadCodeMetaForStringUrls extends ErrorCodeHighlighterClientProvider {
  constructor() {
    super(
      `Missing loadCodeMeta function - "loadCodeMeta" function is required for string URLs in globalsCode`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingLoadSource extends ErrorCodeHighlighterClientProvider {
  constructor(context?: string) {
    const message = context
      ? `Missing loadSource function - ${context}`
      : 'Missing loadSource function - loadSource function is required when no code is provided';
    super(message);
  }
}

export class ErrorCodeHighlighterClientMissingLoadSourceForNoCode extends ErrorCodeHighlighterClientProvider {
  constructor() {
    super(`Missing loadSource function - loadSource function is required when no code is provided`);
  }
}

export class ErrorCodeHighlighterClientMissingLoadSourceForUnloadedUrls extends ErrorCodeHighlighterClientProvider {
  constructor() {
    super(
      `Missing loadSource function - loadSource function is required when code contains unloaded URLs`,
    );
  }
}

// Client Validation Errors
export class ErrorCodeHighlighterClientMissingUrl extends ErrorCodeHighlighterClientValidation {
  constructor(context?: string) {
    const message = context
      ? `Missing URL - ${context}`
      : 'Missing URL - URL is required for loading fallback data when no initial code is provided';
    super(message);
  }
}

export class ErrorCodeHighlighterClientMissingUrlForFallback extends ErrorCodeHighlighterClientValidation {
  constructor() {
    super(
      `Missing URL - URL is required for loading fallback data when no initial code is provided`,
    );
  }
}

export class ErrorCodeHighlighterClientMissingUrlForVariants extends ErrorCodeHighlighterClientValidation {
  constructor() {
    super(`Missing URL - URL is required for loading variants when no initial code is provided`);
  }
}

export class ErrorCodeHighlighterClientMissingData extends ErrorCodeHighlighterClientValidation {
  constructor() {
    super(
      `Missing data - CodeHighlighterClient requires either \`variants\`, \`components\`, or \`code\` to be provided.`,
    );
  }
}

// === CONSOLE ERROR CLASSES ===

// Server console errors
export class ErrorCodeHighlighterServerLoadVariantFailure extends ErrorCodeHighlighterServerLoader {
  constructor(url: string, error: Error) {
    super(`Error loading variant of ${url}: ${error.message}`);
  }
}

// Client console errors
export class ErrorCodeHighlighterClientLoadFallbackFailure extends ErrorCodeHighlighterClientLoader {
  constructor(error: Error) {
    super(`Error loading fallback code: ${error.message}`);
  }
}

export class ErrorCodeHighlighterClientLoadVariantsFailure extends ErrorCodeHighlighterClientLoader {
  constructor(url: string, errors: Error[]) {
    super(
      `Failed to load variants:\n\n${url}\n\n${errors.map((error) => error.message).join('\n')}`,
    );
  }
}

export class ErrorCodeHighlighterClientLoadAllVariantsFailure extends ErrorCodeHighlighterClientLoader {
  constructor(url: string, error: Error) {
    super(`Failed to load all variants\n\n${url}\n\n${error.message}`);
  }
}

export class ErrorCodeHighlighterClientMissingParseSource extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string, isForceClient?: boolean) {
    const context = isForceClient ? 'CodeHighlighterClient' : 'CodeHighlighter';
    const details = isForceClient
      ? 'Make sure CodeProvider is set up correctly for client-side parsing.'
      : 'Code highlighting requires either server-side sourceParser or a CodeProvider for client-side parsing.';
    super(`${context}: parseSource function is not available. ${details}${url ? ` (${url})` : ''}`);
  }
}

export class ErrorCodeHighlighterClientMissingParseCode extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string, isForceClient?: boolean) {
    const context = isForceClient ? 'CodeHighlighterClient' : 'CodeHighlighter';
    const details = isForceClient
      ? 'Make sure CodeProvider is set up correctly for client-side parsing.'
      : 'Code highlighting requires either server-side sourceParser or a CodeProvider for client-side parsing.';
    super(`${context}: parseCode function is not available. ${details}${url ? ` (${url})` : ''}`);
  }
}

export class ErrorCodeHighlighterClientMissingParseControlledCode extends ErrorCodeHighlighterClientProvider {
  constructor(url?: string, isForceClient?: boolean) {
    const context = isForceClient ? 'CodeHighlighterClient' : 'CodeHighlighter';
    const details = isForceClient
      ? 'Make sure CodeProvider is set up correctly for client-side parsing.'
      : 'Code highlighting requires either server-side precomputed source or a CodeProvider for client-side parsing.';
    super(
      `${context}: parseControlledCode function is not available. ${details}${url ? ` (${url})` : ''}`,
    );
  }
}

export class ErrorCodeHighlighterClientTransformProcessingFailure extends ErrorCodeHighlighterClientLoader {
  constructor(error: Error) {
    super(`Failed to process transforms: ${error.message}`);
  }
}

export class ErrorCodeHighlighterClientMissingLoadVariantForGlobals extends ErrorCodeHighlighterClientProvider {
  constructor() {
    super(`loadCodeVariant function is required for loading missing variants in globalsCode`);
  }
}

export class ErrorCodeHighlighterClientLoadVariantFailureForGlobals extends ErrorCodeHighlighterClientLoader {
  constructor(variantName: string, originalUrl?: string, error?: Error) {
    const url = originalUrl || 'No URL';
    super(
      `Failed to load variant ${variantName} for globalsCode\n\n${url}\n\n${error?.message || 'Unknown error'}`,
    );
  }
}

export class ErrorCodeHighlighterClientLoadGlobalsCodeFailure extends ErrorCodeHighlighterClientLoader {
  constructor(url: string, error: Error) {
    super(`Failed to load globalsCode:\n\n${url || 'No URL'}\n\n${error.message}`);
  }
}
