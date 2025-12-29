import type {
  AnyOrama,
  SearchParams,
  TypedDocument,
  OramaPluginAsync,
  PartialSchemaDeep,
} from '@orama/orama';

export type PluginEmbeddingsParams = {
  embeddings: {
    defaultProperty: string;
    generateEmbedding: ((text: string) => Promise<number[]>) | null;
    onInsert?: {
      generate: boolean;
      properties: string[];
      verbose?: boolean;
    };
  };
};

function getPropertyValue(obj: any, path: string): any {
  return path
    .split('.')
    .reduce(
      (current, key) => (current && current[key] !== undefined ? current[key] : undefined),
      obj,
    );
}

function getPropertiesValues(schema: any, properties: string[]): string {
  return properties
    .map((prop) => getPropertyValue(schema, prop))
    .filter((value) => value !== undefined)
    .join('. ');
}

export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
  return v.map((val) => val / norm);
}

export const embeddingsType = 'vector[384]';

export async function pluginEmbeddings(
  pluginParams: PluginEmbeddingsParams,
): Promise<OramaPluginAsync> {
  return {
    name: 'docs-infra-plugin-embeddings',

    async beforeInsert<T extends TypedDocument<any>>(
      _db: AnyOrama,
      _id: string,
      params: PartialSchemaDeep<T>,
    ) {
      if (!pluginParams.embeddings?.onInsert?.generate) {
        return;
      }

      if (!pluginParams.embeddings?.onInsert?.properties) {
        throw new Error('Missing "embeddingsConfig.properties" parameter for plugin-secure-proxy');
      }

      const properties = pluginParams.embeddings.onInsert.properties;
      const values = getPropertiesValues(params, properties);

      if (!pluginParams.embeddings.generateEmbedding) {
        throw new Error(
          'No generateEmbedding function provided in plugin parameters. Maybe it has not loaded yet.',
        );
      }

      const embeddings = await pluginParams.embeddings.generateEmbedding(values);

      (params as any)[pluginParams.embeddings.defaultProperty] = normalizeVector(embeddings);
    },

    async beforeSearch<T extends AnyOrama>(
      _db: AnyOrama,
      params: SearchParams<T, TypedDocument<any>>,
    ) {
      if (params.mode !== 'vector' && params.mode !== 'hybrid') {
        return;
      }

      if (params?.vector?.value) {
        return;
      }

      if (!params.term) {
        throw new Error('No "term" or "vector" parameters were provided');
      }

      if (!pluginParams.embeddings.generateEmbedding) {
        throw new Error(
          'No generateEmbedding function provided in plugin parameters. Maybe it has not loaded yet.',
        );
      }

      const embeddings = await pluginParams.embeddings.generateEmbedding(params.term);

      if (!params.vector) {
        params.vector = {
          property: pluginParams.embeddings.defaultProperty,
          value: normalizeVector(embeddings),
        };
      }

      params.vector.value = normalizeVector(embeddings);
    },
  };
}
