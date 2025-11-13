let pluginEmbeddings: typeof import('@orama/plugin-embeddings').pluginEmbeddings | null = null;
let tf: typeof import('@tensorflow/tfjs') | null = null;

// Lazy load embeddings dependencies only when needed
async function loadDependencies() {
  if (!pluginEmbeddings || !tf) {
    try {
      const [embeddingsModule, tfModule] = await Promise.all([
        import('@orama/plugin-embeddings'),
        import('@tensorflow/tfjs'),
        import('@tensorflow/tfjs-backend-wasm'),
      ]);
      pluginEmbeddings = embeddingsModule.pluginEmbeddings;
      tf = tfModule;
    } catch (error) {
      throw new Error(
        'Embeddings dependencies are not installed. Please install @orama/plugin-embeddings, @tensorflow/tfjs, and @tensorflow/tfjs-backend-wasm to enable embeddings generation.',
      );
    }
  }
}

let plugin: ReturnType<typeof import('@orama/plugin-embeddings').pluginEmbeddings> | null = null;

export async function generateEmbeddings(text: string): Promise<number[]> {
  // Load dependencies if not already loaded
  await loadDependencies();

  if (!tf) {
    throw new Error('TensorFlow.js failed to load');
  }

  // Initialize plugin if not already initialized
  if (!plugin && pluginEmbeddings) {
    plugin = pluginEmbeddings({
      embeddings: {
        defaultProperty: 'embeddings',
        onInsert: {
          generate: true,
          properties: ['text'],
          verbose: false,
        },
      },
    });
  }

  await tf.ready();
  const data = { text };
  const generator = (await plugin!).beforeInsert;
  await generator?.(
    null!, // we don't have an Orama instance yet
    null!, // we don't have an id yet
    data,
  );
  // the plugin adds the embeddings to the data object
  const embeddings = (data as unknown as { embeddings: number[] }).embeddings;
  if (!embeddings) {
    throw new Error('Failed to generate embeddings');
  }

  return embeddings;
}
