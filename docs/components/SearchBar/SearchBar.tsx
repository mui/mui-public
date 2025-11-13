'use client';
import * as React from 'react';
import { create, insertMultiple, search as performSearch } from '@orama/orama';
import { createChannel } from 'bidc';
import { pluginEmbeddings } from '@mui/internal-docs-infra/pipeline/generateEmbeddings';
import classes from './SearchBar.module.css';
import type { ReceivePayload, ReceiveResponse } from './searchWorker';

export function SearchBar({
  sitemap: sitemapImport,
}: {
  sitemap: () => Promise<{ sitemap?: { schema: {}; data: {} } }>;
}) {
  const [index, setIndex] = React.useState(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [results, setResults] = React.useState<any>(null);

  const [ready, setReady] = React.useState<boolean>(false);
  const worker = React.useRef<Worker | null>(null);
  const generateEmbeddings = React.useRef<((text: string) => Promise<number[]>) | null>(null);

  // We use the `useEffect` hook to set up the worker as soon as the `App` component is mounted.
  React.useEffect(() => {
    if (!worker.current) {
      // Create the worker if it does not yet exist.
      worker.current = new Worker(new URL('./searchWorker', import.meta.url), {
        type: 'module',
      });
    }

    const { send, receive } = createChannel(worker.current);

    // Create a callback function for messages from the worker thread.
    receive((event: ReceiveResponse): void => {
      switch (event.status) {
        case 'initiate':
          setReady(false);
          break;
        case 'download':
          break;
        case 'progress':
          console.log(event);
          break;
        case 'done':
          break;
        case 'ready':
          setReady(true);
          break;
        case 'complete':
          // should be handled by send()
          break;
        default:
          console.warn('Unknown message status:', event);
      }
    });

    generateEmbeddings.current = async (text: string): Promise<number[]> => {
      const response = await send<Event, ReceivePayload, ReceiveResponse>({
        type: 'generate',
        text,
      });

      if (response.status !== 'complete') {
        throw new Error(`Embedding generation failed: ${JSON.stringify(response)}`);
      }

      return response.output;
    };

    send({ type: 'check' });
  });

  React.useEffect(() => {
    if (!ready) {
      return;
    }

    const embeddingsPlugin = pluginEmbeddings({
      embeddings: {
        defaultProperty: 'embeddings',
        generateEmbedding: generateEmbeddings.current,
      },
    });

    sitemapImport().then(({ sitemap }) =>
      embeddingsPlugin.then((plugin) => {
        if (!sitemap) {
          console.error('Sitemap is undefined');
          return;
        }

        // https://github.com/oramasearch/orama/issues/925#issuecomment-3220962578
        // @ts-expect-error - workaround for TS issue with OramaPlugin type
        plugin.beforeSearch.constructor = (async () => {}).constructor;

        const searchIndex = create({ schema: sitemap.schema, plugins: [plugin] });

        // Flatten the sitemap data structure to a single array of pages
        const pages = Object.entries(sitemap.data).flatMap(
          ([_sectionKey, sectionData]: [string, any]) => {
            return (sectionData.pages || []).map((page: any) => ({
              ...page,
              section: sectionData.title,
              prefix: sectionData.prefix,
            }));
          },
        );

        insertMultiple(searchIndex, pages);
        setIndex(searchIndex as any);
      }),
    );
  }, [ready, sitemapImport]);

  const handleSearch = React.useCallback(
    async (term: string) => {
      if (!index || !term.trim()) {
        setResults(null);
        return;
      }
      const searchResults = await performSearch(index, { term, mode: 'vector', similarity: 0.1 });
      setResults(searchResults);
    },
    [index],
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchTerm(value);
    handleSearch(value);
  };

  return (
    <div className={classes.wrapper}>
      <div className={classes.container}>
        <form onSubmit={(event) => event.preventDefault()}>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={handleInputChange}
            className={classes.searchInput}
          />
        </form>
        {results && (
          <div className={classes.results}>
            <div className={classes.resultsSummary}>
              Found {results.count} results in {results.elapsed.formatted}
            </div>
            {results.hits.map((hit: any) => (
              <div key={hit.id} className={classes.resultCard}>
                <div className={classes.resultTitle}>
                  <strong>{hit.document.title}</strong>
                  <span className={classes.resultScore}>Score: {hit.score.toFixed(2)}</span>
                </div>
                <div className={classes.resultBreadcrumb}>
                  {hit.document.section} → {hit.document.slug}
                </div>
                <div className={classes.resultDescription}>{hit.document.description}</div>
                <a
                  href={`${hit.document.prefix}${hit.document.slug}`}
                  className={classes.resultLink}
                >
                  {hit.document.prefix}
                  {hit.document.slug}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
